import {
  type NotionConnectFlowStatus,
  NotionConnectFlowStatusSchema,
  NotionConnectionsResponseSchema,
  type NotionConnectStartResponse,
  NotionConnectStartResponseSchema,
  type NotionWorkspaceConnection,
} from '@inkeep/open-knowledge-core/schemas/api';

export interface NotionConnectionsTransport {
  list(): Promise<NotionWorkspaceConnection[] | null>;
  start(): Promise<NotionConnectStartResponse | null>;
  flow(flowId: string): Promise<NotionConnectFlowStatus | null>;
  disconnect(workspaceId: string): Promise<boolean>;
}

async function postJson(url: string, body: unknown): Promise<Response | null> {
  try {
    return await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    return null;
  }
}

async function parse<T>(
  response: Response | null,
  schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } },
): Promise<T | null> {
  if (!response?.ok) return null;
  try {
    const parsed = schema.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

async function get(url: string): Promise<Response | null> {
  try {
    return await fetch(url, { cache: 'no-store' });
  } catch {
    return null;
  }
}

export function httpNotionConnectionsTransport(): NotionConnectionsTransport {
  return {
    async list() {
      const body = await parse(
        await get('/api/notion/connections'),
        NotionConnectionsResponseSchema,
      );
      return body?.connections ?? null;
    },
    async start() {
      return parse(
        await postJson('/api/notion/connections/start', {}),
        NotionConnectStartResponseSchema,
      );
    },
    async flow(flowId) {
      return parse(
        await get(`/api/notion/connections/flow?id=${encodeURIComponent(flowId)}`),
        NotionConnectFlowStatusSchema,
      );
    },
    async disconnect(workspaceId) {
      const response = await postJson('/api/notion/connections/disconnect', { workspaceId });
      return response?.ok ?? false;
    },
  };
}
