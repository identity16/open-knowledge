import { useSyncExternalStore } from 'react';

export const COMPACT_TOUCH_QUERY = '(pointer: coarse) and (width < 48rem)';

function subscribeCompactTouch(listener: () => void): () => void {
  const query = window.matchMedia(COMPACT_TOUCH_QUERY);
  query.addEventListener('change', listener);
  return () => query.removeEventListener('change', listener);
}

function compactTouchSnapshot(): boolean {
  return window.matchMedia(COMPACT_TOUCH_QUERY).matches;
}

function compactTouchServerSnapshot(): boolean {
  return false;
}

export function useIsCompactTouch(): boolean {
  return useSyncExternalStore(
    subscribeCompactTouch,
    compactTouchSnapshot,
    compactTouchServerSnapshot,
  );
}
