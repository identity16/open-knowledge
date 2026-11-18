import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  NOTION_API_ORIGIN,
  NOTION_API_VERSION,
  NOTION_OAUTH_AUTHORIZE_URL,
  NOTION_OAUTH_CLIENT_ID,
  NOTION_OAUTH_REDIRECT_URI,
  type NotionConnectFlowStatus,
  type NotionWorkspaceConnection,
} from '@inkeep/open-knowledge-core';
import type { Dispatcher } from 'undici';
import type { PinoLogger } from '../logger.ts';
import type { NotionConnectionRegistry } from './connection-registry.ts';
import type { NotionOAuthWorkerClient, NotionTokenGrant } from './oauth-worker-client.ts';
import type { NotionTokenStore } from './token-store.ts';

export const NOTION_CONNECT_FLOW_TTL_MS = 5 * 60_000;
export const NOTION_CONNECT_POLL_MS = 2_000;
const FINISHED_FLOW_RETENTION_MS = 10 * 60_000;

interface Flow {
  readonly state: string;
  readonly verifier: string;
  readonly expiresAt: number;
  status: NotionConnectFlowStatus;
  finishedAt: number | null;
  timer: ReturnType<typeof setTimeout> | null;
}

export class NotionNotConnectedError extends Error {
  readonly workspaceId: string;

  constructor(workspaceId: string) {
    super(`Notion workspace ${workspaceId} is not connected`);
    this.name = 'NotionNotConnectedError';
    this.workspaceId = workspaceId;
  }
}

export interface NotionConnectionsDeps {
  readonly registry: NotionConnectionRegistry;
  readonly tokens: NotionTokenStore;
  readonly worker: NotionOAuthWorkerClient;
  readonly log: PinoLogger;
  readonly fetchImpl?: typeof fetch;
  readonly dispatcher?: Dispatcher;
  readonly now?: () => number;
  readonly pollMs?: number;
}

export interface NotionConnections {
  list(): NotionWorkspaceConnection[];
  startConnect(): { flowId: string; authorizeUrl: string };
  flowStatus(flowId: string): NotionConnectFlowStatus | null;
  disconnect(workspaceId: string): Promise<{ removed: boolean; revoked: boolean }>;
  request(workspaceId: string, path: string, init?: RequestInit): Promise<Response>;
  dispose(): void;
}

function base64Url(bytes: Buffer): string {
  return bytes.toString('base64url');
}

