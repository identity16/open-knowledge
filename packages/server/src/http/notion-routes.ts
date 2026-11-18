import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  NotionConnectFlowStatusSchema,
  NotionConnectionsResponseSchema,
  NotionConnectStartRequestSchema,
  NotionConnectStartResponseSchema,
  NotionDisconnectRequestSchema,
  NotionDisconnectResponseSchema,
} from '@inkeep/open-knowledge-core';
import type { NotionConnections } from '../notion/notion-connections.ts';
import { NotionTokenStoreError } from '../notion/token-store.ts';
import { type ApiRouteGroup, type ApiRouteRecord, createApiRouteGroup } from './api-pipeline.ts';
import { errorResponse } from './error-response.ts';
import { withValidation } from './request-validation.ts';
import { successResponse } from './success-response.ts';

export interface NotionRouteDeps {
  notion: NotionConnections;
  checkLocalOpSecurity: (
    req: IncomingMessage,
    res: ServerResponse,
    opts: { handler: string },
  ) => boolean;
}

const NO_STORE = { 'Cache-Control': 'no-store' };

export function createNotionRoutes(deps: NotionRouteDeps): ApiRouteGroup {
  const { notion, checkLocalOpSecurity } = deps;

  function getOnly(req: IncomingMessage, res: ServerResponse, handler: string): boolean {
    if (!checkLocalOpSecurity(req, res, { handler })) return false;
    if (req.method === 'GET') return true;
    errorResponse(res, 405, 'urn:ok:error:method-not-allowed', 'Method not allowed.', {
      handler,
      extraHeaders: { Allow: 'GET' },
    });
    return false;
  }

  async function handleList(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const handler = 'notion-connections';
    if (!getOnly(req, res, handler)) return;
    try {
      successResponse(
        res,
        200,
        NotionConnectionsResponseSchema,
        { connections: notion.list() },
        { handler, extraHeaders: NO_STORE },
      );
    } catch (cause) {
      errorResponse(res, 500, 'urn:ok:error:internal-server-error', 'Internal server error.', {
        handler,
        cause,
      });
    }
  }

  async function handleFlow(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const handler = 'notion-connect-flow';
    if (!getOnly(req, res, handler)) return;
    const flowId = new URL(req.url ?? '', 'http://localhost').searchParams.get('id') ?? '';
    const status = flowId === '' ? null : notion.flowStatus(flowId);
    if (status === null) {
      errorResponse(res, 404, 'urn:ok:error:not-found', 'No such Notion connect flow.', {
        handler,
      });
      return;
    }
    successResponse(res, 200, NotionConnectFlowStatusSchema, status, {
      handler,
      extraHeaders: NO_STORE,
    });
  }

  const handleStart = withValidation(
    NotionConnectStartRequestSchema,
    async (_req, res) => {
      successResponse(res, 200, NotionConnectStartResponseSchema, notion.startConnect(), {
        handler: 'notion-connect-start',
        extraHeaders: NO_STORE,
      });
    },
    {
      handler: 'notion-connect-start',
      method: 'POST',
      preBodyGate: (req, res) =>
        checkLocalOpSecurity(req, res, { handler: 'notion-connect-start' }),
    },
  );

  const handleDisconnect = withValidation(
    NotionDisconnectRequestSchema,
    async (_req, res, body) => {
      const handler = 'notion-disconnect';
      try {
        const { removed, revoked } = await notion.disconnect(body.workspaceId);
        if (!removed) {
          errorResponse(
            res,
            404,
            'urn:ok:error:not-found',
            'That Notion workspace is not connected.',
            {
              handler,
            },
          );
          return;
        }
        successResponse(
          res,
          200,
          NotionDisconnectResponseSchema,
          { workspaceId: body.workspaceId, revoked },
          { handler, extraHeaders: NO_STORE },
        );
      } catch (cause) {
        const keychain = cause instanceof NotionTokenStoreError;
        errorResponse(
          res,
          keychain ? 503 : 500,
          keychain ? 'urn:ok:error:notion-unavailable' : 'urn:ok:error:internal-server-error',
          keychain ? 'The keychain did not answer. Try again.' : 'Internal server error.',
          { handler, cause },
        );
      }
    },
    {
      handler: 'notion-disconnect',
      method: 'POST',
      preBodyGate: (req, res) => checkLocalOpSecurity(req, res, { handler: 'notion-disconnect' }),
    },
  );

  const routes = {
    '/api/notion/connections': handleList,
    '/api/notion/connections/flow': handleFlow,
    '/api/notion/connections/start': handleStart,
    '/api/notion/connections/disconnect': handleDisconnect,
  } satisfies ApiRouteRecord;

  return createApiRouteGroup(routes, {
    mutating: ['/api/notion/connections/start', '/api/notion/connections/disconnect'],
  });
}
