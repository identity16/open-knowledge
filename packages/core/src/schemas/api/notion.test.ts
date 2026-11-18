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

describe('NotionPageLinkSchema', () => {
  test('accepts the frontmatter link shape and rejects an empty page id', async () => {
    const { NotionPageLinkSchema } = await import('./notion.ts');
    expect(NotionPageLinkSchema.safeParse({ page: 'p1', workspace: 'w1' }).success).toBe(true);
    expect(NotionPageLinkSchema.safeParse({ page: '', workspace: 'w1' }).success).toBe(false);
  });
});
