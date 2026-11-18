import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NOTION_OAUTH_CLIENT_ID, NOTION_OAUTH_REDIRECT_URI } from '@inkeep/open-knowledge-core';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { PinoLogger } from '../logger.ts';
import { createNotionConnectionRegistry } from './connection-registry.ts';
import { createNotionConnections, NotionNotConnectedError } from './notion-connections.ts';
import type {
  NotionOAuthWorkerClient,
  NotionRedeemResult,
  NotionTokenGrant,
} from './oauth-worker-client.ts';
import type { NotionTokenStore, NotionTokens } from './token-store.ts';

const grant: NotionTokenGrant = {
  accessToken: 'a1',
  refreshToken: 'r1',
  workspaceId: 'w1',
  workspaceName: 'Joon',
  workspaceIcon: null,
};

const dirs: string[] = [];
let now = Date.parse('2026-11-18T00:00:00.000Z');
beforeEach(() => {
  vi.useFakeTimers();
  now = Date.parse('2026-11-18T00:00:00.000Z');
});
afterEach(() => {
  vi.useRealTimers();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function memoryTokens(): NotionTokenStore & { values: Map<string, NotionTokens> } {
  const values = new Map<string, NotionTokens>();
  return {
    values,
    get: async (id) => values.get(id) ?? null,
    set: async (id, tokens) => {
      values.set(id, tokens);
    },
    clear: async (id) => {
      values.delete(id);
    },
  };
}

function setup(worker: Partial<NotionOAuthWorkerClient> = {}, fetchImpl?: typeof fetch) {
  const dir = mkdtempSync(join(tmpdir(), 'ok-notion-connections-'));
  dirs.push(dir);
  const registry = createNotionConnectionRegistry(join(dir, 'notion.yml'));
  const tokens = memoryTokens();
  const fullWorker: NotionOAuthWorkerClient = {
    redeem: vi.fn(async (): Promise<NotionRedeemResult> => ({ status: 'pending' })),
    refresh: vi.fn(async () => ({ status: 'rejected' as const })),
    revoke: vi.fn(async () => {}),
    ...worker,
  };
  const connections = createNotionConnections({
    registry,
    tokens,
    worker: fullWorker,
    log: new PinoLogger('notion-test', { options: { level: 'silent' } }),
    now: () => now,
    pollMs: 1000,
    ...(fetchImpl ? { fetchImpl } : {}),
  });
  return { connections, registry, tokens, worker: fullWorker };
}

async function tick(ms: number) {
  now += ms;
  await vi.advanceTimersByTimeAsync(ms);
}

describe('startConnect', () => {
  test('builds an authorize URL whose state binds a fresh verifier', () => {
    const { connections } = setup();
    const { authorizeUrl, flowId } = connections.startConnect();
    const url = new URL(authorizeUrl);
    expect(url.origin + url.pathname).toBe('https://api.notion.com/v1/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe(NOTION_OAUTH_CLIENT_ID);
    expect(url.searchParams.get('redirect_uri')).toBe(NOTION_OAUTH_REDIRECT_URI);
    expect(url.searchParams.get('owner')).toBe('user');
    expect(url.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/);
    expect(connections.flowStatus(flowId)).toEqual({ status: 'pending' });
    connections.dispose();
  });

  test('polls until granted, then stores tokens and lists the workspace', async () => {
    const redeem = vi
      .fn<NotionOAuthWorkerClient['redeem']>()
      .mockResolvedValueOnce({ status: 'pending' })
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ status: 'granted', grant });
    const { connections, tokens } = setup({ redeem });
    const { flowId } = connections.startConnect();

    await tick(1000);
    await tick(1000);
    expect(connections.flowStatus(flowId)).toEqual({ status: 'pending' });
    await tick(1000);

    const status = connections.flowStatus(flowId);
    expect(status?.status).toBe('connected');
    expect(tokens.values.get('w1')).toEqual({ accessToken: 'a1', refreshToken: 'r1' });
    expect(connections.list()).toEqual([
      {
        workspaceId: 'w1',
        workspaceName: 'Joon',
        workspaceIcon: null,
        connectedAt: '2026-11-18T00:00:03.000Z',
      },
    ]);
    await tick(5000);
    expect(redeem).toHaveBeenCalledTimes(3);
  });

  test('a declined authorization ends the flow as denied', async () => {
    const { connections } = setup({ redeem: async () => ({ status: 'denied' }) });
    const { flowId } = connections.startConnect();
    await tick(1000);
    expect(connections.flowStatus(flowId)).toEqual({ status: 'denied' });
  });

  test('a flow nobody completes expires after five minutes', async () => {
    const { connections } = setup();
    const { flowId } = connections.startConnect();
    await tick(5 * 60_000 + 1000);
    expect(connections.flowStatus(flowId)).toEqual({ status: 'expired' });
  });

  test('an unknown flow id has no status', () => {
    expect(setup().connections.flowStatus('nope')).toBeNull();
  });
});

describe('disconnect', () => {
  test('revokes, clears the tokens and removes the workspace', async () => {
    const { connections, tokens, registry, worker } = setup();
    await tokens.set('w1', { accessToken: 'a1', refreshToken: 'r1' });
    registry.upsert({ ...grant, connectedAt: 'x' });

    expect(await connections.disconnect('w1')).toEqual({ removed: true, revoked: true });
    expect(worker.revoke).toHaveBeenCalledWith('a1');
    expect(tokens.values.size).toBe(0);
    expect(connections.list()).toEqual([]);
  });

  test('still removes the local grant when the worker cannot be reached', async () => {
    const { connections, tokens, registry } = setup({
      revoke: async () => {
        throw new Error('offline');
      },
    });
    await tokens.set('w1', { accessToken: 'a1', refreshToken: null });
    registry.upsert({ ...grant, connectedAt: 'x' });
    expect(await connections.disconnect('w1')).toEqual({ removed: true, revoked: false });
    expect(tokens.values.size).toBe(0);
  });

  test('an unknown workspace reports nothing removed', async () => {
    expect(await setup().connections.disconnect('nope')).toEqual({
      removed: false,
      revoked: false,
    });
  });
});

describe('request', () => {
  test('sends the bearer token and Notion version, refreshing once on 401', async () => {
    const seen: string[] = [];
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const auth = new Headers(init?.headers).get('Authorization') ?? '';
      seen.push(`${auth} ${new Headers(init?.headers).get('Notion-Version')}`);
      return new Response(null, { status: auth === 'Bearer a2' ? 200 : 401 });
    });
    const { connections, tokens } = setup(
      {
        refresh: async () => ({
          status: 'refreshed',
          grant: { ...grant, accessToken: 'a2', refreshToken: 'r2' },
        }),
      },
      fetchImpl as unknown as typeof fetch,
    );
    await tokens.set('w1', { accessToken: 'a1', refreshToken: 'r1' });

    const response = await connections.request('w1', '/v1/users/me');

    expect(response.status).toBe(200);
    expect(seen).toEqual(['Bearer a1 2026-03-11', 'Bearer a2 2026-03-11']);
    expect(tokens.values.get('w1')).toEqual({ accessToken: 'a2', refreshToken: 'r2' });
  });

  test('returns the 401 when the refresh is rejected', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 401 }));
    const { connections, tokens } = setup({}, fetchImpl as unknown as typeof fetch);
    await tokens.set('w1', { accessToken: 'a1', refreshToken: 'r1' });
    expect((await connections.request('w1', '/v1/users/me')).status).toBe(401);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test('refuses a workspace that is not connected', async () => {
    await expect(setup().connections.request('w9', '/v1/users/me')).rejects.toBeInstanceOf(
      NotionNotConnectedError,
    );
  });
});
