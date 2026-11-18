import { describe, expect, test, vi } from 'vitest';
import {
  createNotionOAuthWorkerClient,
  NotionWorkerUnavailableError,
} from './oauth-worker-client.ts';

const token = {
  access_token: 'a1',
  refresh_token: 'r1',
  workspace_id: 'w1',
  workspace_name: 'Joon',
  workspace_icon: null,
  bot_id: 'b1',
};

function client(respond: (path: string, body: unknown) => Response | Promise<Response>) {
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) =>
    respond(new URL(String(url)).pathname, JSON.parse(String(init?.body))),
  );
  return {
    fetchImpl,
    worker: createNotionOAuthWorkerClient({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      origin: 'https://worker.test',
    }),
  };
}

describe('redeem', () => {
  test('maps the worker answers to pending, granted, denied and failed', async () => {
    const answers = [
      Response.json({ status: 'pending' }, { status: 202 }),
      Response.json({ status: 'granted', token }),
      Response.json({ status: 'denied', error: 'access_denied' }),
      Response.json({ status: 'failed', notionStatus: 400, body: {} }),
      Response.json({ error: 'invalid_verifier' }, { status: 403 }),
    ];
    const { worker, fetchImpl } = client(() => answers.shift() as Response);
    expect(await worker.redeem('s', 'v')).toEqual({ status: 'pending' });
    expect(await worker.redeem('s', 'v')).toEqual({
      status: 'granted',
      grant: {
        accessToken: 'a1',
        refreshToken: 'r1',
        workspaceId: 'w1',
        workspaceName: 'Joon',
        workspaceIcon: null,
      },
    });
    expect(await worker.redeem('s', 'v')).toEqual({ status: 'denied' });
    expect((await worker.redeem('s', 'v')).status).toBe('failed');
    expect((await worker.redeem('s', 'v')).status).toBe('failed');
    expect(fetchImpl.mock.calls[0]?.[1]?.body).toBe(JSON.stringify({ state: 's', verifier: 'v' }));
  });

  test('a grant without an access token is a failure, not a connection', async () => {
    const { worker } = client(() =>
      Response.json({ status: 'granted', token: { workspace_id: 'w1' } }),
    );
    expect((await worker.redeem('s', 'v')).status).toBe('failed');
  });

  test('network errors and 5xx answers raise WorkerUnavailable so callers can retry', async () => {
    const down = client(() => {
      throw new TypeError('fetch failed');
    });
    await expect(down.worker.redeem('s', 'v')).rejects.toBeInstanceOf(NotionWorkerUnavailableError);
    const broken = client(() => new Response('oops', { status: 502 }));
    await expect(broken.worker.redeem('s', 'v')).rejects.toBeInstanceOf(
      NotionWorkerUnavailableError,
    );
  });
});

describe('refresh and revoke', () => {
  test('refresh returns the rotated grant or rejected', async () => {
    const answers = [
      Response.json({ ...token, access_token: 'a2' }),
      Response.json({ error: 'invalid_grant' }, { status: 400 }),
    ];
    const { worker, fetchImpl } = client(() => answers.shift() as Response);
    const ok = await worker.refresh('r1');
    expect(ok.status === 'refreshed' && ok.grant.accessToken).toBe('a2');
    expect(await worker.refresh('r1')).toEqual({ status: 'rejected' });
    expect(fetchImpl.mock.calls[0]?.[1]?.body).toBe(JSON.stringify({ refresh_token: 'r1' }));
  });

  test('revoke posts the access token', async () => {
    const { worker, fetchImpl } = client(() => Response.json({ request_id: 'x' }));
    await worker.revoke('a1');
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe('https://worker.test/oauth/notion/revoke');
    expect(fetchImpl.mock.calls[0]?.[1]?.body).toBe(JSON.stringify({ token: 'a1' }));
  });
});
