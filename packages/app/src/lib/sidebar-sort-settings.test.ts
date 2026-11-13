import { describe, expect, test } from 'vitest';
import { parseCachedSidebarSort } from './sidebar-sort-settings';

describe('parseCachedSidebarSort', () => {
  test('reads back what was cached', () => {
    const settings = {
      sortOrder: 'manual',
      folderSortOrder: { 'Daily Notes/': 'modified' },
      manualOrder: { '/': ['b.md', 'a.md'] },
    };
    expect(parseCachedSidebarSort(JSON.stringify(settings))).toEqual(settings);
  });

  test('drops entries that are no longer valid instead of trusting them', () => {
    expect(
      parseCachedSidebarSort(
        JSON.stringify({
          sortOrder: 'name',
          folderSortOrder: { 'a/': 'size', 'b/': 'manual' },
          manualOrder: { '/': ['ok.md'], 'x/': [1] },
        }),
      ),
    ).toEqual({
      sortOrder: 'name',
      folderSortOrder: { 'b/': 'manual' },
      manualOrder: { '/': ['ok.md'] },
    });
  });

  test('returns null for nothing, garbage, or an unknown sort order', () => {
    expect(parseCachedSidebarSort(null)).toBeNull();
    expect(parseCachedSidebarSort('{not json')).toBeNull();
    expect(parseCachedSidebarSort(JSON.stringify({ sortOrder: 'size' }))).toBeNull();
  });
});