export function createNotionConnections(deps: NotionConnectionsDeps): NotionConnections {
  const now = deps.now ?? Date.now;
  const pollMs = deps.pollMs ?? NOTION_CONNECT_POLL_MS;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const flows = new Map<string, Flow>();
  let disposed = false;

  function prune(): void {
    for (const [id, flow] of flows) {
      if (flow.finishedAt !== null && now() - flow.finishedAt > FINISHED_FLOW_RETENTION_MS)
        flows.delete(id);
    }
  }

  function finish(flow: Flow, status: NotionConnectFlowStatus): void {
    flow.status = status;
    flow.finishedAt = now();
    if (flow.timer) clearTimeout(flow.timer);
    flow.timer = null;
  }

  async function saveGrant(grant: NotionTokenGrant): Promise<NotionWorkspaceConnection> {
    await deps.tokens.set(grant.workspaceId, {
      accessToken: grant.accessToken,
      refreshToken: grant.refreshToken,
    });
    const connection: NotionWorkspaceConnection = {
      workspaceId: grant.workspaceId,
      workspaceName: grant.workspaceName,
      workspaceIcon: grant.workspaceIcon,
      connectedAt: new Date(now()).toISOString(),
    };
    deps.registry.upsert(connection);
    return connection;
  }

  async function poll(flow: Flow): Promise<void> {
    flow.timer = null;
    if (disposed || flow.finishedAt !== null) return;
    if (now() >= flow.expiresAt) {
      finish(flow, { status: 'expired' });
      return;
    }
    try {
      const result = await deps.worker.redeem(flow.state, flow.verifier);
      if (result.status === 'granted') {
        finish(flow, { status: 'connected', workspace: await saveGrant(result.grant) });
        return;
      }
      if (result.status === 'denied') return finish(flow, { status: 'denied' });
      if (result.status === 'failed')
        return finish(flow, { status: 'failed', detail: result.detail });
    } catch (err) {
      deps.log.warn({ err }, '[notion] connect poll failed; retrying');
    }
    if (disposed || flow.finishedAt !== null) return;
    flow.timer = setTimeout(() => void poll(flow), pollMs);
    flow.timer.unref?.();
  }

  async function refreshTokens(workspaceId: string): Promise<string | null> {
    const stored = await deps.tokens.get(workspaceId);
    if (!stored?.refreshToken) return null;
    const result = await deps.worker.refresh(stored.refreshToken);
    if (result.status !== 'refreshed') return null;
    await deps.tokens.set(workspaceId, {
      accessToken: result.grant.accessToken,
      refreshToken: result.grant.refreshToken ?? stored.refreshToken,
    });
    return result.grant.accessToken;
  }

  return {
    list: () => deps.registry.list(),

    startConnect() {
      prune();
      const verifier = base64Url(randomBytes(32));
      const challenge = base64Url(createHash('sha256').update(verifier).digest());
      const state = `${base64Url(randomBytes(32))}.${challenge}`;
      const flowId = randomUUID();
      const flow: Flow = {
        state,
        verifier,
        expiresAt: now() + NOTION_CONNECT_FLOW_TTL_MS,
        status: { status: 'pending' },
        finishedAt: null,
        timer: null,
      };
      flows.set(flowId, flow);
      flow.timer = setTimeout(() => void poll(flow), pollMs);
      flow.timer.unref?.();
      const params = new URLSearchParams({
        client_id: NOTION_OAUTH_CLIENT_ID,
        response_type: 'code',
        owner: 'user',
        redirect_uri: NOTION_OAUTH_REDIRECT_URI,
        state,
      });
      return { flowId, authorizeUrl: `${NOTION_OAUTH_AUTHORIZE_URL}?${params.toString()}` };
    },

    flowStatus(flowId) {
      const flow = flows.get(flowId);
      if (!flow) return null;
      if (flow.finishedAt === null && now() >= flow.expiresAt) finish(flow, { status: 'expired' });
      return flow.status;
    },

    async disconnect(workspaceId) {
      const stored = await deps.tokens.get(workspaceId);
      let revoked = false;
      if (stored) {
        try {
          await deps.worker.revoke(stored.accessToken);
          revoked = true;
        } catch (err) {
          deps.log.warn(
            { err, workspaceId },
            '[notion] revoke failed; removing the local grant anyway',
          );
        }
        await deps.tokens.clear(workspaceId);
      }
      const removed = deps.registry.remove(workspaceId);
      return { removed: removed || stored !== null, revoked };
    },

    async request(workspaceId, path, init = {}) {
      const send = (accessToken: string) => {
        const headers = new Headers(init.headers);
        headers.set('Authorization', `Bearer ${accessToken}`);
        headers.set('Notion-Version', NOTION_API_VERSION);
        if (init.body !== undefined && !headers.has('Content-Type'))
          headers.set('Content-Type', 'application/json');
        const options = { ...init, headers, dispatcher: deps.dispatcher };
        return fetchImpl(`${NOTION_API_ORIGIN}${path}`, options as RequestInit);
      };
      const stored = await deps.tokens.get(workspaceId);
      if (!stored) throw new NotionNotConnectedError(workspaceId);
      const first = await send(stored.accessToken);
      if (first.status !== 401) return first;
      const refreshed = await refreshTokens(workspaceId);
      return refreshed === null ? first : send(refreshed);
    },

    dispose() {
      disposed = true;
      for (const flow of flows.values()) if (flow.timer) clearTimeout(flow.timer);
      flows.clear();
    },
  };
}
