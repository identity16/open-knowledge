import { describe, expect, test, vi } from 'vitest';
import { base64Url, challengeFor } from './handoff-state.ts';
import {
  createWorker,
  GRANT_TTL_SECONDS,
  type GrantStore,
  NOTION_TOKEN_URL,
  type WorkerEnv,
} from './worker.ts';

const ORIGIN = 'https://ok-notion-oauth.identity16.workers.dev';

class MemoryStore implements GrantStore {
  readonly values = new Map<string, string>();
  readonly ttls = new Map<string, number>();
  async get(key: string) {
    return this.values.get(key) ?? null;
  }
  async put(key: string, value: string, options: { expirationTtl: number }) {
    this.values.set(key, value);
    this.ttls.set(key, options.expirationTtl);
  }
  async delete(key: string) {
    this.values.delete(key);
  }
}

function randomPart(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)));
}

async function newHandoff() {
  const verifier = randomPart();
  const state = `${randomPart()}.${await challengeFor(verifier)}`;
  return { verifier, state };
}

function setup(
  notion: (init: RequestInit) => Response = () => Response.json({ access_token: 'secret_a' }),
) {
  const store = new MemoryStore();
  const env: WorkerEnv = {
    NOTION_CLIENT_ID: 'client-id',
    NOTION_CLIENT_SECRET: 'client-secret',
    NOTION_REDIRECT_URI: `${ORIGIN}/oauth/notion/callback`,
    GRANTS: store,
  };
  const fetchImpl = vi.fn(async (_input: string, init: RequestInit) => notion(init));
  const worker = createWorker(fetchImpl);
  const call = (path: string, init?: RequestInit) =>
    worker.fetch(new Request(`${ORIGIN}${path}`, init), env);
  const redeem = (body: unknown) =>
    call('/oauth/notion/redeem', { method: 'POST', body: JSON.stringify(body) });
  return { store, fetchImpl, call, redeem };
}

describe('callback', () => {
  test('exchanges the code with the client secret and parks the token for the state', async () => {
    const { store, fetchImpl, call } = setup();
    const { state } = await newHandoff();

    const response = await call(`/oauth/notion/callback?code=abc&state=${state}`);

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('Notion is connected');
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe(NOTION_TOKEN_URL);
    expect(new Headers(init?.headers).get('Authorization')).toBe(
      `Basic ${btoa('client-id:client-secret')}`,
    );
    expect(JSON.parse(String(init?.body))).toEqual({
      grant_type: 'authorization_code',
      code: 'abc',
      redirect_uri: `${ORIGIN}/oauth/notion/callback`,
    });
    expect(JSON.parse(store.values.get(`grant:${state}`) ?? 'null')).toEqual({
      status: 'granted',
      token: { access_token: 'secret_a' },
    });
    expect(store.ttls.get(`grant:${state}`)).toBe(GRANT_TTL_SECONDS);
  });

  test('records a declined authorization without calling Notion', async () => {
    const { store, fetchImpl, call } = setup();
    const { state } = await newHandoff();

    const response = await call(`/oauth/notion/callback?error=access_denied&state=${state}`);

    expect(response.status).toBe(200);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(JSON.parse(store.values.get(`grant:${state}`) ?? 'null')).toEqual({
      status: 'denied',
      error: 'access_denied',
    });
  });

  test('records a refused exchange so the waiting server can stop polling', async () => {
    const { store, call } = setup(() => Response.json({ error: 'invalid_grant' }, { status: 400 }));
    const { state } = await newHandoff();

    const response = await call(`/oauth/notion/callback?code=stale&state=${state}`);

    expect(response.status).toBe(502);
    expect(JSON.parse(store.values.get(`grant:${state}`) ?? 'null')).toEqual({
      status: 'failed',
      notionStatus: 400,
      body: { error: 'invalid_grant' },
    });
  });

  test('refuses a malformed state and a state that already completed', async () => {
    const { fetchImpl, call } = setup();
    const { state } = await newHandoff();

    expect((await call('/oauth/notion/callback?code=abc&state=nope')).status).toBe(400);
    await call(`/oauth/notion/callback?code=abc&state=${state}`);
    expect((await call(`/oauth/notion/callback?code=again&state=${state}`)).status).toBe(409);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('redeem', () => {
  test('is pending until the callback lands, then hands the grant over exactly once', async () => {
    const { call, redeem } = setup();
    const { state, verifier } = await newHandoff();

    const pending = await redeem({ state, verifier });
    expect(pending.status).toBe(202);
    expect(await pending.json()).toEqual({ status: 'pending' });

    await call(`/oauth/notion/callback?code=abc&state=${state}`);

    const granted = await redeem({ state, verifier });
    expect(granted.status).toBe(200);
    expect(await granted.json()).toEqual({
      status: 'granted',
      token: { access_token: 'secret_a' },
    });
    expect((await redeem({ state, verifier })).status).toBe(202);
  });

  test('refuses a verifier that does not hash to the state challenge', async () => {
    const { call, redeem, store } = setup();
    const { state } = await newHandoff();
    await call(`/oauth/notion/callback?code=abc&state=${state}`);

    const response = await redeem({ state, verifier: randomPart() });

    expect(response.status).toBe(403);
    expect(store.values.has(`grant:${state}`)).toBe(true);
  });

  test('rejects a request without a well-formed state and verifier', async () => {
    const { redeem } = setup();
    expect((await redeem({ state: 'x', verifier: 'y' })).status).toBe(400);
    expect((await redeem(null)).status).toBe(400);
  });
});

describe('refresh', () => {
  test('forwards the refresh token with the client secret and relays Notion’s answer', async () => {
    const { fetchImpl, call } = setup(() =>
      Response.json({ access_token: 'secret_b' }, { status: 200 }),
    );

    const response = await call('/oauth/notion/refresh', {
      method: 'POST',
      body: JSON.stringify({ refresh_token: 'refresh_a' }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ access_token: 'secret_b' });
    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))).toEqual({
      grant_type: 'refresh_token',
      refresh_token: 'refresh_a',
    });
  });

  test('relays a refusal status unchanged', async () => {
    const { call } = setup(() => Response.json({ error: 'invalid_grant' }, { status: 400 }));
    const response = await call('/oauth/notion/refresh', {
      method: 'POST',
      body: JSON.stringify({ refresh_token: 'revoked' }),
    });
    expect(response.status).toBe(400);
  });
});

test('answers unknown routes with 404', async () => {
  const { call } = setup();
  expect((await call('/')).status).toBe(404);
  expect((await call('/oauth/notion/callback', { method: 'POST' })).status).toBe(404);
});
