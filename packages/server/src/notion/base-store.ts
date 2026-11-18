import { chmodSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  tracedMkdirSync,
  tracedRenameSync,
  tracedUnlinkSync,
  tracedWriteFileSync,
} from '../fs-traced.ts';

export interface NotionPublishBase {
  readonly page: string;
  readonly workspace: string;
  readonly docName: string;
  readonly markdown: string;
  readonly publishedAt: string;
  readonly pendingTheirs?: string;
}

export interface NotionBaseStore {
  get(page: string): NotionPublishBase | null;
  set(base: NotionPublishBase): void;
  remove(page: string): void;
}

const PAGE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function createNotionBaseStore(dir: string): NotionBaseStore {
  function path(page: string): string {
    if (!PAGE_ID.test(page)) throw new Error(`not a Notion page id: ${page}`);
    return join(dir, `${page}.json`);
  }

  return {
    get(page) {
      const file = path(page);
      if (!existsSync(file)) return null;
      try {
        const value = JSON.parse(readFileSync(file, 'utf8')) as Partial<NotionPublishBase>;
        if (
          value.page !== page ||
          typeof value.workspace !== 'string' ||
          typeof value.docName !== 'string' ||
          typeof value.markdown !== 'string' ||
          typeof value.publishedAt !== 'string'
        )
          return null;
        return value as NotionPublishBase;
      } catch {
        return null;
      }
    },
    set(base) {
      const file = path(base.page);
      tracedMkdirSync(dir, { recursive: true, mode: 0o700 });
      const tmp = `${file}.tmp`;
      tracedWriteFileSync(tmp, JSON.stringify(base), { mode: 0o600 });
      chmodSync(tmp, 0o600);
      tracedRenameSync(tmp, file);
    },
    remove(page) {
      const file = path(page);
      if (existsSync(file)) tracedUnlinkSync(file);
    },
  };
}
