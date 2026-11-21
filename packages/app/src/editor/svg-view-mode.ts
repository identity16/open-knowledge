import { extensionOf } from '@inkeep/open-knowledge-core/utils/extension';
import { useSyncExternalStore } from 'react';

export type SvgViewMode = 'preview' | 'source';

const sourceDocs = new Set<string>();
const listeners = new Set<() => void>();

export function isSvgDocFile(docName: string): boolean {
  return extensionOf(docName) === 'svg';
}

export function getSvgViewMode(docName: string): SvgViewMode {
  return sourceDocs.has(docName) ? 'source' : 'preview';
}

export function setSvgViewMode(docName: string, mode: SvgViewMode): void {
  if (getSvgViewMode(docName) === mode) return;
  if (mode === 'source') sourceDocs.add(docName);
  else sourceDocs.delete(docName);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSvgViewMode(docName: string): SvgViewMode {
  return useSyncExternalStore(
    subscribe,
    () => getSvgViewMode(docName),
    () => 'preview',
  );
}
