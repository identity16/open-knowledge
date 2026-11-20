import { flushSync } from 'react-dom';

export const MASCOT_VIEW_TRANSITION_NAME = 'ok-blob-mascot';

type ViewTransitionDocument = Document & {
  startViewTransition?: (callback: () => void) => {
    finished: Promise<void>;
    updateCallbackDone: Promise<void>;
  };
};

export function withViewTransition(update: () => void): Promise<void> {
  if (typeof document === 'undefined') {
    update();
    return Promise.resolve();
  }
  const start = (document as ViewTransitionDocument).startViewTransition;
  const prefersReducedMotion =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (typeof start !== 'function' || prefersReducedMotion) {
    update();
    return Promise.resolve();
  }
  const transition = start.call(document, () => {
    flushSync(update);
  });
  return transition.updateCallbackDone.catch(() => {});
}
