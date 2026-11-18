import {
  NotionPublishResponseSchema,
  NotionPullResponseSchema,
  type NotionResolvePageResponse,
  NotionResolvePageResponseSchema,
  ProblemDetailsSchema,
} from '@inkeep/open-knowledge-core/schemas/api';

export type NotionPublishOutcome =
  | { readonly kind: 'published'; readonly publishedAt: string; readonly merged: boolean }
  | { readonly kind: 'page-not-empty' }
  | { readonly kind: 'changed-in-notion' }
  | { readonly kind: 'failed'; readonly message: string | null };

export type NotionPullOutcome =
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'merged' }
  | { readonly kind: 'changed-in-notion' }
  | { readonly kind: 'failed'; readonly message: string | null };

export interface NotionPublishTransport {
  resolvePage(url: string): Promise<NotionResolvePageResponse | null>;
  publish(docName: string, overwrite: boolean): Promise<NotionPublishOutcome>;
  pull(docName: string): Promise<NotionPullOutcome>;
}

async function post(url: string, body: unknown): Promise<Response | null> {
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

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export function httpNotionPublishTransport(): NotionPublishTransport {
  return {
    async resolvePage(url) {
      const response = await post('/api/notion/resolve-page', { url });
      if (!response?.ok) return null;
      const parsed = NotionResolvePageResponseSchema.safeParse(await readJson(response));
      return parsed.success ? parsed.data : null;
    },
    async publish(docName, overwrite) {
      const response = await post('/api/notion/publish', { docName, overwrite });
      if (response === null) return { kind: 'failed', message: null };
      const body = await readJson(response);
      if (response.ok) {
        const parsed = NotionPublishResponseSchema.safeParse(body);
        return parsed.success
          ? {
              kind: 'published',
              publishedAt: parsed.data.publishedAt,
              merged: parsed.data.mergedFromNotion === true,
            }
          : { kind: 'failed', message: null };
      }
      const problem = ProblemDetailsSchema.safeParse(body);
      if (!problem.success) return { kind: 'failed', message: null };
      if (problem.data.type === 'urn:ok:error:notion-page-not-empty')
        return { kind: 'page-not-empty' };
      if (problem.data.type === 'urn:ok:error:notion-changed') return { kind: 'changed-in-notion' };
      return { kind: 'failed', message: problem.data.title };
    },
    async pull(docName) {
      const response = await post('/api/notion/pull', { docName });
      if (response === null) return { kind: 'failed', message: null };
      const body = await readJson(response);
      if (response.ok) {
        const parsed = NotionPullResponseSchema.safeParse(body);
        if (!parsed.success) return { kind: 'failed', message: null };
        return parsed.data.outcome === 'merged' ? { kind: 'merged' } : { kind: 'unchanged' };
      }
      const problem = ProblemDetailsSchema.safeParse(body);
      if (problem.success && problem.data.type === 'urn:ok:error:notion-changed')
        return { kind: 'changed-in-notion' };
      return { kind: 'failed', message: problem.success ? problem.data.title : null };
    },
  };
}
