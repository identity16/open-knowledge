import { describe, expect, test } from 'vitest';
import { NotionConnectFlowStatusSchema } from './notion.ts';

describe('NotionConnectFlowStatusSchema', () => {
  test('a connected flow carries the workspace it connected', () => {
    const parsed = NotionConnectFlowStatusSchema.parse({
      status: 'connected',
      workspace: {
        workspaceId: 'w1',
        workspaceName: 'Joon',
        workspaceIcon: null,
        connectedAt: '2026-11-18T00:00:00.000Z',
      },
    });
    expect(parsed.status).toBe('connected');
  });

  test('a connected flow without a workspace is rejected', () => {
    expect(NotionConnectFlowStatusSchema.safeParse({ status: 'connected' }).success).toBe(false);
  });
});
