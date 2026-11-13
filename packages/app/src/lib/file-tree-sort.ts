import type { FileTreeSortOrder } from '@inkeep/open-knowledge-core/config/schema';
import type { FileTreeSortEntry } from '@pierre/trees';

export interface FileTreeSortState {
  readonly order: FileTreeSortOrder;
  readonly modifiedMsByTreePath: ReadonlyMap<string, number>;
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
