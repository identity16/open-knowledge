import { chmodSync, existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  type NotionWorkspaceConnection,
  NotionWorkspaceConnectionSchema,
} from '@inkeep/open-knowledge-core';
import { okUserHomeDir } from '@inkeep/open-knowledge-core/server';
import { parse as yamlParse, stringify as yamlStringify } from 'yaml';
import { tracedMkdirSync, tracedRenameSync, tracedWriteFileSync } from '../fs-traced.ts';

export const NOTION_CONNECTIONS_FILE = 'notion.yml';

export function notionConnectionsPath(homedirOverride?: string): string {
  return join(okUserHomeDir(homedirOverride ?? homedir()), NOTION_CONNECTIONS_FILE);
}

export interface NotionConnectionRegistry {
  list(): NotionWorkspaceConnection[];
  get(workspaceId: string): NotionWorkspaceConnection | null;
  upsert(connection: NotionWorkspaceConnection): void;
  remove(workspaceId: string): boolean;
}

export function createNotionConnectionRegistry(
  path = notionConnectionsPath(),
): NotionConnectionRegistry {
  function read(): NotionWorkspaceConnection[] {
    if (!existsSync(path)) return [];
    const parsed: unknown = yamlParse(readFileSync(path, 'utf8'));
    const entries =
      typeof parsed === 'object' && parsed !== null
        ? (parsed as { connections?: unknown }).connections
        : undefined;
    if (!Array.isArray(entries)) return [];
    return entries.flatMap((entry) => {
      const result = NotionWorkspaceConnectionSchema.safeParse(entry);
      return result.success ? [result.data] : [];
    });
  }

  function write(connections: NotionWorkspaceConnection[]): void {
    tracedMkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const tmp = `${path}.tmp`;
    tracedWriteFileSync(tmp, yamlStringify({ connections }), { mode: 0o600 });
    chmodSync(tmp, 0o600);
    tracedRenameSync(tmp, path);
  }

  return {
    list: read,
    get: (workspaceId) => read().find((c) => c.workspaceId === workspaceId) ?? null,
    upsert(connection) {
      const others = read().filter((c) => c.workspaceId !== connection.workspaceId);
      write([...others, connection]);
    },
    remove(workspaceId) {
      const current = read();
      const remaining = current.filter((c) => c.workspaceId !== workspaceId);
      if (remaining.length === current.length) return false;
      write(remaining);
      return true;
    },
  };
}
