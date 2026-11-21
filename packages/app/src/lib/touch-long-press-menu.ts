const LONG_PRESS_DELAY_MS = 500;
const LONG_PRESS_MOVE_TOLERANCE_PX = 10;

function rowFromEvent(event: Event, rowSelector: string): HTMLElement | null {
  for (const target of event.composedPath()) {
    if (target instanceof HTMLElement && target.matches(rowSelector)) return target;
  }
  return null;
}

export function attachTouchLongPressContextMenu(
  host: HTMLElement,
  rowSelector: string,
): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let startX = 0;
  let startY = 0;
  let fired = false;

  function cancel() {
    if (timer != null) clearTimeout(timer);
    timer = null;
  }

  function onTouchStart(event: TouchEvent) {
    cancel();
    fired = false;
    if (event.touches.length !== 1) return;
    const touch = event.touches[0];
    const row = rowFromEvent(event, rowSelector);
    if (!touch || !row) return;
    startX = touch.clientX;
    startY = touch.clientY;
    timer = setTimeout(() => {
      timer = null;
      if (!row.isConnected) return;
      fired = true;
      row.dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          composed: true,
          clientX: startX,
          clientY: startY,
        }),
      );
    }, LONG_PRESS_DELAY_MS);
  }

  function onTouchMove(event: TouchEvent) {
    const touch = event.touches[0];
    if (timer == null || !touch) return;
    const dx = touch.clientX - startX;
    const dy = touch.clientY - startY;
    if (dx * dx + dy * dy > LONG_PRESS_MOVE_TOLERANCE_PX * LONG_PRESS_MOVE_TOLERANCE_PX) cancel();
  }

  function onTouchEnd(event: TouchEvent) {
    cancel();
    if (!fired) return;
    fired = false;
    if (event.cancelable) event.preventDefault();
  }

  function onPointerDown(event: PointerEvent) {
    if (event.pointerType === 'touch' && rowFromEvent(event, rowSelector)) event.preventDefault();
  }

  function onNativeContextMenu(event: MouseEvent) {
    if (event.isTrusted) cancel();
  }

  host.addEventListener('pointerdown', onPointerDown, { capture: true });
  host.addEventListener('touchstart', onTouchStart, { capture: true, passive: true });
  host.addEventListener('touchmove', onTouchMove, { capture: true, passive: true });
  host.addEventListener('touchend', onTouchEnd, { capture: true, passive: false });
  host.addEventListener('touchcancel', cancel, { capture: true, passive: true });
  host.addEventListener('contextmenu', onNativeContextMenu, { capture: true });
  return () => {
    cancel();
    host.removeEventListener('pointerdown', onPointerDown, { capture: true });
    host.removeEventListener('touchstart', onTouchStart, { capture: true });
    host.removeEventListener('touchmove', onTouchMove, { capture: true });
    host.removeEventListener('touchend', onTouchEnd, { capture: true });
    host.removeEventListener('touchcancel', cancel, { capture: true });
    host.removeEventListener('contextmenu', onNativeContextMenu, { capture: true });
  };
}
