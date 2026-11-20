type InputModality = 'keyboard' | 'mouse' | 'pen' | 'touch';

let lastInputModality: InputModality = 'keyboard';
let listening = false;

function rememberPointer(event: PointerEvent) {
  lastInputModality =
    event.pointerType === 'touch' || event.pointerType === 'pen' ? event.pointerType : 'mouse';
}

function rememberKeyboard() {
  lastInputModality = 'keyboard';
}

export function listenForInputModality(): void {
  if (listening || typeof document === 'undefined') return;
  listening = true;
  document.addEventListener('pointerdown', rememberPointer, { capture: true, passive: true });
  document.addEventListener('keydown', rememberKeyboard, { capture: true, passive: true });
}

export function lastInputWasTouch(): boolean {
  return lastInputModality === 'touch';
}
