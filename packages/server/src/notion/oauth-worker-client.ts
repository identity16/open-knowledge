import { NOTION_OAUTH_WORKER_URL } from '@inkeep/open-knowledge-core';
import type { Dispatcher } from 'undici';

const WORKER_TIMEOUT_MS = 15_000;

export interface NotionTokenGrant {
  readonly accessToken: string;
  readonly refreshToken: string | null;
  readonly workspaceId: string;
  readonly workspaceName: string;
  readonly workspaceIcon: string | null;
}

export type NotionRedeemResult =
  | { readonly status: 'pending' }
  | { readonly status: 'granted'; readonly grant: NotionTokenGrant }
  | { readonly status: 'denied' }
  | { readonly status: 'failed'; readonly detail: string };

export type NotionRefreshResult =
  | { readonly status: 'refreshed'; readonly grant: NotionTokenGrant }
  | { readonly status: 'rejected' };

export class NotionWorkerUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'NotionWorkerUnavailableError';
  }
}

export interface NotionOAuthWorkerClient {
  redeem(state: string, verifier: string): Promise<NotionRedeemResult>;
  refresh(refreshToken: string): Promise<NotionRefreshResult>;
  revoke(accessToken: string): Promise<void>;
}

export function createNotionOAuthWorkerClient(opts: {
  fetchImpl?: typeof fetch;
  dispatcher?: Dispatcher;
  origin?: string;
}): NotionOAuthWorkerClient {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const origin = opts.origin ?? NOTION_OAUTH_WORKER_URL;

  async function post(path: string, body: unknown): Promise<{ status: number; json: unknown }> {
    const init = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(WORKER_TIMEOUT_MS),
      dispatcher: opts.dispatcher,
    };
    let response: Response;
    try {
      response = await fetchImpl(`${origin}${path}`, init as RequestInit);
    } catch (cause) {
      throw new NotionWorkerUnavailableError(`Notion OAuth worker unreachable: ${path}`, { cause });
    }
    if (response.status >= 500)
      throw new NotionWorkerUnavailableError(`Notion OAuth worker answered ${response.status}`);
    return { status: response.status, json: await response.json().catch(() => null) };
  }

  return {
    async redeem(state, verifier) {
      const { status, json } = await post('/oauth/notion/redeem', { state, verifier });
      if (status === 202) return { status: 'pending' };
      if (status !== 200) return { status: 'failed', detail: `redeem answered ${status}` };
      const body = asRecord(json);
      if (body.status === 'denied') return { status: 'denied' };
      if (body.status === 'failed') return { status: 'failed', detail: 'Notion refused the code' };
      const grant = body.status === 'granted' ? parseGrant(body.token) : null;
      return grant
        ? { status: 'granted', grant }
        : { status: 'failed', detail: 'Notion returned an unreadable token' };
    },
    async refresh(refreshToken) {
      const { status, json } = await post('/oauth/notion/refresh', { refresh_token: refreshToken });
      const grant = status === 200 ? parseGrant(json) : null;
      return grant ? { status: 'refreshed', grant } : { status: 'rejected' };
    },
    async revoke(accessToken) {
      await post('/oauth/notion/revoke', { token: accessToken });
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

export function parseGrant(value: unknown): NotionTokenGrant | null {
  const body = asRecord(value);
  const str = (key: string) =>
    typeof body[key] === 'string' && body[key] !== '' ? (body[key] as string) : null;
  const accessToken = str('access_token');
  const workspaceId = str('workspace_id');
  if (accessToken === null || workspaceId === null) return null;
  return {
    accessToken,
    refreshToken: str('refresh_token'),
    workspaceId,
    workspaceName: str('workspace_name') ?? '',
    workspaceIcon: str('workspace_icon'),
  };
}
