import { prepareFileTreeInput } from '@pierre/trees';
import { describe, expect, test } from 'vitest';
import {
  compareFileTreeSortEntries,
  EMPTY_MANUAL_RANKS,
  type FileTreeSortState,
  manualOrderFolderKey,
  manualOrderPatchForMoves,
  manualRanksByFolderKey,
  reorderedFolderNames,
} from './file-tree-sort';

const MIXED_PATHS = [
  'README.md',
  'readme.MD',
  'notes/',
  'Notes2/',
  'notes/day10.md',
  'notes/day2.md',
  'notes/Day1.md',
  'notes/archive/',
  'notes/archive/old.md',
  'a/b/c/deep.md',
  'a/b/',
  'a/z.md',
  'a/B.md',
  'file10.md',
  'file9.md',
  'file09.md',
  'image.png',
  '_index.md',
  '한글.md',
];

function sortWith(state: FileTreeSortState, paths: readonly string[]): readonly string[] {
  return prepareFileTreeInput(paths, {
    sort: (left, right) => compareFileTreeSortEntries(left, right, state),
  }).paths;
}

describe('compareFileTreeSortEntries', () => {
  test('name order matches the tree library default order', () => {
    const state: FileTreeSortState = {
      order: 'name',
      modifiedMsByTreePath: new Map(),
      manualRanksByFolderKey: EMPTY_MANUAL_RANKS,
    };
    expect(sortWith(state, MIXED_PATHS)).toEqual(prepareFileTreeInput(MIXED_PATHS).paths);
  });

  test('modified order puts newer files first and keeps folders on top by name', () => {
    const state: FileTreeSortState = {
      order: 'modified',
      manualRanksByFolderKey: EMPTY_MANUAL_RANKS,
      modifiedMsByTreePath: new Map([
        ['old.md', 1_000],
        ['new.md', 3_000],
        ['mid.md', 2_000],
        ['zeta/inner-old.md', 1_000],
        ['zeta/inner-new.md', 5_000],
      ]),
    };
    const sorted = sortWith(state, [
      'old.md',
      'new.md',
      'mid.md',
      'zeta/inner-old.md',
      'zeta/inner-new.md',
      'alpha/',
    ]);
    expect(sorted).toEqual([
      'alpha/',
      'zeta/inner-new.md',
      'zeta/inner-old.md',
      'new.md',
      'mid.md',
      'old.md',
    ]);
  });

  test('modified order breaks ties by name and puts files without a time first', () => {
    const state: FileTreeSortState = {
      order: 'modified',
      manualRanksByFolderKey: EMPTY_MANUAL_RANKS,
      modifiedMsByTreePath: new Map([
        ['b.md', 1_000],
        ['a.md', 1_000],
      ]),
    };
    expect(sortWith(state, ['b.md', 'a.md', 'just-created.md'])).toEqual([
      'just-created.md',
      'a.md',
      'b.md',
    ]);
  });

  test('manual order follows the listed names per folder, files and folders mixed', () => {
    const state: FileTreeSortState = {
      order: 'manual',
      modifiedMsByTreePath: new Map(),
      manualRanksByFolderKey: manualRanksByFolderKey({
        '/': ['c.md', 'docs', 'a.md'],
        'docs/': ['two.md', 'one.md'],
      }),
    };
    expect(
      sortWith(state, ['a.md', 'b.md', 'c.md', 'docs/one.md', 'docs/two.md', 'zeta/x.md']),
    ).toEqual(['c.md', 'docs/two.md', 'docs/one.md', 'a.md', 'zeta/x.md', 'b.md']);
  });

  test('manual order without a list for a folder falls back to name order', () => {
    const state: FileTreeSortState = {
      order: 'manual',
      modifiedMsByTreePath: new Map(),
      manualRanksByFolderKey: manualRanksByFolderKey({}),
    };
    expect(sortWith(state, MIXED_PATHS)).toEqual(prepareFileTreeInput(MIXED_PATHS).paths);
  });
});

describe('manualOrderFolderKey', () => {
  test('uses a slash for the top level and a trailing slash for folders', () => {
    expect(manualOrderFolderKey([])).toBe('/');
    expect(manualOrderFolderKey(['notes', 'archive'])).toBe('notes/archive/');
  });
});

describe('reorderedFolderNames', () => {
  const names = ['a.md', 'b.md', 'docs', 'c.md'];

  test('moves a row before or after the anchor', () => {
    expect(reorderedFolderNames(names, ['c.md'], 'a.md', 'before')).toEqual([
      'c.md',
      'a.md',
      'b.md',
      'docs',
    ]);
    expect(reorderedFolderNames(names, ['a.md'], 'docs', 'after')).toEqual([
      'b.md',
      'docs',
      'a.md',
      'c.md',
    ]);
  });

  test('keeps several dragged rows together in drag order', () => {
    expect(reorderedFolderNames(names, ['c.md', 'a.md'], 'docs', 'before')).toEqual([
      'b.md',
      'c.md',
      'a.md',
      'docs',
    ]);
  });

  test('inserts a row that came from another folder', () => {
    expect(reorderedFolderNames(names, ['new.md'], 'b.md', 'after')).toEqual([
      'a.md',
      'b.md',
      'new.md',
      'docs',
      'c.md',
    ]);
  });

  test('returns null for a drop on a dragged row, an unknown anchor or no change', () => {
    expect(reorderedFolderNames(names, ['b.md'], 'b.md', 'before')).toBeNull();
    expect(reorderedFolderNames(names, ['b.md'], 'missing.md', 'before')).toBeNull();
    expect(reorderedFolderNames(names, ['b.md'], 'a.md', 'after')).toBeNull();
  });
});

describe('manualOrderPatchForMoves', () => {
  const manualOrder = {
    '/': ['b.md', 'notes', 'a.md'],
    'notes/': ['two.md', 'one.md', 'deep'],
    'notes/deep/': ['z.md', 'y.md'],
  };

  test('a rename in place keeps the position under the new name', () => {
    expect(manualOrderPatchForMoves(manualOrder, [{ from: 'a.md', to: 'c.md' }])).toEqual({
      '/': ['b.md', 'notes', 'c.md'],
    });
  });

  test('a move to another folder drops the name from the old list only', () => {
    expect(manualOrderPatchForMoves(manualOrder, [{ from: 'notes/one.md', to: 'one.md' }])).toEqual(
      {
        'notes/': ['two.md', 'deep'],
      },
    );
  });

  test('a folder rename renames its row and re-keys its own and nested lists', () => {
    expect(manualOrderPatchForMoves(manualOrder, [{ from: 'notes/', to: 'journal/' }])).toEqual({
      '/': ['b.md', 'journal', 'a.md'],
      'notes/': null,
      'notes/deep/': null,
      'journal/': ['two.md', 'one.md', 'deep'],
      'journal/deep/': ['z.md', 'y.md'],
    });
  });

  test('returns null when no list mentions the moved path', () => {
    expect(manualOrderPatchForMoves(manualOrder, [{ from: 'other/x.md', to: 'other/y.md' }])).toBe(
      null,
    );
    expect(manualOrderPatchForMoves({}, [{ from: 'a.md', to: 'b.md' }])).toBeNull();
  });
});
