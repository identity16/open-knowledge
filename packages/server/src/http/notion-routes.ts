import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  NotionConnectFlowStatusSchema,
  NotionConnectionsResponseSchema,
  NotionConnectStartRequestSchema,
  NotionConnectStartResponseSchema,
  NotionDisconnectRequestSchema,
  NotionDisconnectResponseSchema,
  NotionDiscussionsRequestSchema,
  NotionDiscussionsResponseSchema,
  NotionPublishRequestSchema,
  NotionPublishResponseSchema,
  NotionPullRequestSchema,
  NotionPullResponseSchema,
  NotionReplyRequestSchema,
  NotionReplyResponseSchema,
  NotionResolvePageRequestSchema,
  NotionResolvePageResponseSchema,
  type ProblemType,
} from '@inkeep/open-knowledge-core';
import type { NotionDiscussions } from '../notion/discussions.ts';
import type { NotionConnections } from '../notion/notion-connections.ts';
import {
  NotionPublishError,
  type NotionPublisher,
  type NotionPublishFailure,
} from '../notion/publisher.ts';
import { NotionTokenStoreError } from '../notion/token-store.ts';
import { type ApiRouteGroup, type ApiRouteRecord, createApiRouteGroup } from './api-pipeline.ts';
import { errorResponse, type HttpErrorStatus } from './error-response.ts';
import { withValidation } from './request-validation.ts';
import { successResponse } from './success-response.ts';

export interface NotionRouteDeps {
  notion: NotionConnections;
  publisher: NotionPublisher;
  discussions: NotionDiscussions;
  checkLocalOpSecurity: (
    req: IncomingMessage,
    res: ServerResponse,
    opts: { handler: string },
  ) => boolean;
}

const NO_STORE = { 'Cache-Control': 'no-store' };

