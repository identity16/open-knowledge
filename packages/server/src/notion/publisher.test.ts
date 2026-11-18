import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { createNotionBaseStore } from './base-store.ts';
import type { NotionConnections } from './notion-connections.ts';
import {
  createNotionPublisher,
  type NotionConflictStages,
  NotionPublishError,
} from './publisher.ts';

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
  const conflicts = new Map<string, NotionConflictStages>();
  const bases = createNotionBaseStore(join(dir, 'notion'));
  const publisher = createNotionPublisher({
    writeDocSource: (name, source) => {
      docs.set(name, source);
    },
    isInConflict: (name) => conflicts.has(name),
    raiseConflict: (name, stages) => {
      conflicts.set(name, stages);
    },
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
  return { publisher, bases, docs, notion, conflicts };
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
      mergedFromNotion: false,
    });
    const { mergedFromNotion: _merged, ...stored } = base;
    expect(bases.get(PAGE)).toEqual(stored);
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

  test('an overwrite replaces whatever Notion holds without comparing', async () => {
    const { publisher, notion } = setup(linked('Mine\n'));
    await publisher.publish('notes/plan');
    notion.pages.set(PAGE, 'Mine\n\nEdited in Notion');
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

describe('merging Notion edits', () => {
  const doc = (body: string) => linked(body);

  test('edits on different lines merge into the document and the merged text is published', async () => {
    const { publisher, notion, docs } = setup(doc('Alpha\n\nBeta\n\nGamma\n'));
    await publisher.publish('notes/plan');
    notion.pages.set(PAGE, 'Alpha\n\nBeta\n\nGamma from Notion');
    docs.set('notes/plan', doc('Alpha from OK\n\nBeta\n\nGamma\n'));

    const result = await publisher.publish('notes/plan');

    expect(result.mergedFromNotion).toBe(true);
    expect(notion.pages.get(PAGE)).toBe('Alpha from OK\n\nBeta\n\nGamma from Notion');
    expect(docs.get('notes/plan')).toBe(doc('Alpha from OK\n\nBeta\n\nGamma from Notion\n'));
  });

  test('bold read back as <b> is not mistaken for a Notion edit', async () => {
    const { publisher, notion } = setup(doc('Ship **now**.\n'));
    await publisher.publish('notes/plan');
    expect(notion.pages.get(PAGE)).toBe('Ship <b>now</b>.');
    const again = await publisher.publish('notes/plan');
    expect(again.mergedFromNotion).toBe(false);
  });

  test('edits to the same line raise a Notion conflict with full-document stages and stop', async () => {
    const { publisher, notion, docs, conflicts, bases } = setup(doc('Alpha\n'));
    await publisher.publish('notes/plan');
    notion.pages.set(PAGE, 'Alpha <b>from</b> Notion');
    docs.set('notes/plan', doc('Alpha from OK\n'));

    expect(await failureOf(publisher.publish('notes/plan'))).toBe('changed-in-notion');
    expect(notion.pages.get(PAGE)).toBe('Alpha <b>from</b> Notion');
    expect(conflicts.get('notes/plan')).toEqual({
      base: doc('Alpha\n'),
      ours: doc('Alpha from OK\n'),
      theirs: doc('Alpha **from** Notion\n'),
    });
    expect(bases.get(PAGE)?.pendingTheirs).toBe('Alpha <b>from</b> Notion');
  });

  test('while the conflict is open, publish and pull refuse without raising it again', async () => {
    const { publisher, notion, docs, conflicts } = setup(doc('Alpha\n'));
    await publisher.publish('notes/plan');
    notion.pages.set(PAGE, 'Alpha in Notion');
    docs.set('notes/plan', doc('Alpha in OK\n'));
    await failureOf(publisher.publish('notes/plan'));
    conflicts.set('notes/plan', { base: 'x', ours: 'x', theirs: 'x' });
    expect(await failureOf(publisher.publish('notes/plan'))).toBe('changed-in-notion');
    expect(await failureOf(publisher.pull('notes/plan'))).toBe('changed-in-notion');
    expect(conflicts.get('notes/plan')?.base).toBe('x');
  });

  test('after the conflict is resolved, publish sends the resolved text and clears the pending side', async () => {
    const { publisher, notion, docs, conflicts, bases } = setup(doc('Alpha\n'));
    await publisher.publish('notes/plan');
    notion.pages.set(PAGE, 'Alpha in Notion');
    docs.set('notes/plan', doc('Alpha in OK\n'));
    await failureOf(publisher.publish('notes/plan'));

    docs.set('notes/plan', doc('Alpha in OK and Notion\n'));
    conflicts.delete('notes/plan');
    const result = await publisher.publish('notes/plan');

    expect(result.mergedFromNotion).toBe(false);
    expect(notion.pages.get(PAGE)).toBe('Alpha in OK and Notion');
    expect(bases.get(PAGE)?.pendingTheirs).toBeUndefined();
  });

  test('pull brings Notion edits into the document without publishing', async () => {
    const { publisher, notion, docs, bases } = setup(doc('Alpha\n\nBeta\n'));
    await publisher.publish('notes/plan');
    notion.pages.set(PAGE, 'Alpha\n\nBeta\n\nAdded in Notion');

    expect(await publisher.pull('notes/plan')).toEqual({ outcome: 'merged' });
    expect(docs.get('notes/plan')).toBe(doc('Alpha\n\nBeta\n\nAdded in Notion\n'));
    expect(bases.get(PAGE)?.markdown).toBe('Alpha\n\nBeta\n\nAdded in Notion');
    expect(await publisher.pull('notes/plan')).toEqual({ outcome: 'unchanged' });
    const next = await publisher.publish('notes/plan');
    expect(next.mergedFromNotion).toBe(false);
  });

  test('pull refuses a document that was never published', async () => {
    const { publisher } = setup(doc('Alpha\n'));
    expect(await failureOf(publisher.pull('notes/plan'))).toBe('not-published');
  });
});
