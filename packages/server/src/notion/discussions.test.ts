import { describe, expect, test } from 'vitest';
import { createNotionDiscussions, notionRichTextToMarkdown } from './discussions.ts';
import type { NotionConnections } from './notion-connections.ts';
import { NotionPublishError } from './notion-failure.ts';

const PAGE = '41ca0a3f-aba4-81d7-a057-f24604be8c4a';

const text = (plain: string, marks: Record<string, boolean> = {}, href: string | null = null) => ({
  type: 'text',
  plain_text: plain,
  href,
  annotations: marks,
});

const paragraph = (id: string, plain: string, hasChildren = false) => ({
  id,
  type: 'paragraph',
  has_children: hasChildren,
  paragraph: { rich_text: [text(plain)] },
});

const comment = (
  id: string,
  discussion: string,
  parent: { type: 'page_id' } | { type: 'block_id'; block_id: string },
  body: string,
  createdAt: string,
  author = 'Ann',
) => ({
  id,
  discussion_id: discussion,
  parent,
  created_time: createdAt,
  rich_text: [text(body)],
  display_name: { type: 'user', resolved_name: author },
});

interface FakePage {
  children: Record<string, unknown[]>;
  comments: Record<string, unknown[]>;
  pageSize?: number;
  rateLimitOnce?: string;
}

function fakeNotion(page: FakePage) {
  const calls: string[] = [];
  const posted: unknown[] = [];
  let limited = false;
  const request: NotionConnections['request'] = async (workspace, path, init) => {
    calls.push(`${init?.method ?? 'GET'} ${path}`);
    if (workspace !== 'w1') return Response.json({ message: 'no access' }, { status: 404 });
    const url = new URL(path, 'https://api.notion.com');
    if (page.rateLimitOnce && url.pathname.includes(page.rateLimitOnce) && !limited) {
      limited = true;
      return Response.json({ message: 'slow down' }, { status: 429 });
    }
    if (init?.method === 'POST' && url.pathname === '/v1/comments') {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      posted.push(body);
      return Response.json(
        comment(
          'c-new',
          String(body.discussion_id),
          { type: 'page_id' },
          String(body.markdown),
          '2026-11-19T00:00:00.000Z',
          'Joon',
        ),
      );
    }
    const childMatch = /^\/v1\/blocks\/([^/]+)\/children$/.exec(url.pathname);
    const all =
      childMatch !== null
        ? (page.children[childMatch[1] ?? ''] ?? [])
        : url.pathname === '/v1/comments'
          ? (page.comments[url.searchParams.get('block_id') ?? ''] ?? [])
          : null;
    if (all === null) return Response.json({ message: 'not found' }, { status: 404 });
    const size = page.pageSize ?? 100;
    const start = Number(url.searchParams.get('start_cursor') ?? '0');
    const results = all.slice(start, start + size);
    const more = start + size < all.length;
    return Response.json({
      results,
      has_more: more,
      next_cursor: more ? String(start + size) : null,
    });
  };
  return { calls, posted, request };
}

function setup(page: FakePage, opts: { blockLimit?: number } = {}) {
  const notion = fakeNotion(page);
  const sleeps: number[] = [];
  const docs = new Map([
    ['notes/plan', `---\nnotion:\n  page: ${PAGE}\n  workspace: w1\n---\nBody\n`],
    ['notes/loose', 'No link\n'],
  ]);
  const discussions = createNotionDiscussions({
    connections: { request: notion.request },
    readDocSource: (name) => docs.get(name) ?? null,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    ...opts,
  });
  return { discussions, notion, sleeps };
}

describe('notionRichTextToMarkdown', () => {
  test('keeps inline marks, links and mentions', () => {
    expect(
      notionRichTextToMarkdown([
        text('Ship '),
        text('this ', { bold: true }),
        text('now', { italic: true, bold: true }),
        text(' see '),
        text('docs', {}, 'https://example.com'),
        { type: 'mention', plain_text: '@Ann' },
        text(' run '),
        text('ok sync', { code: true }),
        text(' '),
        text('old', { strikethrough: true }),
      ]),
    ).toBe('Ship **this** ***now*** see [docs](https://example.com)@Ann run `ok sync` ~~old~~');
  });
});

