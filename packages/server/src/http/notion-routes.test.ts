import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { NotionConnectFlowStatus } from '@inkeep/open-knowledge-core';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { NotionDiscussions } from '../notion/discussions.ts';
import type { NotionConnections } from '../notion/notion-connections.ts';
import { NotionPublishError, type NotionPublisher } from '../notion/publisher.ts';
import { NotionTokenStoreError } from '../notion/token-store.ts';
import { createNotionRoutes } from './notion-routes.ts';

const joon = {
  workspaceId: 'w1',
  workspaceName: 'Joon',
  workspaceIcon: null,
  connectedAt: '2026-11-18T00:00:00.000Z',
};

function fakeNotion(overrides: Partial<NotionConnections> = {}): NotionConnections {
  return {
    list: () => [joon],
    startConnect: () => ({
      flowId: 'f1',
      authorizeUrl: 'https://api.notion.com/v1/oauth/authorize?x=1',
    }),
    flowStatus: (id): NotionConnectFlowStatus | null =>
      id === 'f1' ? { status: 'pending' } : null,
    disconnect: vi.fn(async () => ({ removed: true, revoked: true })),
    request: vi.fn(),
    dispose: () => {},
    ...overrides,
  };
}

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});

function fakePublisher(overrides: Partial<NotionPublisher> = {}): NotionPublisher {
  return {
    resolvePage: async (url) =>
      url.includes('known') ? { page: 'p1', workspace: 'w1', title: 'Plan' } : null,
    publish: async (docName) => ({
      page: 'p1',
      workspace: 'w1',
      docName,
      markdown: 'x',
      publishedAt: '2026-11-18T00:00:00.000Z',
      mergedFromNotion: false,
    }),
    pull: async () => ({ outcome: 'merged' }),
    ...overrides,
  };
}

function fakeDiscussions(overrides: Partial<NotionDiscussions> = {}): NotionDiscussions {
  return {
    list: async () => ({
      page: 'p1',
      complete: true,
      discussions: [
        {
          id: 'd1',
          anchor: { kind: 'block', blockId: 'b1', text: 'Beta line.' },
          comments: [
            { id: 'c1', author: 'Ann', createdAt: '2026-11-18T00:00:00.000Z', markdown: 'Why?' },
          ],
        },
      ],
    }),
    reply: vi.fn(async (_doc: string, _discussion: string, markdown: string) => ({
      id: 'c2',
      author: 'Joon',
      createdAt: '2026-11-19T00:00:00.000Z',
      markdown,
    })),
    ...overrides,
  };
}

