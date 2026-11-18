import {
  type NotionPageLink,
  NotionPageLinkSchema,
  parseFrontmatterRecord,
} from '@inkeep/open-knowledge-core';

export type NotionPublishFailure =
  | { readonly kind: 'doc-not-found' }
  | { readonly kind: 'not-linked' }
  | { readonly kind: 'not-connected'; readonly workspace: string }
  | { readonly kind: 'page-not-empty' }
  | { readonly kind: 'changed-in-notion' }
  | { readonly kind: 'page-unreadable' }
  | { readonly kind: 'not-published' }
  | { readonly kind: 'notion-error'; readonly status: number; readonly message: string };

export class NotionPublishError extends Error {
  readonly failure: NotionPublishFailure;

  constructor(failure: NotionPublishFailure) {
    super(`Notion publish failed: ${failure.kind}`);
    this.name = 'NotionPublishError';
    this.failure = failure;
  }
}

export function readNotionLink(source: string): NotionPageLink | null {
  const frontmatter = parseFrontmatterRecord(source);
  const parsed = NotionPageLinkSchema.safeParse(frontmatter?.notion);
  return parsed.success ? { page: parsed.data.page, workspace: parsed.data.workspace } : null;
}
