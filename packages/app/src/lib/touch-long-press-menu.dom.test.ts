import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { attachTouchLongPressContextMenu } from './touch-long-press-menu';

function touchEvent(type: string, x = 0, y = 0) {
  const event = new Event(type, { bubbles: true, cancelable: true, composed: true });
  const touches = type === 'touchend' || type === 'touchcancel' ? [] : [{ clientX: x, clientY: y }];
  Object.defineProperty(event, 'touches', { value: touches });
  return event;
}

function pointerDown(pointerType: string) {
  const event = new Event('pointerdown', { bubbles: true, cancelable: true, composed: true });
  Object.defineProperty(event, 'pointerType', { value: pointerType });
  return event;
}

function setup() {
  const host = document.createElement('div');
  const shadow = host.attachShadow({ mode: 'open' });
  const row = document.createElement('button');
  row.dataset.itemPath = 'note.md';
  shadow.append(row);
  document.body.append(host);
  const contextMenus: MouseEvent[] = [];
  row.addEventListener('contextmenu', (event) => contextMenus.push(event));
  const detach = attachTouchLongPressContextMenu(host, '[data-item-path]');
  return { host, row, contextMenus, detach };
}

describe('attachTouchLongPressContextMenu', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  test('holding a row opens its context menu at the touch point and swallows the release', () => {
    const { row, contextMenus } = setup();

    row.dispatchEvent(touchEvent('touchstart', 40, 120));
    vi.advanceTimersByTime(500);

    expect(contextMenus).toHaveLength(1);
    expect(contextMenus[0]?.clientX).toBe(40);
    expect(contextMenus[0]?.clientY).toBe(120);

    const release = touchEvent('touchend');
    row.dispatchEvent(release);
    expect(release.defaultPrevented).toBe(true);
  });

  test('a quick tap is left alone', () => {
    const { row, contextMenus } = setup();

    row.dispatchEvent(touchEvent('touchstart', 40, 120));
    vi.advanceTimersByTime(150);
    const release = touchEvent('touchend');
    row.dispatchEvent(release);
    vi.advanceTimersByTime(1000);

    expect(contextMenus).toHaveLength(0);
    expect(release.defaultPrevented).toBe(false);
  });

  test('moving the finger cancels the press so the list can scroll', () => {
    const { row, contextMenus } = setup();

    row.dispatchEvent(touchEvent('touchstart', 40, 120));
    row.dispatchEvent(touchEvent('touchmove', 40, 150));
    vi.advanceTimersByTime(1000);

    expect(contextMenus).toHaveLength(0);
  });

  test('a touch press on a row opts out of outer pointer long-press handlers; mouse presses do not', () => {
    const { row } = setup();

    const touchPress = pointerDown('touch');
    row.dispatchEvent(touchPress);
    const mousePress = pointerDown('mouse');
    row.dispatchEvent(mousePress);

    expect(touchPress.defaultPrevented).toBe(true);
    expect(mousePress.defaultPrevented).toBe(false);
  });

  test('detaching cancels a pending press and stops listening', () => {
    const { row, contextMenus, detach } = setup();

    row.dispatchEvent(touchEvent('touchstart', 40, 120));
    detach();
    vi.advanceTimersByTime(1000);
    row.dispatchEvent(touchEvent('touchstart', 40, 120));
    vi.advanceTimersByTime(1000);

    expect(contextMenus).toHaveLength(0);
  });
});
