import { prepareFileTreeInput } from '@pierre/trees';
import { describe, expect, test } from 'vitest';
import { compareFileTreeSortEntries, type FileTreeSortState } from './file-tree-sort';

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
    const state: FileTreeSortState = { order: 'name', modifiedMsByTreePath: new Map() };
    expect(sortWith(state, MIXED_PATHS)).toEqual(prepareFileTreeInput(MIXED_PATHS).paths);
  });

  test('modified order puts newer files first and keeps folders on top by name', () => {
    const state: FileTreeSortState = {
      order: 'modified',
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
});