describe('createNotionDiscussions', () => {
  test('groups comments by discussion, page first, then in block order', async () => {
    const { discussions } = setup({
      children: {
        [PAGE]: [paragraph('b1', 'Alpha line.'), paragraph('b2', 'Beta line.', true)],
        b2: [paragraph('b3', 'Nested line.')],
      },
      comments: {
        [PAGE]: [comment('c1', 'dp', { type: 'page_id' }, 'Page note', '2026-11-18T01:00:00.000Z')],
        b1: [],
        b2: [
          comment(
            'c3',
            'd2',
            { type: 'block_id', block_id: 'b2' },
            'Second',
            '2026-11-18T03:00:00.000Z',
            'Joon',
          ),
          comment(
            'c2',
            'd2',
            { type: 'block_id', block_id: 'b2' },
            'First',
            '2026-11-18T02:00:00.000Z',
          ),
        ],
        b3: [
          comment(
            'c4',
            'd3',
            { type: 'block_id', block_id: 'b3' },
            'Deep',
            '2026-11-18T00:00:00.000Z',
          ),
        ],
      },
    });

    const listed = await discussions.list('notes/plan');

    expect(listed.page).toBe(PAGE);
    expect(listed.complete).toBe(true);
    expect(listed.discussions.map((d) => [d.id, d.anchor])).toEqual([
      ['dp', { kind: 'page' }],
      ['d2', { kind: 'block', blockId: 'b2', text: 'Beta line.' }],
      ['d3', { kind: 'block', blockId: 'b3', text: 'Nested line.' }],
    ]);
    expect(listed.discussions[1]?.comments.map((c) => [c.author, c.markdown])).toEqual([
      ['Ann', 'First'],
      ['Joon', 'Second'],
    ]);
  });

  test('follows pagination for children and comments', async () => {
    const blocks = Array.from({ length: 5 }, (_, i) => paragraph(`b${i}`, `Line ${i}`));
    const { discussions } = setup({
      pageSize: 2,
      children: { [PAGE]: blocks },
      comments: {
        b4: [
          comment(
            'c1',
            'd',
            { type: 'block_id', block_id: 'b4' },
            'one',
            '2026-11-18T01:00:00.000Z',
          ),
          comment(
            'c2',
            'd',
            { type: 'block_id', block_id: 'b4' },
            'two',
            '2026-11-18T02:00:00.000Z',
          ),
          comment(
            'c3',
            'd',
            { type: 'block_id', block_id: 'b4' },
            'three',
            '2026-11-18T03:00:00.000Z',
          ),
        ],
      },
    });

    const listed = await discussions.list('notes/plan');

    expect(listed.discussions).toHaveLength(1);
    expect(listed.discussions[0]?.comments.map((c) => c.markdown)).toEqual(['one', 'two', 'three']);
  });

  test('does not walk into child pages or databases', async () => {
    const { discussions, notion } = setup({
      children: {
        [PAGE]: [
          { id: 'sub', type: 'child_page', has_children: true, child_page: { title: 'Sub' } },
          { id: 'db', type: 'child_database', has_children: true, child_database: { title: 'DB' } },
        ],
      },
      comments: {},
    });

    await discussions.list('notes/plan');

    expect(notion.calls.filter((c) => c.includes('/children'))).toEqual([
      `GET /v1/blocks/${PAGE}/children?page_size=100`,
    ]);
  });

  test('stops at the block limit and reports the list as incomplete', async () => {
    const blocks = Array.from({ length: 5 }, (_, i) => paragraph(`b${i}`, `Line ${i}`));
    const { discussions, notion } = setup(
      { children: { [PAGE]: blocks }, comments: {} },
      { blockLimit: 3 },
    );

    const listed = await discussions.list('notes/plan');

    expect(listed.complete).toBe(false);
    expect(notion.calls.filter((c) => c.startsWith('GET /v1/comments'))).toHaveLength(4);
  });

  test('waits and retries when Notion rate-limits a read', async () => {
    const { discussions, sleeps } = setup({
      rateLimitOnce: '/v1/comments',
      children: { [PAGE]: [] },
      comments: {
        [PAGE]: [comment('c1', 'dp', { type: 'page_id' }, 'Hi', '2026-11-18T01:00:00.000Z')],
      },
    });

    const listed = await discussions.list('notes/plan');

    expect(sleeps).toEqual([1_000]);
    expect(listed.discussions).toHaveLength(1);
  });

  test('a reply posts to the discussion as the connected user', async () => {
    const { discussions, notion } = setup({ children: {}, comments: {} });

    const created = await discussions.reply('notes/plan', 'd2', 'Fixed in **OK**');

    expect(notion.posted).toEqual([
      { discussion_id: 'd2', markdown: 'Fixed in **OK**', display_name: { type: 'user' } },
    ]);
    expect(created).toEqual({
      id: 'c-new',
      author: 'Joon',
      createdAt: '2026-11-19T00:00:00.000Z',
      markdown: 'Fixed in **OK**',
    });
  });

  test('an unlinked document fails before calling Notion', async () => {
    const { discussions, notion } = setup({ children: {}, comments: {} });

    const error = await discussions.list('notes/loose').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(NotionPublishError);
    expect((error as NotionPublishError).failure.kind).toBe('not-linked');
    expect(notion.calls).toEqual([]);
  });
});
