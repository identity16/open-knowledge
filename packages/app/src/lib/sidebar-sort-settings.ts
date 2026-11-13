import {
  FILE_TREE_SORT_ORDERS,
  type FileTreeSortOrder,
} from '@inkeep/open-knowledge-core/config/schema';
import { useEffect } from 'react';
import { useConfigContext } from '@/lib/config-provider';
import {
  type FileTreeFolderSortOrder,
  type FileTreeManualOrder,
  NO_FOLDER_SORT_ORDER,
  NO_MANUAL_ORDER,
} from '@/lib/file-tree-sort';

const STORAGE_KEY = 'ok-sidebar-sort-v1';

export interface SidebarSortSettings {
  readonly sortOrder: FileTreeSortOrder;
  readonly folderSortOrder: FileTreeFolderSortOrder;
  readonly manualOrder: FileTreeManualOrder;
}

const DEFAULT_SETTINGS: SidebarSortSettings = {
  sortOrder: 'name',
  folderSortOrder: NO_FOLDER_SORT_ORDER,
  manualOrder: NO_MANUAL_ORDER,
};

function isSortOrder(value: unknown): value is FileTreeSortOrder {
  return typeof value === 'string' && (FILE_TREE_SORT_ORDERS as readonly string[]).includes(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseCachedSidebarSort(raw: string | null): SidebarSortSettings | null {
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isPlainObject(parsed) || !isSortOrder(parsed.sortOrder)) return null;
  const folderSortOrder: Record<string, FileTreeSortOrder> = {};
  if (isPlainObject(parsed.folderSortOrder)) {
    for (const [key, order] of Object.entries(parsed.folderSortOrder)) {
      if (isSortOrder(order)) folderSortOrder[key] = order;
    }
  }
  const manualOrder: Record<string, string[]> = {};
  if (isPlainObject(parsed.manualOrder)) {
    for (const [key, names] of Object.entries(parsed.manualOrder)) {
      if (Array.isArray(names) && names.every((name) => typeof name === 'string')) {
        manualOrder[key] = names;
      }
    }
  }
  return { sortOrder: parsed.sortOrder, folderSortOrder, manualOrder };
}

function storage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readCached(): SidebarSortSettings | null {
  return parseCachedSidebarSort(storage()?.getItem(STORAGE_KEY) ?? null);
}

function writeCached(raw: string): void {
  try {
    if (storage()?.getItem(STORAGE_KEY) !== raw) storage()?.setItem(STORAGE_KEY, raw);
  } catch {}
}

export function useSidebarSortSettings(): SidebarSortSettings {
  const { merged, projectLocalSynced } = useConfigContext();
  const sidebar = merged?.appearance?.sidebar;
  const fromConfig: SidebarSortSettings = {
    sortOrder: sidebar?.sortOrder ?? DEFAULT_SETTINGS.sortOrder,
    folderSortOrder: sidebar?.folderSortOrder ?? DEFAULT_SETTINGS.folderSortOrder,
    manualOrder: sidebar?.manualOrder ?? DEFAULT_SETTINGS.manualOrder,
  };
  const configRaw = JSON.stringify(fromConfig);
  useEffect(() => {
    if (projectLocalSynced) writeCached(configRaw);
  }, [projectLocalSynced, configRaw]);
  if (projectLocalSynced) return fromConfig;
  return readCached() ?? fromConfig;
}
