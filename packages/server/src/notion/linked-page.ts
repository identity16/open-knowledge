import type { NotionPageLink } from '@inkeep/open-knowledge-core';
import type { NotionConnections } from './notion-connections.ts';
import { NotionPublishError, readNotionLink } from './notion-failure.ts';

export interface NotionPageAccessDeps {
  readonly connections: Pick<NotionConnections, 'request'>;
  readonly readDocSource: (docName: string) => string | null;
}

export interface NotionPageAccess {
  json(workspace: string, path: string, init?: RequestInit): Promise<unknown>;
  linkedSource(docName: string): { source: string; link: NotionPageLink };
}

export function createNotionPageAccess(deps: NotionPageAccessDeps): NotionPageAccess {
  return {
    async json(workspace, path, init) {
      let response: Response;
      try {
        response = await deps.connections.request(workspace, path, init);
      } catch (cause) {
        if ((cause as Error)?.name === 'NotionNotConnectedError')
          throw new NotionPublishError({ kind: 'not-connected', workspace });
        throw cause;
      }
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message = (body as { message?: string } | null)?.message ?? `HTTP ${response.status}`;
        throw new NotionPublishError({ kind: 'notion-error', status: response.status, message });
      }
      return body;
    },

    linkedSource(docName) {
      const source = deps.readDocSource(docName);
      if (source === null) throw new NotionPublishError({ kind: 'doc-not-found' });
      const link = readNotionLink(source);
      if (link === null) throw new NotionPublishError({ kind: 'not-linked' });
      return { source, link };
    },
  };
}
