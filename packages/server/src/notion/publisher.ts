import {
  type NotionPageLink,
  NotionPageLinkSchema,
  notionInlineHtmlToMarkdown,
  parseFrontmatterRecord,
  prependFrontmatter,
  stripFrontmatter,
  tryLineLevelCombine,
} from '@inkeep/open-knowledge-core';
import type { NotionBaseStore, NotionPublishBase } from './base-store.ts';
import type { NotionConnections } from './notion-connections.ts';
import { parseNotionPageId } from './page-id.ts';

export type NotionPublishFailure =
  | { readonly kind: 'doc-not-found' }
  | { readonly kind: 'not-linked' }
  | { readonly kind: 'not-connected'; readonly workspace: string }
  | { readonly kind: 'page-not-empty' }
  | { readonly kind: 'changed-in-notion' }
  | { readonly kind: 'page-unreadable' }
  | { readonly kind: 'not-published' }
  | { readonly kind: 'notion-error'; readonly status: number; readonly message: string };

export class NotionPublishError extends Error {
  readonly failure: NotionPublishFailure;

  constructor(failure: NotionPublishFailure) {
    super(`Notion publish failed: ${failure.kind}`);
    this.name = 'NotionPublishError';
    this.failure = failure;
  }
}

export interface NotionConflictStages {
  readonly base: string;
  readonly ours: string;
  readonly theirs: string;
}

export interface NotionPublisherDeps {
  readonly connections: Pick<NotionConnections, 'list' | 'request'>;
  readonly bases: NotionBaseStore;
  readonly readDocSource: (docName: string) => string | null;
  readonly writeDocSource: (docName: string, source: string) => void;
  readonly isInConflict: (docName: string) => boolean;
  readonly raiseConflict: (docName: string, stages: NotionConflictStages) => void;
  readonly now?: () => number;
}

export interface NotionPublishResult extends NotionPublishBase {
  readonly mergedFromNotion: boolean;
}

export interface NotionPublisher {
  resolvePage(url: string): Promise<{ page: string; workspace: string; title: string } | null>;
  publish(docName: string, opts?: { overwrite?: boolean }): Promise<NotionPublishResult>;
  pull(docName: string): Promise<{ outcome: 'unchanged' | 'merged' }>;
}

type Reconciled =
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'merged'; readonly source: string };

interface PageMarkdown {
  readonly markdown: string;
  readonly complete: boolean;
}

function normalize(markdown: string): string {
  return notionInlineHtmlToMarkdown(markdown)
    .replace(/[ \t]+$/gm, '')
    .trim();
}

function withFrontmatter(frontmatter: string, body: string): string {
  return prependFrontmatter(frontmatter, body === '' ? '' : `${body}\n`);
}

function pageTitle(page: unknown): string {
  const properties = (page as { properties?: Record<string, unknown> })?.properties ?? {};
  for (const property of Object.values(properties)) {
    const p = property as { type?: string; title?: Array<{ plain_text?: string }> };
    if (p?.type === 'title') return (p.title ?? []).map((t) => t.plain_text ?? '').join('');
  }
  return '';
}

export function readNotionLink(source: string): NotionPageLink | null {
  const frontmatter = parseFrontmatterRecord(source);
  const parsed = NotionPageLinkSchema.safeParse(frontmatter?.notion);
  return parsed.success ? { page: parsed.data.page, workspace: parsed.data.workspace } : null;
}

