import { describe, expect, test, vi } from 'vitest';
import { copyImageAtClientPoint } from '../../src/main/copy-image.ts';

function target(zoom: number, destroyed = false) {
  return {
    isDestroyed: () => destroyed,
    getZoomFactor: () => zoom,
    copyImageAt: vi.fn((_x: number, _y: number) => {}),
  };
}

describe('copyImageAtClientPoint', () => {
  test('scales a renderer point by the page zoom before copying', () => {
    const contents = target(1.25);
    copyImageAtClientPoint(contents, { x: 100, y: 41 });
    expect(contents.copyImageAt).toHaveBeenCalledWith(125, 51);
  });

  test('does nothing for a destroyed page or a point that is not a number', () => {
    const destroyed = target(1, true);
    copyImageAtClientPoint(destroyed, { x: 1, y: 1 });
    const contents = target(1);
    copyImageAtClientPoint(contents, { x: Number.NaN, y: 1 });
    expect(destroyed.copyImageAt).not.toHaveBeenCalled();
    expect(contents.copyImageAt).not.toHaveBeenCalled();
  });
});
