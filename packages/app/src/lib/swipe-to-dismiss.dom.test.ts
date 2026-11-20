import { afterEach, describe, expect, test, vi } from 'vitest';
import { attachSwipeToDismiss } from './swipe-to-dismiss';

function touch(element: HTMLElement, type: string, x: number, y: number, timeStamp: number) {
  const event = new Event(type, { bubbles: true });
  const touches = type === 'touchend' ? [] : [{ clientX: x, clientY: y }];
  Object.defineProperty(event, 'touches', { value: touches });
  Object.defineProperty(event, 'timeStamp', { value: timeStamp });
  element.dispatchEvent(event);
}

function makeCover(width = 300) {
  const element = document.createElement('section');
  Object.defineProperty(element, 'clientWidth', { value: width });
  document.body.append(element);
  return element;
}

describe('attachSwipeToDismiss', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  test('a start-side cover follows a leftward drag and dismisses past a third of its width', () => {
    const element = makeCover();
    const onDismiss = vi.fn();
    attachSwipeToDismiss(element, 'start', onDismiss);

    touch(element, 'touchstart', 200, 100, 0);
    touch(element, 'touchmove', 150, 102, 400);
    expect(element.style.transform).toBe('translateX(-50px)');
    touch(element, 'touchmove', 80, 104, 800);
    touch(element, 'touchend', 80, 104, 820);

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  test('a short slow drag snaps back instead of dismissing', () => {
    const element = makeCover();
    const onDismiss = vi.fn();
    attachSwipeToDismiss(element, 'start', onDismiss);

    touch(element, 'touchstart', 200, 100, 0);
    touch(element, 'touchmove', 170, 100, 500);
    touch(element, 'touchend', 170, 100, 520);

    expect(onDismiss).not.toHaveBeenCalled();
    expect(element.style.transform).toBe('');
  });

  test('a quick flick dismisses even when it travels a short distance', () => {
    const element = makeCover();
    const onDismiss = vi.fn();
    attachSwipeToDismiss(element, 'start', onDismiss);

    touch(element, 'touchstart', 200, 100, 0);
    touch(element, 'touchmove', 185, 100, 20);
    touch(element, 'touchmove', 160, 100, 50);
    touch(element, 'touchend', 160, 100, 60);

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  test('vertical scrolling and swipes toward the open direction are left alone', () => {
    const element = makeCover();
    const onDismiss = vi.fn();
    attachSwipeToDismiss(element, 'start', onDismiss);

    touch(element, 'touchstart', 200, 100, 0);
    touch(element, 'touchmove', 190, 160, 50);
    touch(element, 'touchmove', 60, 220, 100);
    touch(element, 'touchend', 60, 220, 110);

    touch(element, 'touchstart', 100, 100, 200);
    touch(element, 'touchmove', 250, 100, 250);
    touch(element, 'touchend', 250, 100, 260);

    expect(onDismiss).not.toHaveBeenCalled();
    expect(element.style.transform).toBe('');
  });

  test('an end-side cover dismisses on a rightward swipe', () => {
    const element = makeCover();
    const onDismiss = vi.fn();
    attachSwipeToDismiss(element, 'end', onDismiss);

    touch(element, 'touchstart', 100, 100, 0);
    touch(element, 'touchmove', 220, 100, 400);
    touch(element, 'touchend', 220, 100, 420);

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  test('detaching stops listening', () => {
    const element = makeCover();
    const onDismiss = vi.fn();
    const detach = attachSwipeToDismiss(element, 'start', onDismiss);
    detach();

    touch(element, 'touchstart', 200, 100, 0);
    touch(element, 'touchmove', 20, 100, 50);
    touch(element, 'touchend', 20, 100, 60);

    expect(onDismiss).not.toHaveBeenCalled();
  });
});
