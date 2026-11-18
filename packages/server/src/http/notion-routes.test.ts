import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { NotionConnectFlowStatus } from '@inkeep/open-knowledge-core';
import { afterEach, describe, expect, test, vi } from 'vitest';
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
    }),
    ...overrides,
  };
}

async function serve(notion: NotionConnections, allow = true, publisher = fakePublisher()) {
  const group = createNotionRoutes({
    notion,
    publisher,
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
        '/api/notion/publish',
        '/api/notion/resolve-page',
      ].sort(),
    );
    expect(group.table.isMutating('/api/notion/publish')).toBe(true);
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
    }));
    const { post } = await serve(fakeNotion(), true, fakePublisher({ publish }));
    const res = await post('/api/notion/publish', { docName: 'notes/plan', overwrite: true });
    expect(await res.json()).toEqual({ page: 'p1', publishedAt: 't' });
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
