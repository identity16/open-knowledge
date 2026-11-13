import {
  FILE_TREE_MANUAL_ORDER_ROOT_KEY,
  type FileTreeSortOrder,
} from '@inkeep/open-knowledge-core/config/schema';
import type { FileTreeSortEntry } from '@pierre/trees';

export type FileTreeManualOrder = Readonly<Record<string, readonly string[]>>;

export interface FileTreeSortState {
  readonly order: FileTreeSortOrder;
  readonly modifiedMsByTreePath: ReadonlyMap<string, number>;
  readonly manualRanksByFolderKey: ReadonlyMap<string, ReadonlyMap<string, number>>;
}

export const NO_MANUAL_ORDER: FileTreeManualOrder = Object.freeze({});

export const EMPTY_MANUAL_RANKS: ReadonlyMap<string, ReadonlyMap<string, number>> = new Map();

export function manualOrderFolderKey(parentSegments: readonly string[]): string {
  return parentSegments.length === 0
    ? FILE_TREE_MANUAL_ORDER_ROOT_KEY
    : `${parentSegments.join('/')}/`;
}

export function manualRanksByFolderKey(
  manualOrder: FileTreeManualOrder,
): Map<string, ReadonlyMap<string, number>> {
  const ranks = new Map<string, ReadonlyMap<string, number>>();
  for (const [folderKey, names] of Object.entries(manualOrder)) {
    const folderRanks = new Map<string, number>();
    names.forEach((name, index) => {
      if (!folderRanks.has(name)) folderRanks.set(name, index);
    });
    ranks.set(folderKey, folderRanks);
  }
  return ranks;
}

type NaturalToken = string | number;

function isDigitCode(code: number): boolean {
  return code >= 48 && code <= 57;
}

function naturalTokens(value: string): NaturalToken[] {
  const tokens: NaturalToken[] = [];
  let tokenStart = 0;
  let index = 0;
  while (index < value.length) {
    while (index < value.length && !isDigitCode(value.charCodeAt(index))) index += 1;
    if (index >= value.length) break;
    if (index > tokenStart) tokens.push(value.slice(tokenStart, index));
    let numberValue = 0;
    while (index < value.length && isDigitCode(value.charCodeAt(index))) {
      numberValue = numberValue * 10 + (value.charCodeAt(index) - 48);
      index += 1;
    }
    tokens.push(numberValue);
    tokenStart = index;
  }
  if (tokenStart < value.length || tokens.length === 0) tokens.push(value.slice(tokenStart));
  return tokens;
}

function compareNaturalTokens(left: NaturalToken[], right: NaturalToken[]): number {
  const count = Math.min(left.length, right.length);
  for (let index = 0; index < count; index++) {
    const leftToken = left[index];
    const rightToken = right[index];
    if (leftToken === rightToken) continue;
    if (typeof leftToken === 'number' && typeof rightToken === 'number') {
      return leftToken < rightToken ? -1 : 1;
    }
    const leftString = String(leftToken);
    const rightString = String(rightToken);
    if (leftString !== rightString) return leftString < rightString ? -1 : 1;
  }
  if (left.length !== right.length) return left.length < right.length ? -1 : 1;
  return 0;
}

