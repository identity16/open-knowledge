import {
  type NotionComment,
  type NotionDiscussionsResponse,
  NotionDiscussionsResponseSchema,
  NotionReplyResponseSchema,
  ProblemDetailsSchema,
} from '@inkeep/open-knowledge-core/schemas/api';

export type NotionDiscussionsOutcome =
  | { readonly kind: 'listed'; readonly listing: NotionDiscussionsResponse }
  | { readonly kind: 'not-linked' }
  | { readonly kind: 'failed'; readonly message: string | null };

export type NotionReplyOutcome =
  | { readonly kind: 'replied'; readonly comment: NotionComment }
  | { readonly kind: 'failed'; readonly message: string | null };

export interface NotionDiscussionsTransport {
  list(docName: string): Promise<NotionDiscussionsOutcome>;
  reply(docName: string, discussionId: string, markdown: string): Promise<NotionReplyOutcome>;
}

async function post(
  url: string,
  body: unknown,
): Promise<{ response: Response; body: unknown } | null> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { response, body: await response.json().catch(() => null) };
  } catch {
    return null;
  }
}

function problemTitle(body: unknown): string | null {
  const problem = ProblemDetailsSchema.safeParse(body);
  return problem.success ? problem.data.title : null;
}

export function httpNotionDiscussionsTransport(): NotionDiscussionsTransport {
  return {
    async list(docName) {
      const result = await post('/api/notion/discussions', { docName });
      if (result === null) return { kind: 'failed', message: null };
      if (result.response.status === 404) return { kind: 'not-linked' };
      if (!result.response.ok) return { kind: 'failed', message: problemTitle(result.body) };
      const parsed = NotionDiscussionsResponseSchema.safeParse(result.body);
      return parsed.success
        ? { kind: 'listed', listing: parsed.data }
        : { kind: 'failed', message: null };
    },
    async reply(docName, discussionId, markdown) {
      const result = await post('/api/notion/discussions/reply', {
        docName,
        discussionId,
        markdown,
      });
      if (result === null) return { kind: 'failed', message: null };
      if (!result.response.ok) return { kind: 'failed', message: problemTitle(result.body) };
      const parsed = NotionReplyResponseSchema.safeParse(result.body);
      return parsed.success
        ? { kind: 'replied', comment: parsed.data.comment }
        : { kind: 'failed', message: null };
    },
  };
}
