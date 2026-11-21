import { FileTree } from '@pierre/trees';
import { describe, expect, test } from 'vitest';
import {
  compareFileTreeSortEntries,
  EMPTY_MANUAL_RANKS,
  type FileTreeSortState,
} from './file-tree-sort';

const NAME_ORDER: FileTreeSortState = {
  order: 'name',
  modifiedMsByTreePath: new Map(),
  manualRanksByFolderKey: EMPTY_MANUAL_RANKS,
};

const PATHS = ['_notes/', '_notes/b.md', '10-plans/', '10-plans/a.md', 'zeta/', 'zeta/c.md'];

function isExpanded(tree: FileTree, path: string): boolean {
  const item = tree.getItem(path) as { isExpanded?: () => boolean } | null;
  return item?.isExpanded?.() === true;
}

describe('file tree expansion under the app name order', () => {
  test('a reset keeps folders expanded even where the app order differs from code-point order', () => {
    const tree = new FileTree({
      paths: PATHS,
      initialExpansion: 'closed',
      sort: (left, right) => compareFileTreeSortEntries(left, right, NAME_ORDER),
    });

    tree.resetPaths(PATHS, { initialExpandedPaths: ['10-plans/', 'zeta/'] });

    expect(isExpanded(tree, '10-plans/')).toBe(true);
    expect(isExpanded(tree, 'zeta/')).toBe(true);
    expect(isExpanded(tree, '_notes/')).toBe(false);
  });
});
