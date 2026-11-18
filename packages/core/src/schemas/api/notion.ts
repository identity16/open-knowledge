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