async function serve(
  notion: NotionConnections,
  allow = true,
  publisher = fakePublisher(),
  discussions = fakeDiscussions(),
) {
  const group = createNotionRoutes({
    notion,
    publisher,
    discussions,
    checkLocalOpSecurity: (_req, res) => {
      if (allow) return true;
      res.writeHead(403).end();
      return false;
    },
  });
  const server = createServer((req, res) => {
    const dispatch = group.table.resolve(new URL(req.url ?? '', 'http://x').pathname)?.dispatch;
    if (dispatch) void dispatch(req, res);
    else res.writeHead(404).end();
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    group,
    call: (path: string, init?: RequestInit) => fetch(`${base}${path}`, init),
    post: (path: string, body: unknown) =>
      fetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
  };
}

describe('createNotionRoutes table', () => {
  test('registers the Notion paths; only reads of connections and flows are non-mutating', async () => {
    const { group } = await serve(fakeNotion());
    expect([...group.paths].sort()).toEqual(
      [
        '/api/notion/connections',
        '/api/notion/connections/disconnect',
        '/api/notion/connections/flow',
        '/api/notion/connections/start',
        '/api/notion/discussions',
        '/api/notion/discussions/reply',
        '/api/notion/publish',
        '/api/notion/pull',
        '/api/notion/resolve-page',
      ].sort(),
    );
    expect(group.table.isMutating('/api/notion/publish')).toBe(true);
    expect(group.table.isMutating('/api/notion/discussions/reply')).toBe(true);
    expect(group.table.isMutating('/api/notion/discussions')).toBe(false);
    expect(group.table.isMutating('/api/notion/resolve-page')).toBe(true);
    expect(group.table.isMutating('/api/notion/connections/start')).toBe(true);
    expect(group.table.isMutating('/api/notion/connections/disconnect')).toBe(true);
    expect(group.table.isMutating('/api/notion/connections')).toBe(false);
  });
});

describe('handlers', () => {
  test('lists connections without caching', async () => {
    const { call } = await serve(fakeNotion());
    const res = await call('/api/notion/connections');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ connections: [joon] });
  });

  test('start returns the flow id and authorize URL', async () => {
    const { post } = await serve(fakeNotion());
    const res = await post('/api/notion/connections/start', {});
    expect(await res.json()).toEqual({
      flowId: 'f1',
      authorizeUrl: 'https://api.notion.com/v1/oauth/authorize?x=1',
    });
  });

  test('flow status answers a known flow and 404s an unknown one', async () => {
    const { call } = await serve(fakeNotion());
    expect(await (await call('/api/notion/connections/flow?id=f1')).json()).toEqual({
      status: 'pending',
    });
    expect((await call('/api/notion/connections/flow?id=nope')).status).toBe(404);
    expect((await call('/api/notion/connections/flow')).status).toBe(404);
  });

  test('disconnect reports revocation and 404s a workspace that was not connected', async () => {
    const disconnect = vi
      .fn<NotionConnections['disconnect']>()
      .mockResolvedValueOnce({ removed: true, revoked: false })
      .mockResolvedValueOnce({ removed: false, revoked: false });
    const { post } = await serve(fakeNotion({ disconnect }));
    const ok = await post('/api/notion/connections/disconnect', { workspaceId: 'w1' });
    expect(await ok.json()).toEqual({ workspaceId: 'w1', revoked: false });
    expect((await post('/api/notion/connections/disconnect', { workspaceId: 'w2' })).status).toBe(
      404,
    );
    expect(disconnect).toHaveBeenCalledWith('w1');
  });

  test('a keychain timeout during disconnect is a retryable 503', async () => {
    const { post } = await serve(
      fakeNotion({
        disconnect: async () => {
          throw new NotionTokenStoreError('clear', 'timeout');
        },
      }),
    );
    const res = await post('/api/notion/connections/disconnect', { workspaceId: 'w1' });
    expect(res.status).toBe(503);
    expect((await res.json()).type).toBe('urn:ok:error:notion-unavailable');
  });

  test('rejects a disconnect without a workspace id and a GET on start', async () => {
    const { post, call } = await serve(fakeNotion());
    expect((await post('/api/notion/connections/disconnect', {})).status).toBe(400);
    expect((await call('/api/notion/connections/start')).status).toBe(405);
  });

  test('every handler honors the local-op security gate', async () => {
    const { call, post } = await serve(fakeNotion(), false);
    expect((await call('/api/notion/connections')).status).toBe(403);
    expect((await call('/api/notion/connections/flow?id=f1')).status).toBe(403);
    expect((await post('/api/notion/connections/start', {})).status).toBe(403);
    expect((await post('/api/notion/connections/disconnect', { workspaceId: 'w1' })).status).toBe(
      403,
    );
    expect((await post('/api/notion/discussions', { docName: 'a' })).status).toBe(403);
    expect(
      (
        await post('/api/notion/discussions/reply', {
          docName: 'a',
          discussionId: 'd',
          markdown: 'x',
        })
      ).status,
    ).toBe(403);
  });
});

describe('resolve-page and publish', () => {
  test('resolve-page answers the link or 404s a page no connection can open', async () => {
    const { post } = await serve(fakeNotion());
    expect(await (await post('/api/notion/resolve-page', { url: 'known' })).json()).toEqual({
      page: 'p1',
      workspace: 'w1',
      title: 'Plan',
    });
    expect((await post('/api/notion/resolve-page', { url: 'other' })).status).toBe(404);
  });

  test('publish returns the page and time and passes overwrite through', async () => {
    const publish = vi.fn<NotionPublisher['publish']>(async (docName) => ({
      page: 'p1',
      workspace: 'w1',
      docName,
      markdown: 'x',
      publishedAt: 't',
      mergedFromNotion: true,
    }));
    const { post } = await serve(fakeNotion(), true, fakePublisher({ publish }));
    const res = await post('/api/notion/publish', { docName: 'notes/plan', overwrite: true });
    expect(await res.json()).toEqual({ page: 'p1', publishedAt: 't', mergedFromNotion: true });
    expect(publish).toHaveBeenCalledWith('notes/plan', { overwrite: true });
  });

  test.each([
    ['page-not-empty', 409, 'urn:ok:error:notion-page-not-empty'],
    ['changed-in-notion', 409, 'urn:ok:error:notion-changed'],
    ['doc-not-found', 404, 'urn:ok:error:doc-not-found'],
    ['not-linked', 400, 'urn:ok:error:invalid-request'],
    ['page-unreadable', 502, 'urn:ok:error:notion-unavailable'],
  ] as const)('a %s failure answers %i %s', async (kind, status, type) => {
    const publisher = fakePublisher({
      publish: async () => {
        throw new NotionPublishError({ kind } as never);
      },
    });
    const { post } = await serve(fakeNotion(), true, publisher);
    const res = await post('/api/notion/publish', { docName: 'notes/plan' });
    expect(res.status).toBe(status);
    expect((await res.json()).type).toBe(type);
  });

  test('an unexpected failure is a 502, not a crash', async () => {
    const publisher = fakePublisher({
      publish: async () => {
        throw new Error('socket hang up');
      },
    });
    const { post } = await serve(fakeNotion(), true, publisher);
    expect((await post('/api/notion/publish', { docName: 'x' })).status).toBe(502);
  });
});

