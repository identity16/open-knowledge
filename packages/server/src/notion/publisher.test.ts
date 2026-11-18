import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { createNotionBaseStore } from './base-store.ts';
import type { NotionConnections } from './notion-connections.ts';
import { createNotionPublisher, NotionPublishError } from './publisher.ts';

const PAGE = '41ca0a3f-aba4-8150-aad5-c7e056948abe';
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function notionReadBack(markdown: string): string {
  return markdown.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').trim();
}

function fakeNotion(initial = '') {
  const pages = new Map<string, string>([[PAGE, initial]]);
  const calls: string[] = [];
  const request: NotionConnections['request'] = async (workspace, path, init) => {
    calls.push(`${init?.method ?? 'GET'} ${workspace} ${path}`);
    if (workspace !== 'w1') return Response.json({ message: 'no access' }, { status: 404 });
    const id = /\/v1\/pages\/([^/?]+)/.exec(path)?.[1] ?? '';
    if (!pages.has(id)) return Response.json({ message: 'not found' }, { status: 404 });
    if (path.endsWith('/markdown') && init?.method === 'PATCH') {
      const body = JSON.parse(String(init.body)) as { replace_content: { new_str: string } };
      pages.set(id, notionReadBack(body.replace_content.new_str));
      return Response.json({ object: 'page_markdown' });
    }
    if (path.includes('/markdown'))
      return Response.json({ markdown: pages.get(id), truncated: false, unknown_block_ids: [] });
    return Response.json({
      properties: { Name: { type: 'title', title: [{ plain_text: 'Plan' }] } },
    });
  };
  return { pages, calls, request };
}

function setup(doc: string, notion = fakeNotion()) {
  const dir = mkdtempSync(join(tmpdir(), 'ok-notion-publish-'));
  dirs.push(dir);
  const docs = new Map<string, string>([['notes/plan', doc]]);
  const bases = createNotionBaseStore(join(dir, 'notion'));
  const publisher = createNotionPublisher({
    connections: {
      list: () => [
        { workspaceId: 'w0', workspaceName: 'Other', workspaceIcon: null, connectedAt: 'x' },
        { workspaceId: 'w1', workspaceName: 'Joon', workspaceIcon: null, connectedAt: 'x' },
      ],
      request: notion.request,
    },
    bases,
    readDocSource: (name) => docs.get(name) ?? null,
    now: () => Date.parse('2026-11-18T00:00:00.000Z'),
  });
  return { publisher, bases, docs, notion };
}

const linked = (body: string) =>
  `---\ntitle: Plan\nnotion:\n  page: ${PAGE}\n  workspace: w1\n---\n${body}`;

async function failureOf(promise: Promise<unknown>) {
  const error = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(NotionPublishError);
  return (error as NotionPublishError).failure.kind;
}

describe('resolvePage', () => {
  test('finds the connected workspace that can open the page and its title', async () => {
    const { publisher } = setup('');
    expect(
      await publisher.resolvePage(`https://www.notion.so/Plan-${PAGE.replaceAll('-', '')}`),
    ).toEqual({ page: PAGE, workspace: 'w1', title: 'Plan' });
  });

  test('skips a workspace whose tokens cannot be read and keeps looking', async () => {
    const notion = fakeNotion();
    const request: NotionConnections['request'] = async (workspace, path, init) => {
      if (workspace === 'w0') throw new Error('keychain locked');
      return notion.request(workspace, path, init);
    };
    const { publisher } = setup('', { ...notion, request });
    expect((await publisher.resolvePage(PAGE))?.workspace).toBe('w1');
  });

  test('returns null for a non-Notion URL or a page no connection can open', async () => {
    const { publisher } = setup('');
    expect(await publisher.resolvePage('https://example.com/x')).toBeNull();
    expect(await publisher.resolvePage('00000000-0000-0000-0000-000000000000')).toBeNull();
  });
});

describe('publish', () => {
  test('first publish to an empty page sends the body without frontmatter and stores the read-back base', async () => {
    const { publisher, bases, notion } = setup(linked('# Plan\n\nShip **now**.\n'));
    const base = await publisher.publish('notes/plan');

    expect(notion.pages.get(PAGE)).toBe('# Plan\n\nShip <b>now</b>.');
    expect(base).toEqual({
      page: PAGE,
      workspace: 'w1',
      docName: 'notes/plan',
      markdown: '# Plan\n\nShip <b>now</b>.',
      publishedAt: '2026-11-18T00:00:00.000Z',
    });
    expect(bases.get(PAGE)).toEqual(base);
  });

  test('a republish after only OK changed goes through, comparing against the Notion-normalized base', async () => {
    const { publisher, docs, notion } = setup(linked('Ship **now**.\n'));
    await publisher.publish('notes/plan');
    docs.set('notes/plan', linked('Ship **now**.\n\nAnd more.\n'));
    await publisher.publish('notes/plan');
    expect(notion.pages.get(PAGE)).toBe('Ship <b>now</b>.\n\nAnd more.');
  });

  test('refuses a first publish over a page that already has content unless told to overwrite', async () => {
    const notion = fakeNotion('Existing Notion text');
    const { publisher } = setup(linked('Mine\n'), notion);
    expect(await failureOf(publisher.publish('notes/plan'))).toBe('page-not-empty');
    expect(notion.pages.get(PAGE)).toBe('Existing Notion text');
    await publisher.publish('notes/plan', { overwrite: true });
    expect(notion.pages.get(PAGE)).toBe('Mine');
  });

  test('refuses when the page changed in Notion since the last publish', async () => {
    const { publisher, notion } = setup(linked('Mine\n'));
    await publisher.publish('notes/plan');
    notion.pages.set(PAGE, 'Mine\n\nEdited in Notion');
    expect(await failureOf(publisher.publish('notes/plan'))).toBe('changed-in-notion');
    await publisher.publish('notes/plan', { overwrite: true });
    expect(notion.pages.get(PAGE)).toBe('Mine');
  });

  test('a renamed document finds its base through the page id', async () => {
    const { publisher, docs } = setup(linked('Mine\n'));
    await publisher.publish('notes/plan');
    docs.set('moved/plan', docs.get('notes/plan') as string);
    docs.delete('notes/plan');
    const base = await publisher.publish('moved/plan');
    expect(base.docName).toBe('moved/plan');
  });

  test('reports a missing doc, an unlinked doc, and a Notion error', async () => {
    const { publisher, docs } = setup('---\ntitle: x\n---\nbody\n');
    expect(await failureOf(publisher.publish('missing'))).toBe('doc-not-found');
    expect(await failureOf(publisher.publish('notes/plan'))).toBe('not-linked');
    docs.set('notes/plan', linked('x').replace('workspace: w1', 'workspace: w0'));
    expect(await failureOf(publisher.publish('notes/plan'))).toBe('notion-error');
  });

  test('refuses to compare against a page Notion returned only partly', async () => {
    const notion = fakeNotion('');
    const request: NotionConnections['request'] = async (workspace, path, init) =>
      path.includes('/markdown') && !init?.method
        ? Response.json({ markdown: '', truncated: true, unknown_block_ids: [] })
        : notion.request(workspace, path, init);
    const { publisher } = setup(linked('Mine\n'), { ...notion, request });
    expect(await failureOf(publisher.publish('notes/plan'))).toBe('page-unreadable');
  });
});
