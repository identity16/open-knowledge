export type SwipeDismissSide = 'start' | 'end';

const DISMISS_DISTANCE_RATIO = 0.3;
const DISMISS_VELOCITY_PX_PER_MS = 0.5;
const DIRECTION_LOCK_PX = 10;
const SNAP_BACK_TRANSITION = 'transform 200ms cubic-bezier(0.22, 1, 0.36, 1)';

function closingSign(side: SwipeDismissSide, element: HTMLElement): number {
  const rtl = getComputedStyle(element).direction === 'rtl';
  return (side === 'start') !== rtl ? -1 : 1;
}

export function attachSwipeToDismiss(
  element: HTMLElement,
  side: SwipeDismissSide,
  onDismiss: () => void,
): () => void {
  let startX = 0;
  let startY = 0;
  let startTime = 0;
  let lastX = 0;
  let lastTime = 0;
  let velocity = 0;
  let mode: 'idle' | 'pending' | 'swiping' | 'scrolling' = 'idle';

  function reset() {
    mode = 'idle';
  }

  function onTouchStart(event: TouchEvent) {
    if (event.touches.length !== 1) {
      reset();
      return;
    }
    const touch = event.touches[0];
    if (!touch) return;
    startX = touch.clientX;
    startY = touch.clientY;
    lastX = startX;
    startTime = event.timeStamp;
    lastTime = startTime;
    velocity = 0;
    mode = 'pending';
  }

  function onTouchMove(event: TouchEvent) {
    if (mode === 'idle' || mode === 'scrolling') return;
    const touch = event.touches[0];
    if (!touch) return;
    const dx = touch.clientX - startX;
    const dy = touch.clientY - startY;
    if (mode === 'pending') {
      if (Math.abs(dx) < DIRECTION_LOCK_PX && Math.abs(dy) < DIRECTION_LOCK_PX) return;
      const sign = closingSign(side, element);
      mode = Math.abs(dx) > Math.abs(dy) && Math.sign(dx) === sign ? 'swiping' : 'scrolling';
      if (mode !== 'swiping') return;
      element.style.transition = 'none';
    }
    const sign = closingSign(side, element);
    const offset = sign < 0 ? Math.min(0, dx) : Math.max(0, dx);
    element.style.transform = `translateX(${offset}px)`;
    const dt = event.timeStamp - lastTime;
    if (dt > 0) velocity = (touch.clientX - lastX) / dt;
    lastX = touch.clientX;
    lastTime = event.timeStamp;
  }

  function onTouchEnd() {
    if (mode !== 'swiping') {
      reset();
      return;
    }
    reset();
    const sign = closingSign(side, element);
    const travelled = (lastX - startX) * sign;
    const flung = velocity * sign > DISMISS_VELOCITY_PX_PER_MS && lastTime - startTime < 400;
    if (travelled > element.clientWidth * DISMISS_DISTANCE_RATIO || flung) {
      onDismiss();
      return;
    }
    element.style.transition = SNAP_BACK_TRANSITION;
    element.style.transform = '';
    element.addEventListener(
      'transitionend',
      () => {
        element.style.transition = '';
      },
      { once: true },
    );
  }

  const options = { passive: true } as const;
  element.addEventListener('touchstart', onTouchStart, options);
  element.addEventListener('touchmove', onTouchMove, options);
  element.addEventListener('touchend', onTouchEnd, options);
  element.addEventListener('touchcancel', onTouchEnd, options);
  return () => {
    element.removeEventListener('touchstart', onTouchStart);
    element.removeEventListener('touchmove', onTouchMove);
    element.removeEventListener('touchend', onTouchEnd);
    element.removeEventListener('touchcancel', onTouchEnd);
  };
}
