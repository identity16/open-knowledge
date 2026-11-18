import {
  type NotionPageLink,
  NotionPageLinkSchema,
  parseFrontmatterRecord,
  stripFrontmatter,
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
  | { readonly kind: 'notion-error'; readonly status: number; readonly message: string };

export class NotionPublishError extends Error {
  readonly failure: NotionPublishFailure;

  constructor(failure: NotionPublishFailure) {
    super(`Notion publish failed: ${failure.kind}`);
    this.name = 'NotionPublishError';
    this.failure = failure;
  }
}

export interface NotionPublisherDeps {
  readonly connections: Pick<NotionConnections, 'list' | 'request'>;
  readonly bases: NotionBaseStore;
  readonly readDocSource: (docName: string) => string | null;
  readonly now?: () => number;
}

export interface NotionPublisher {
  resolvePage(url: string): Promise<{ page: string; workspace: string; title: string } | null>;
  publish(docName: string, opts?: { overwrite?: boolean }): Promise<NotionPublishBase>;
}

interface PageMarkdown {
  readonly markdown: string;
  readonly complete: boolean;
}

function normalize(markdown: string): string {
  return markdown.replace(/[ \t]+$/gm, '').trim();
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
      const source = deps.readDocSource(docName);
      if (source === null) throw new NotionPublishError({ kind: 'doc-not-found' });
      const link = readNotionLink(source);
      if (link === null) throw new NotionPublishError({ kind: 'not-linked' });

      const current = await readPage(link.workspace, link.page);
      if (!opts.overwrite) {
        if (!current.complete) throw new NotionPublishError({ kind: 'page-unreadable' });
        const base = deps.bases.get(link.page);
        if (base === null && normalize(current.markdown) !== '')
          throw new NotionPublishError({ kind: 'page-not-empty' });
        if (base !== null && normalize(current.markdown) !== normalize(base.markdown))
          throw new NotionPublishError({ kind: 'changed-in-notion' });
      }

      await notionJson(link.workspace, `/v1/pages/${link.page}/markdown`, {
        method: 'PATCH',
        body: JSON.stringify({
          type: 'replace_content',
          replace_content: { new_str: stripFrontmatter(source).body },
          markdown_version: 'v2',
        }),
      });

      const published = await readPage(link.workspace, link.page);
      const base: NotionPublishBase = {
        page: link.page,
        workspace: link.workspace,
        docName,
        markdown: published.markdown,
        publishedAt: new Date(now()).toISOString(),
      };
      deps.bases.set(base);
      return base;
    },
  };
}