export function compareSegmentNames(left: string, right: string): number {
  const leftLower = left.toLowerCase();
  const rightLower = right.toLowerCase();
  const tokenComparison = compareNaturalTokens(naturalTokens(leftLower), naturalTokens(rightLower));
  if (tokenComparison !== 0) return tokenComparison;
  if (leftLower !== rightLower) return leftLower < rightLower ? -1 : 1;
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function isDirectoryAtDepth(entry: FileTreeSortEntry, depth: number): boolean {
  return depth < entry.segments.length - 1 || entry.isDirectory;
}

function compareByManualRank(
  left: FileTreeSortEntry,
  right: FileTreeSortEntry,
  depth: number,
  manualRanksByFolderKey: ReadonlyMap<string, ReadonlyMap<string, number>>,
): number {
  const folderRanks = manualRanksByFolderKey.get(
    manualOrderFolderKey(left.segments.slice(0, depth)),
  );
  if (folderRanks === undefined) return 0;
  const leftRank = folderRanks.get(left.segments[depth] ?? '');
  const rightRank = folderRanks.get(right.segments[depth] ?? '');
  if (leftRank === undefined && rightRank === undefined) return 0;
  if (leftRank === undefined) return 1;
  if (rightRank === undefined) return -1;
  return leftRank - rightRank;
}

function compareFilesByModified(
  left: FileTreeSortEntry,
  right: FileTreeSortEntry,
  modifiedMsByTreePath: ReadonlyMap<string, number>,
): number {
  const leftMs = modifiedMsByTreePath.get(left.path) ?? Number.POSITIVE_INFINITY;
  const rightMs = modifiedMsByTreePath.get(right.path) ?? Number.POSITIVE_INFINITY;
  if (leftMs === rightMs) return 0;
  return leftMs > rightMs ? -1 : 1;
}

export function compareFileTreeSortEntries(
  left: FileTreeSortEntry,
  right: FileTreeSortEntry,
  state: FileTreeSortState,
): number {
  const sharedDepth = Math.min(left.segments.length, right.segments.length);
  for (let depth = 0; depth < sharedDepth; depth++) {
    const leftSegment = left.segments[depth] ?? '';
    const rightSegment = right.segments[depth] ?? '';
    if (leftSegment === rightSegment) continue;
    if (state.order === 'manual') {
      const byRank = compareByManualRank(left, right, depth, state.manualRanksByFolderKey);
      if (byRank !== 0) return byRank;
    }
    const leftIsDirectory = isDirectoryAtDepth(left, depth);
    const rightIsDirectory = isDirectoryAtDepth(right, depth);
    if (leftIsDirectory !== rightIsDirectory) return leftIsDirectory ? -1 : 1;
    if (!leftIsDirectory && state.order === 'modified') {
      const byModified = compareFilesByModified(left, right, state.modifiedMsByTreePath);
      if (byModified !== 0) return byModified;
    }
    return compareSegmentNames(leftSegment, rightSegment);
  }
  if (left.segments.length !== right.segments.length) {
    return left.segments.length < right.segments.length ? -1 : 1;
  }
  return 0;
}

export function treePathSortEntry(treePath: string): FileTreeSortEntry {
  const isDirectory = treePath.endsWith('/');
  const segments = (isDirectory ? treePath.slice(0, -1) : treePath).split('/');
  return {
    basename: segments[segments.length - 1] ?? '',
    depth: segments.length,
    isDirectory,
    path: treePath,
    segments,
  };
}

export function treePathBasename(treePath: string): string {
  return treePathSortEntry(treePath).basename;
}

export function reorderedFolderNames(
  currentNames: readonly string[],
  draggedNames: readonly string[],
  anchorName: string,
  position: 'before' | 'after',
): string[] | null {
  const dragged = new Set(draggedNames);
  if (dragged.has(anchorName)) return null;
  const remaining = currentNames.filter((name) => !dragged.has(name));
  const anchorIndex = remaining.indexOf(anchorName);
  if (anchorIndex < 0) return null;
  const insertAt = position === 'before' ? anchorIndex : anchorIndex + 1;
  const next = [...remaining.slice(0, insertAt), ...draggedNames, ...remaining.slice(insertAt)];
  const unchanged =
    next.length === currentNames.length &&
    next.every((name, index) => name === currentNames[index]);
  return unchanged ? null : next;
}

export interface TreePathMove {
  readonly from: string;
  readonly to: string;
}

function parentFolderKey(treePath: string): string {
  return manualOrderFolderKey(treePathSortEntry(treePath).segments.slice(0, -1));
}

export function manualOrderPatchForMoves(
  manualOrder: FileTreeManualOrder,
  moves: readonly TreePathMove[],
): Record<string, string[] | null> | null {
  const next = new Map<string, readonly string[]>(Object.entries(manualOrder));
  for (const { from, to } of moves) {
    if (from === to) continue;
    const fromKey = parentFolderKey(from);
    const toKey = parentFolderKey(to);
    const fromName = treePathBasename(from);
    const toName = treePathBasename(to);
    const sourceList = next.get(fromKey);
    if (sourceList?.includes(fromName)) {
      next.set(
        fromKey,
        fromKey === toKey
          ? sourceList.map((name) => (name === fromName ? toName : name))
          : sourceList.filter((name) => name !== fromName),
      );
    }
    if (from.endsWith('/') && to.endsWith('/')) {
      const nestedLists: [string, readonly string[]][] = [];
      for (const [key, names] of next) {
        if (key.startsWith(from)) nestedLists.push([key, names]);
      }
      for (const [key, names] of nestedLists) {
        next.delete(key);
        next.set(`${to}${key.slice(from.length)}`, names);
      }
    }
  }
  const patch: Record<string, string[] | null> = {};
  for (const key of Object.keys(manualOrder)) {
    if (!next.has(key)) patch[key] = null;
  }
  for (const [key, names] of next) {
    const before = manualOrder[key];
    const same =
      before !== undefined &&
      before.length === names.length &&
      before.every((name, index) => name === names[index]);
    if (!same) patch[key] = [...names];
  }
  return Object.keys(patch).length === 0 ? null : patch;
}
