import {
  challengeFor,
  isWellFormedVerifier,
  parseHandoffState,
  sameString,
} from './handoff-state.ts';

export const NOTION_TOKEN_URL = 'https://api.notion.com/v1/oauth/token';
export const NOTION_REVOKE_URL = 'https://api.notion.com/v1/oauth/revoke';
export const NOTION_VERSION = '2026-03-11';
export const GRANT_TTL_SECONDS = 300;

export interface GrantStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options: { expirationTtl: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface WorkerEnv {
  readonly NOTION_CLIENT_ID: string;
  readonly NOTION_CLIENT_SECRET: string;
  readonly NOTION_REDIRECT_URI: string;
  readonly GRANTS: GrantStore;
}

export type StoredGrant =
  | { readonly status: 'granted'; readonly token: unknown }
  | { readonly status: 'denied'; readonly error: string }
  | { readonly status: 'failed'; readonly notionStatus: number; readonly body: unknown };

type Fetch = (input: string, init: RequestInit) => Promise<Response>;

export function createWorker(fetchImpl: Fetch) {
  return {
    async fetch(request: Request, env: WorkerEnv): Promise<Response> {
      const url = new URL(request.url);
      if (url.pathname === '/oauth/notion/callback' && request.method === 'GET')
        return handleCallback(url, env, fetchImpl);
      if (url.pathname === '/oauth/notion/redeem' && request.method === 'POST')
        return handleRedeem(request, env);
      if (url.pathname === '/oauth/notion/refresh' && request.method === 'POST')
        return handleRefresh(request, env, fetchImpl);
      if (url.pathname === '/oauth/notion/revoke' && request.method === 'POST')
        return handleRevoke(request, env, fetchImpl);
      return json({ error: 'not_found' }, 404);
    },
  };
}

async function handleCallback(url: URL, env: WorkerEnv, fetchImpl: Fetch): Promise<Response> {
  const state = url.searchParams.get('state') ?? '';
  if (parseHandoffState(state) === null) return page(400, 'This sign-in link is not valid.');
  const key = grantKey(state);
  if ((await env.GRANTS.get(key)) !== null) return page(409, 'This sign-in was already completed.');

  const error = url.searchParams.get('error');
  if (error !== null) {
    await storeGrant(env, key, { status: 'denied', error });
    return page(200, 'Notion was not connected. You can close this window.');
  }

  const code = url.searchParams.get('code');
  if (code === null || code === '')
    return page(400, 'Notion did not return an authorization code.');

  const response = await fetchImpl(NOTION_TOKEN_URL, {
    method: 'POST',
    headers: notionHeaders(env),
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      redirect_uri: env.NOTION_REDIRECT_URI,
    }),
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    await storeGrant(env, key, { status: 'failed', notionStatus: response.status, body });
    return page(502, 'Notion refused the connection. Return to OpenKnowledge and try again.');
  }
  await storeGrant(env, key, { status: 'granted', token: body });
  return page(200, 'Notion is connected. You can close this window and return to OpenKnowledge.');
}

async function handleRedeem(request: Request, env: WorkerEnv): Promise<Response> {
  const input = await readJson(request);
  const state = typeof input?.state === 'string' ? input.state : '';
  const verifier = typeof input?.verifier === 'string' ? input.verifier : '';
  const parsed = parseHandoffState(state);
  if (parsed === null || !isWellFormedVerifier(verifier))
    return json({ error: 'invalid_request' }, 400);
  if (!sameString(await challengeFor(verifier), parsed.challenge))
    return json({ error: 'invalid_verifier' }, 403);

  const key = grantKey(state);
  const stored = await env.GRANTS.get(key);
  if (stored === null) return json({ status: 'pending' }, 202);
  await env.GRANTS.delete(key);
  return json(JSON.parse(stored) as StoredGrant, 200);
}

async function handleRefresh(
  request: Request,
  env: WorkerEnv,
  fetchImpl: Fetch,
): Promise<Response> {
  const input = await readJson(request);
  const refreshToken = typeof input?.refresh_token === 'string' ? input.refresh_token : '';
  if (refreshToken === '') return json({ error: 'invalid_request' }, 400);
  const response = await fetchImpl(NOTION_TOKEN_URL, {
    method: 'POST',
    headers: notionHeaders(env),
    body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: refreshToken }),
  });
  const body: unknown = await response.json().catch(() => null);
  return json(body, response.status);
}

async function handleRevoke(request: Request, env: WorkerEnv, fetchImpl: Fetch): Promise<Response> {
  const input = await readJson(request);
  const token = typeof input?.token === 'string' ? input.token : '';
  if (token === '') return json({ error: 'invalid_request' }, 400);
  const response = await fetchImpl(NOTION_REVOKE_URL, {
    method: 'POST',
    headers: { ...notionHeaders(env), 'Notion-Version': NOTION_VERSION },
    body: JSON.stringify({ token }),
  });
  const body: unknown = await response.json().catch(() => null);
  return json(body, response.status);
}

function grantKey(state: string): string {
  return `grant:${state}`;
}

function storeGrant(env: WorkerEnv, key: string, grant: StoredGrant): Promise<void> {
  return env.GRANTS.put(key, JSON.stringify(grant), { expirationTtl: GRANT_TTL_SECONDS });
}

function notionHeaders(env: WorkerEnv): Record<string, string> {
  const credentials = btoa(`${env.NOTION_CLIENT_ID}:${env.NOTION_CLIENT_SECRET}`);
  return {
    Authorization: `Basic ${credentials}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  const value: unknown = await request.json().catch(() => null);
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function json(value: unknown, status: number): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function page(status: number, message: string): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>OpenKnowledge</title></head><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;line-height:1.5"><p>${message}</p></body></html>`;
  return new Response(html, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
      'Referrer-Policy': 'no-referrer',
    },
  });
}
