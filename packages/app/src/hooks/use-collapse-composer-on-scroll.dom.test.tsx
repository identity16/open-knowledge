import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  shouldCollapseOnScroll,
  useCollapseComposerOnScroll,
} from './use-collapse-composer-on-scroll';
import { COMPACT_TOUCH_QUERY } from './use-is-compact-touch';

let compactTouch = true;

beforeEach(() => {
  compactTouch = true;
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query === COMPACT_TOUCH_QUERY ? compactTouch : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Harness({ enabled = true, onCollapse }: { enabled?: boolean; onCollapse: () => void }) {
  const ref = useCollapseComposerOnScroll({ enabled, onCollapse });
  return (
    <div ref={ref}>
      <div data-testid="scroller" />
      <div data-bottom-composer="">
        <div data-testid="composer-scroller" />
        <input data-testid="composer-input" />
      </div>
    </div>
  );
}

function scrollTo(element: HTMLElement, top: number) {
  element.scrollTop = top;
  element.dispatchEvent(new Event('scroll'));
}

describe('shouldCollapseOnScroll', () => {
  test('collapses on a deliberate downward scroll past the top', () => {
    expect(shouldCollapseOnScroll(40, 80)).toBe(true);
  });

  test('ignores small jitter, upward scrolls and scrolls near the top', () => {
    expect(shouldCollapseOnScroll(100, 110)).toBe(false);
    expect(shouldCollapseOnScroll(200, 100)).toBe(false);
    expect(shouldCollapseOnScroll(0, 30)).toBe(false);
  });
});

describe('useCollapseComposerOnScroll', () => {
  test('collapses when the document scrolls down on a compact touch screen', () => {
    const onCollapse = vi.fn();
    render(<Harness onCollapse={onCollapse} />);
    const scroller = screen.getByTestId('scroller');
    scrollTo(scroller, 0);
    scrollTo(scroller, 120);
    expect(onCollapse).toHaveBeenCalledTimes(1);
  });

  test('does nothing on screens that are not compact touch screens', () => {
    compactTouch = false;
    const onCollapse = vi.fn();
    render(<Harness onCollapse={onCollapse} />);
    const scroller = screen.getByTestId('scroller');
    scrollTo(scroller, 0);
    scrollTo(scroller, 120);
    expect(onCollapse).not.toHaveBeenCalled();
  });

  test('does nothing once the composer is already collapsed', () => {
    const onCollapse = vi.fn();
    render(<Harness enabled={false} onCollapse={onCollapse} />);
    const scroller = screen.getByTestId('scroller');
    scrollTo(scroller, 0);
    scrollTo(scroller, 120);
    expect(onCollapse).not.toHaveBeenCalled();
  });

  test('ignores scrolling inside the composer itself', () => {
    const onCollapse = vi.fn();
    render(<Harness onCollapse={onCollapse} />);
    const composerScroller = screen.getByTestId('composer-scroller');
    scrollTo(composerScroller, 0);
    scrollTo(composerScroller, 120);
    expect(onCollapse).not.toHaveBeenCalled();
  });

  test('keeps the composer open while the user is typing in it', () => {
    const onCollapse = vi.fn();
    render(<Harness onCollapse={onCollapse} />);
    screen.getByTestId('composer-input').focus();
    const scroller = screen.getByTestId('scroller');
    scrollTo(scroller, 0);
    scrollTo(scroller, 120);
    expect(onCollapse).not.toHaveBeenCalled();
  });
});
