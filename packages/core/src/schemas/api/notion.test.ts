import { describe, expect, test } from 'vitest';
import {
  NotionConnectFlowStatusSchema,
  NotionDiscussionsResponseSchema,
  NotionReplyRequestSchema,
} from './notion.ts';

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

describe('NotionDiscussionsResponseSchema', () => {
  test('a block discussion carries the block text it is anchored to', () => {
    const parsed = NotionDiscussionsResponseSchema.parse({
      page: 'p',
      complete: true,
      discussions: [
        {
          id: 'd1',
          anchor: { kind: 'block', blockId: 'b1', text: 'Beta line.' },
          comments: [
            { id: 'c1', author: 'Ann', createdAt: '2026-11-18T00:00:00.000Z', markdown: 'Why?' },
          ],
        },
        { id: 'd2', anchor: { kind: 'page' }, comments: [] },
      ],
    });
    expect(parsed.discussions.map((d) => d.anchor.kind)).toEqual(['block', 'page']);
  });

  test('a block anchor without a block id is rejected', () => {
    const parsed = NotionDiscussionsResponseSchema.safeParse({
      page: 'p',
      complete: true,
      discussions: [{ id: 'd', anchor: { kind: 'block', text: 'x' }, comments: [] }],
    });
    expect(parsed.success).toBe(false);
  });
});

describe('NotionReplyRequestSchema', () => {
  test('a blank reply is rejected', () => {
    expect(
      NotionReplyRequestSchema.safeParse({ docName: 'a', discussionId: 'd', markdown: '  \n' })
        .success,
    ).toBe(false);
  });
});