export function createNotionPublisher(deps: NotionPublisherDeps): NotionPublisher {
  const now = deps.now ?? Date.now;

  async function notionJson(workspace: string, path: string, init?: RequestInit): Promise<unknown> {
    let response: Response;
    try {
      response = await deps.connections.request(workspace, path, init);
    } catch (cause) {
      if ((cause as Error)?.name === 'NotionNotConnectedError')
        throw new NotionPublishError({ kind: 'not-connected', workspace });
      throw cause;
    }
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const message = (body as { message?: string } | null)?.message ?? `HTTP ${response.status}`;
      throw new NotionPublishError({ kind: 'notion-error', status: response.status, message });
    }
    return body;
  }

  async function readPage(workspace: string, page: string): Promise<PageMarkdown> {
    const body = (await notionJson(
      workspace,
      `/v1/pages/${page}/markdown?markdown_version=v2`,
    )) as { markdown?: unknown; truncated?: unknown; unknown_block_ids?: unknown };
    const unknown = Array.isArray(body.unknown_block_ids) ? body.unknown_block_ids.length : 0;
    return {
      markdown: typeof body.markdown === 'string' ? body.markdown : '',
      complete: body.truncated !== true && unknown === 0,
    };
  }

  function linkedSource(docName: string): { source: string; link: NotionPageLink } {
    const source = deps.readDocSource(docName);
    if (source === null) throw new NotionPublishError({ kind: 'doc-not-found' });
    const link = readNotionLink(source);
    if (link === null) throw new NotionPublishError({ kind: 'not-linked' });
    return { source, link };
  }

  function reconcile(
    docName: string,
    source: string,
    notionMarkdown: string,
    base: NotionPublishBase,
  ): Reconciled {
    if (deps.isInConflict(docName)) throw new NotionPublishError({ kind: 'changed-in-notion' });
    const theirs = normalize(notionMarkdown);
    const baseBody = normalize(base.markdown);
    const reviewed = base.pendingTheirs === undefined ? null : normalize(base.pendingTheirs);
    if (theirs === baseBody || theirs === reviewed) return { kind: 'unchanged' };

    const { frontmatter, body } = stripFrontmatter(source);
    const merged = tryLineLevelCombine(baseBody, normalize(body), theirs);
    if (merged.clean) {
      const mergedSource = withFrontmatter(frontmatter, merged.merged);
      deps.writeDocSource(docName, mergedSource);
      return { kind: 'merged', source: mergedSource };
    }
    deps.raiseConflict(docName, {
      base: withFrontmatter(frontmatter, baseBody),
      ours: source,
      theirs: withFrontmatter(frontmatter, theirs),
    });
    deps.bases.set({ ...base, docName, pendingTheirs: notionMarkdown });
    throw new NotionPublishError({ kind: 'changed-in-notion' });
  }

  return {
    async resolvePage(url) {
      const page = parseNotionPageId(url);
      if (page === null) return null;
      for (const connection of deps.connections.list()) {
        let response: Response;
        try {
          response = await deps.connections.request(connection.workspaceId, `/v1/pages/${page}`);
        } catch {
          continue;
        }
        if (!response.ok) continue;
        return {
          page,
          workspace: connection.workspaceId,
          title: pageTitle(await response.json().catch(() => null)),
        };
      }
      return null;
    },

    async publish(docName, opts = {}) {
      const { source, link } = linkedSource(docName);
      const current = await readPage(link.workspace, link.page);
      const base = deps.bases.get(link.page);
      let body = stripFrontmatter(source).body;
      let mergedFromNotion = false;
      if (!opts.overwrite) {
        if (!current.complete) throw new NotionPublishError({ kind: 'page-unreadable' });
        if (base === null && normalize(current.markdown) !== '')
          throw new NotionPublishError({ kind: 'page-not-empty' });
        if (base !== null) {
          const reconciled = reconcile(docName, source, current.markdown, base);
          if (reconciled.kind === 'merged') {
            body = stripFrontmatter(reconciled.source).body;
            mergedFromNotion = true;
          }
        }
      }

      await notionJson(link.workspace, `/v1/pages/${link.page}/markdown`, {
        method: 'PATCH',
        body: JSON.stringify({
          type: 'replace_content',
          replace_content: { new_str: body },
          markdown_version: 'v2',
        }),
      });

      const published = await readPage(link.workspace, link.page);
      const next: NotionPublishBase = {
        page: link.page,
        workspace: link.workspace,
        docName,
        markdown: published.markdown,
        publishedAt: new Date(now()).toISOString(),
      };
      deps.bases.set(next);
      return { ...next, mergedFromNotion };
    },

    async pull(docName) {
      const { source, link } = linkedSource(docName);
      const base = deps.bases.get(link.page);
      if (base === null) throw new NotionPublishError({ kind: 'not-published' });
      const current = await readPage(link.workspace, link.page);
      if (!current.complete) throw new NotionPublishError({ kind: 'page-unreadable' });
      const reconciled = reconcile(docName, source, current.markdown, base);
      if (reconciled.kind === 'unchanged') return { outcome: 'unchanged' };
      const { pendingTheirs: _pending, ...rest } = base;
      deps.bases.set({ ...rest, docName, markdown: current.markdown });
      return { outcome: 'merged' };
    },
  };
}