describe('pull', () => {
  test('answers the merge outcome', async () => {
    const { post } = await serve(fakeNotion());
    expect(await (await post('/api/notion/pull', { docName: 'notes/plan' })).json()).toEqual({
      outcome: 'merged',
    });
  });

  test('a conflict answers 409 notion-changed and a never-published doc 400', async () => {
    const outcomes = ['changed-in-notion', 'not-published'] as const;
    const publisher = fakePublisher({
      pull: async () => {
        throw new NotionPublishError({ kind: outcomes[0] });
      },
    });
    const { post } = await serve(fakeNotion(), true, publisher);
    const res = await post('/api/notion/pull', { docName: 'notes/plan' });
    expect(res.status).toBe(409);
    expect((await res.json()).type).toBe('urn:ok:error:notion-changed');

    const never = fakePublisher({
      pull: async () => {
        throw new NotionPublishError({ kind: outcomes[1] });
      },
    });
    const second = await serve(fakeNotion(), true, never);
    expect((await second.post('/api/notion/pull', { docName: 'x' })).status).toBe(400);
  });
});

describe('discussions', () => {
  test('lists the discussions of the linked page', async () => {
    const { post } = await serve(fakeNotion());
    const res = await post('/api/notion/discussions', { docName: 'notes/plan' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.page).toBe('p1');
    expect(body.discussions[0].anchor).toEqual({
      kind: 'block',
      blockId: 'b1',
      text: 'Beta line.',
    });
  });

  test('a reply is trimmed, posted and answered with the new comment', async () => {
    const discussions = fakeDiscussions();
    const { post } = await serve(fakeNotion(), true, fakePublisher(), discussions);
    const res = await post('/api/notion/discussions/reply', {
      docName: 'notes/plan',
      discussionId: 'd1',
      markdown: '  Done  \n',
    });
    expect(res.status).toBe(200);
    expect((await res.json()).comment.markdown).toBe('Done');
    expect(discussions.reply).toHaveBeenCalledWith('notes/plan', 'd1', 'Done');
  });

  test('a blank reply is a 400 and never reaches Notion', async () => {
    const discussions = fakeDiscussions();
    const { post } = await serve(fakeNotion(), true, fakePublisher(), discussions);
    const res = await post('/api/notion/discussions/reply', {
      docName: 'notes/plan',
      discussionId: 'd1',
      markdown: '   ',
    });
    expect(res.status).toBe(400);
    expect(discussions.reply).not.toHaveBeenCalled();
  });

  test('an unlinked document is a 404 and a Notion refusal a 502', async () => {
    const unlinked = fakeDiscussions({
      list: async () => {
        throw new NotionPublishError({ kind: 'not-linked' });
      },
    });
    const first = await serve(fakeNotion(), true, fakePublisher(), unlinked);
    expect((await first.post('/api/notion/discussions', { docName: 'x' })).status).toBe(404);

    const refused = fakeDiscussions({
      reply: async () => {
        throw new NotionPublishError({ kind: 'notion-error', status: 404, message: 'gone' });
      },
    });
    const second = await serve(fakeNotion(), true, fakePublisher(), refused);
    const res = await second.post('/api/notion/discussions/reply', {
      docName: 'x',
      discussionId: 'd',
      markdown: 'hi',
    });
    expect(res.status).toBe(502);
    expect((await res.json()).type).toBe('urn:ok:error:notion-unavailable');
  });
});
