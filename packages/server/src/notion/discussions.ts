import type {
  NotionComment,
  NotionDiscussion,
  NotionDiscussionAnchor,
} from '@inkeep/open-knowledge-core';
import { createNotionPageAccess, type NotionPageAccessDeps } from './linked-page.ts';
import { NotionPublishError } from './notion-failure.ts';

export const NOTION_DISCUSSION_BLOCK_LIMIT = 200;
const PAGE_SIZE = 100;
const PARALLEL_REQUESTS = 3;
const RATE_LIMIT_RETRIES = 3;
const RATE_LIMIT_WAIT_MS = 1_000;
const SEPARATE_PAGE_BLOCKS = new Set(['child_page', 'child_database']);

export interface NotionDiscussionsDeps extends NotionPageAccessDeps {
  readonly blockLimit?: number;
  readonly sleep?: (ms: number) => Promise<void>;
}

export interface NotionDiscussionList {
  readonly page: string;
  readonly discussions: NotionDiscussion[];
  readonly complete: boolean;
}

export interface NotionDiscussions {
  list(docName: string): Promise<NotionDiscussionList>;
  reply(docName: string, discussionId: string, markdown: string): Promise<NotionComment>;
}

interface RichText {
  readonly type?: string;
  readonly plain_text?: string;
  readonly href?: string | null;
  readonly annotations?: {
    readonly bold?: boolean;
    readonly italic?: boolean;
    readonly strikethrough?: boolean;
    readonly code?: boolean;
  };
}

interface RawBlock {
  readonly id: string;
  readonly type: string;
  readonly has_children?: boolean;
  readonly [key: string]: unknown;
}

interface RawComment {
  readonly id: string;
  readonly discussion_id: string;
  readonly parent?: { readonly type?: string; readonly block_id?: string };
  readonly created_time?: string;
  readonly rich_text?: readonly RichText[];
  readonly display_name?: { readonly resolved_name?: string };
}

interface Listing<T> {
  readonly results?: readonly T[];
  readonly has_more?: boolean;
  readonly next_cursor?: string | null;
}

function wrap(text: string, marker: string): string {
  const match = /^(\s*)(.*?)(\s*)$/s.exec(text);
  if (!match || match[2] === '') return text;
  return `${match[1]}${marker}${match[2]}${marker}${match[3]}`;
}

export function notionRichTextToMarkdown(parts: readonly RichText[]): string {
  return parts
    .map((part) => {
      const text = part.plain_text ?? '';
      if (part.type === 'mention') return text;
      const marks = part.annotations ?? {};
      if (marks.code) return wrap(text, '`');
      let out = text;
      if (marks.bold) out = wrap(out, '**');
      if (marks.italic) out = wrap(out, '*');
      if (marks.strikethrough) out = wrap(out, '~~');
      return part.href ? `[${out}](${part.href})` : out;
    })
    .join('');
}

function blockText(block: RawBlock): string {
  const content = block[block.type] as { rich_text?: readonly RichText[] } | undefined;
  return (content?.rich_text ?? []).map((part) => part.plain_text ?? '').join('');
}

function toComment(raw: RawComment): NotionComment {
  return {
    id: raw.id,
    author: raw.display_name?.resolved_name ?? '',
    createdAt: raw.created_time ?? '',
    markdown: notionRichTextToMarkdown(raw.rich_text ?? []),
  };
}

async function inBatches<T, R>(items: readonly T[], run: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += PARALLEL_REQUESTS) {
    results.push(...(await Promise.all(items.slice(i, i + PARALLEL_REQUESTS).map(run))));
  }
  return results;
}

export function createNotionDiscussions(deps: NotionDiscussionsDeps): NotionDiscussions {
  const access = createNotionPageAccess(deps);
  const blockLimit = deps.blockLimit ?? NOTION_DISCUSSION_BLOCK_LIMIT;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  async function read(workspace: string, path: string): Promise<unknown> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await access.json(workspace, path);
      } catch (cause) {
        const limited =
          cause instanceof NotionPublishError &&
          cause.failure.kind === 'notion-error' &&
          cause.failure.status === 429;
        if (!limited || attempt >= RATE_LIMIT_RETRIES) throw cause;
        await sleep(RATE_LIMIT_WAIT_MS * (attempt + 1));
      }
    }
  }

  async function listAll<T>(
    workspace: string,
    path: string,
    params: Record<string, string> = {},
  ): Promise<T[]> {
    const items: T[] = [];
    let cursor: string | null = null;
    do {
      const query = new URLSearchParams({ ...params, page_size: String(PAGE_SIZE) });
      if (cursor) query.set('start_cursor', cursor);
      const page = (await read(workspace, `${path}?${query}`)) as Listing<T>;
      items.push(...(page.results ?? []));
      cursor = page.has_more ? (page.next_cursor ?? null) : null;
    } while (cursor);
    return items;
  }

  async function walkBlocks(
    workspace: string,
    page: string,
  ): Promise<{ blocks: RawBlock[]; complete: boolean }> {
    const blocks: RawBlock[] = [];
    let frontier = [page];
    while (frontier.length > 0) {
      const levels = await inBatches(frontier, (parent) =>
        listAll<RawBlock>(workspace, `/v1/blocks/${parent}/children`),
      );
      const next: string[] = [];
      for (const children of levels) {
        for (const block of children) {
          if (blocks.length >= blockLimit) return { blocks, complete: false };
          blocks.push(block);
          if (block.has_children && !SEPARATE_PAGE_BLOCKS.has(block.type)) next.push(block.id);
        }
      }
      frontier = next;
    }
    return { blocks, complete: true };
  }

  return {
    async list(docName) {
      const { link } = access.linkedSource(docName);
      const { blocks, complete } = await walkBlocks(link.workspace, link.page);
      const order = new Map(blocks.map((block, index) => [block.id, index]));
      const texts = new Map(blocks.map((block) => [block.id, blockText(block)]));
      const listed = await inBatches([link.page, ...blocks.map((b) => b.id)], (blockId) =>
        listAll<RawComment>(link.workspace, '/v1/comments', { block_id: blockId }),
      );

      const byDiscussion = new Map<
        string,
        { anchor: NotionDiscussionAnchor; rank: number; comments: NotionComment[] }
      >();
      for (const raw of listed.flat()) {
        let entry = byDiscussion.get(raw.discussion_id);
        if (!entry) {
          const blockId = raw.parent?.type === 'block_id' ? raw.parent.block_id : undefined;
          entry = blockId
            ? {
                anchor: { kind: 'block', blockId, text: texts.get(blockId) ?? '' },
                rank: order.get(blockId) ?? blocks.length,
                comments: [],
              }
            : { anchor: { kind: 'page' }, rank: -1, comments: [] };
          byDiscussion.set(raw.discussion_id, entry);
        }
        entry.comments.push(toComment(raw));
      }

      const discussions = [...byDiscussion.entries()]
        .sort(([, a], [, b]) => a.rank - b.rank)
        .map(([id, entry]) => ({
          id,
          anchor: entry.anchor,
          comments: entry.comments.sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
        }));
      return { page: link.page, discussions, complete };
    },

    async reply(docName, discussionId, markdown) {
      const { link } = access.linkedSource(docName);
      const created = (await access.json(link.workspace, '/v1/comments', {
        method: 'POST',
        body: JSON.stringify({
          discussion_id: discussionId,
          markdown,
          display_name: { type: 'user' },
        }),
      })) as RawComment;
      return toComment(created);
    },
  };
}
