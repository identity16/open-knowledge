import type { StandardSchemaV1 } from '@standard-schema/spec';
import { z } from 'zod';

export const NotionWorkspaceConnectionSchema = z
  .object({
    workspaceId: z.string().min(1),
    workspaceName: z.string(),
    workspaceIcon: z.string().nullable(),
    connectedAt: z.string().min(1),
  })
  .loose() satisfies StandardSchemaV1;
export type NotionWorkspaceConnection = z.infer<typeof NotionWorkspaceConnectionSchema>;

export const NotionConnectionsResponseSchema = z
  .object({
    connections: z.array(NotionWorkspaceConnectionSchema),
  })
  .loose() satisfies StandardSchemaV1;
export type NotionConnectionsResponse = z.infer<typeof NotionConnectionsResponseSchema>;

export const NotionConnectStartResponseSchema = z
  .object({
    flowId: z.string().min(1),
    authorizeUrl: z.url(),
  })
  .loose() satisfies StandardSchemaV1;
export type NotionConnectStartResponse = z.infer<typeof NotionConnectStartResponseSchema>;

export const NotionConnectFlowStatusSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('pending') }).loose(),
  z.object({ status: z.literal('connected'), workspace: NotionWorkspaceConnectionSchema }).loose(),
  z.object({ status: z.literal('denied') }).loose(),
  z.object({ status: z.literal('failed'), detail: z.string().optional() }).loose(),
  z.object({ status: z.literal('expired') }).loose(),
]) satisfies StandardSchemaV1;
export type NotionConnectFlowStatus = z.infer<typeof NotionConnectFlowStatusSchema>;

export const NotionDisconnectResponseSchema = z
  .object({
    workspaceId: z.string().min(1),
    revoked: z.boolean(),
  })
  .loose() satisfies StandardSchemaV1;
export type NotionDisconnectResponse = z.infer<typeof NotionDisconnectResponseSchema>;

export const NotionConnectStartRequestSchema = z.object({}).loose() satisfies StandardSchemaV1;
export type NotionConnectStartRequest = z.infer<typeof NotionConnectStartRequestSchema>;

export const NotionDisconnectRequestSchema = z
  .object({
    workspaceId: z.string().min(1),
  })
  .loose() satisfies StandardSchemaV1;
export type NotionDisconnectRequest = z.infer<typeof NotionDisconnectRequestSchema>;

export const NotionPageLinkSchema = z
  .object({
    page: z.string().min(1),
    workspace: z.string().min(1),
  })
  .loose() satisfies StandardSchemaV1;
export type NotionPageLink = z.infer<typeof NotionPageLinkSchema>;

export const NotionResolvePageRequestSchema = z
  .object({
    url: z.string().min(1),
  })
  .loose() satisfies StandardSchemaV1;
export type NotionResolvePageRequest = z.infer<typeof NotionResolvePageRequestSchema>;

export const NotionResolvePageResponseSchema = z
  .object({
    page: z.string().min(1),
    workspace: z.string().min(1),
    title: z.string(),
  })
  .loose() satisfies StandardSchemaV1;
export type NotionResolvePageResponse = z.infer<typeof NotionResolvePageResponseSchema>;

export const NotionPublishRequestSchema = z
  .object({
    docName: z.string().min(1),
    overwrite: z.boolean().optional(),
  })
  .loose() satisfies StandardSchemaV1;
export type NotionPublishRequest = z.infer<typeof NotionPublishRequestSchema>;

export const NotionPublishResponseSchema = z
  .object({
    page: z.string().min(1),
    publishedAt: z.string().min(1),
    mergedFromNotion: z.boolean().optional(),
  })
  .loose() satisfies StandardSchemaV1;
export type NotionPublishResponse = z.infer<typeof NotionPublishResponseSchema>;

export const NotionPullRequestSchema = z
  .object({
    docName: z.string().min(1),
  })
  .loose() satisfies StandardSchemaV1;
export type NotionPullRequest = z.infer<typeof NotionPullRequestSchema>;

export const NotionPullResponseSchema = z
  .object({
    outcome: z.enum(['unchanged', 'merged']),
  })
  .loose() satisfies StandardSchemaV1;
export type NotionPullResponse = z.infer<typeof NotionPullResponseSchema>;
