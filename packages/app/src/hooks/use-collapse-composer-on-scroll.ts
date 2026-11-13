import { useEffect, useRef } from 'react';
import { useIsCompactTouch } from './use-is-compact-touch';

export const COLLAPSE_SCROLL_DELTA_PX = 24;
export const COLLAPSE_MIN_SCROLL_TOP_PX = 48;

export const COMPOSER_ROOT_SELECTOR = '[data-bottom-composer]';

export function shouldCollapseOnScroll(previousTop: number, nextTop: number): boolean {
  return nextTop >= COLLAPSE_MIN_SCROLL_TOP_PX && nextTop - previousTop >= COLLAPSE_SCROLL_DELTA_PX;
}

export function useCollapseComposerOnScroll({
  enabled,
  onCollapse,
}: {
  enabled: boolean;
  onCollapse: () => void;
}): (element: HTMLElement | null) => (() => void) | undefined {
  const compactTouch = useIsCompactTouch();
  const active = enabled && compactTouch;
  const onCollapseRef = useRef(onCollapse);
  useEffect(() => {
    onCollapseRef.current = onCollapse;
  });

  return (element: HTMLElement | null) => {
    if (element === null || !active) return undefined;
    const lastTops = new WeakMap<EventTarget, number>();
    const handleScroll = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.closest(COMPOSER_ROOT_SELECTOR) !== null) return;
      const nextTop = target.scrollTop;
      const previousTop = lastTops.get(target);
      lastTops.set(target, nextTop);
      if (previousTop === undefined) return;
      if (!shouldCollapseOnScroll(previousTop, nextTop)) return;
      const focused = document.activeElement;
      if (focused instanceof Element && focused.closest(COMPOSER_ROOT_SELECTOR) !== null) return;
      onCollapseRef.current();
    };
    element.addEventListener('scroll', handleScroll, { capture: true, passive: true });
    return () => element.removeEventListener('scroll', handleScroll, { capture: true });
  };
}