function publishProblem(failure: NotionPublishFailure): [HttpErrorStatus, ProblemType, string] {
  switch (failure.kind) {
    case 'doc-not-found':
      return [404, 'urn:ok:error:doc-not-found', 'Document not found.'];
    case 'not-linked':
      return [400, 'urn:ok:error:invalid-request', 'This document is not linked to a Notion page.'];
    case 'not-connected':
      return [
        400,
        'urn:ok:error:invalid-request',
        'The Notion workspace this document links to is not connected.',
      ];
    case 'page-not-empty':
      return [409, 'urn:ok:error:notion-page-not-empty', 'The Notion page already has content.'];
    case 'changed-in-notion':
      return [
        409,
        'urn:ok:error:notion-changed',
        'The Notion page changed since the last publish.',
      ];
    case 'page-unreadable':
      return [502, 'urn:ok:error:notion-unavailable', 'Notion returned only part of the page.'];
    case 'not-published':
      return [
        400,
        'urn:ok:error:invalid-request',
        'Publish this document to Notion once before taking Notion edits.',
      ];
    case 'notion-error':
      return [
        502,
        'urn:ok:error:notion-unavailable',
        `Notion refused the request: ${failure.message}`,
      ];
  }
}

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

  const handleResolvePage = withValidation(
    NotionResolvePageRequestSchema,
    async (_req, res, body) => {
      const handler = 'notion-resolve-page';
      try {
        const resolved = await deps.publisher.resolvePage(body.url);
        if (resolved === null) {
          errorResponse(
            res,
            404,
            'urn:ok:error:not-found',
            'No connected Notion workspace can open that page.',
            { handler },
          );
          return;
        }
        successResponse(res, 200, NotionResolvePageResponseSchema, resolved, {
          handler,
          extraHeaders: NO_STORE,
        });
      } catch (cause) {
        errorResponse(res, 502, 'urn:ok:error:notion-unavailable', 'Notion could not be reached.', {
          handler,
          cause,
        });
      }
    },
    {
      handler: 'notion-resolve-page',
      method: 'POST',
      preBodyGate: (req, res) => checkLocalOpSecurity(req, res, { handler: 'notion-resolve-page' }),
    },
  );

  const handlePublish = withValidation(
    NotionPublishRequestSchema,
    async (_req, res, body) => {
      const handler = 'notion-publish';
      try {
        const base = await deps.publisher.publish(
          body.docName,
          body.overwrite === undefined ? {} : { overwrite: body.overwrite },
        );
        successResponse(
          res,
          200,
          NotionPublishResponseSchema,
          {
            page: base.page,
            publishedAt: base.publishedAt,
            mergedFromNotion: base.mergedFromNotion,
          },
          { handler, extraHeaders: NO_STORE },
        );
      } catch (cause) {
        if (cause instanceof NotionPublishError) {
          const [status, type, title] = publishProblem(cause.failure);
          errorResponse(res, status, type, title, { handler });
          return;
        }
        errorResponse(res, 502, 'urn:ok:error:notion-unavailable', 'Notion could not be reached.', {
          handler,
          cause,
        });
      }
    },
    {
      handler: 'notion-publish',
      method: 'POST',
      preBodyGate: (req, res) => checkLocalOpSecurity(req, res, { handler: 'notion-publish' }),
    },
  );

  const handlePull = withValidation(
    NotionPullRequestSchema,
    async (_req, res, body) => {
      const handler = 'notion-pull';
      try {
        const result = await deps.publisher.pull(body.docName);
        successResponse(res, 200, NotionPullResponseSchema, result, {
          handler,
          extraHeaders: NO_STORE,
        });
      } catch (cause) {
        if (cause instanceof NotionPublishError) {
          const [status, type, title] = publishProblem(cause.failure);
          errorResponse(res, status, type, title, { handler });
          return;
        }
        errorResponse(res, 502, 'urn:ok:error:notion-unavailable', 'Notion could not be reached.', {
          handler,
          cause,
        });
      }
    },
    {
      handler: 'notion-pull',
      method: 'POST',
      preBodyGate: (req, res) => checkLocalOpSecurity(req, res, { handler: 'notion-pull' }),
    },
  );

  function notionFailure(res: ServerResponse, handler: string, cause: unknown): void {
    if (cause instanceof NotionPublishError) {
      const [status, type, title] = publishProblem(cause.failure);
      errorResponse(res, status, type, title, { handler });
      return;
    }
    errorResponse(res, 502, 'urn:ok:error:notion-unavailable', 'Notion could not be reached.', {
      handler,
      cause,
    });
  }

  const handleDiscussions = withValidation(
    NotionDiscussionsRequestSchema,
    async (_req, res, body) => {
      const handler = 'notion-discussions';
      try {
        const listed = await deps.discussions.list(body.docName);
        successResponse(res, 200, NotionDiscussionsResponseSchema, listed, {
          handler,
          extraHeaders: NO_STORE,
        });
      } catch (cause) {
        if (cause instanceof NotionPublishError && cause.failure.kind === 'not-linked') {
          errorResponse(
            res,
            404,
            'urn:ok:error:not-found',
            'This document is not linked to a Notion page.',
            { handler },
          );
          return;
        }
        notionFailure(res, handler, cause);
      }
    },
    {
      handler: 'notion-discussions',
      method: 'POST',
      preBodyGate: (req, res) => checkLocalOpSecurity(req, res, { handler: 'notion-discussions' }),
    },
  );

  const handleReply = withValidation(
    NotionReplyRequestSchema,
    async (_req, res, body) => {
      const handler = 'notion-discussion-reply';
      try {
        const comment = await deps.discussions.reply(
          body.docName,
          body.discussionId,
          body.markdown.trim(),
        );
        successResponse(
          res,
          200,
          NotionReplyResponseSchema,
          { comment },
          {
            handler,
            extraHeaders: NO_STORE,
          },
        );
      } catch (cause) {
        notionFailure(res, handler, cause);
      }
    },
    {
      handler: 'notion-discussion-reply',
      method: 'POST',
      preBodyGate: (req, res) =>
        checkLocalOpSecurity(req, res, { handler: 'notion-discussion-reply' }),
    },
  );

  const routes = {
    '/api/notion/discussions': handleDiscussions,
    '/api/notion/discussions/reply': handleReply,
    '/api/notion/pull': handlePull,
    '/api/notion/resolve-page': handleResolvePage,
    '/api/notion/publish': handlePublish,
    '/api/notion/connections': handleList,
    '/api/notion/connections/flow': handleFlow,
    '/api/notion/connections/start': handleStart,
    '/api/notion/connections/disconnect': handleDisconnect,
  } satisfies ApiRouteRecord;

  return createApiRouteGroup(routes, {
    mutating: [
      '/api/notion/discussions/reply',
      '/api/notion/connections/start',
      '/api/notion/connections/disconnect',
      '/api/notion/resolve-page',
      '/api/notion/publish',
      '/api/notion/pull',
    ],
  });
}
