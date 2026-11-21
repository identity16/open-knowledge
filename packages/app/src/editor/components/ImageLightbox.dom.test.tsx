import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

vi.doMock('@/components/ImageViewer', () => ({
  ImageViewer: ({ src, fileName }: { src: string; fileName: string }) => (
    <div data-testid="lightbox-viewer" data-src={src} data-file-name={fileName} />
  ),
}));

const { ZoomableImage } = await import('./ImageLightbox');

describe('ZoomableImage', () => {
  afterEach(() => {
    cleanup();
  });

  test('opens the image in the zoomable viewer on click and closes on Escape', () => {
    render(
      <ZoomableImage src="/assets/cat.png" alt="A cat">
        <img src="/assets/cat.png" alt="A cat" />
      </ZoomableImage>,
    );
    expect(screen.queryByTestId('image-lightbox')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Expand image' }));
    const viewer = screen.getByTestId('lightbox-viewer');
    expect(viewer.getAttribute('data-src')).toBe('/assets/cat.png');
    expect(viewer.getAttribute('data-file-name')).toBe('A cat');

    fireEvent.keyDown(screen.getByTestId('image-lightbox'), { key: 'Escape' });
    expect(screen.queryByTestId('image-lightbox')).toBeNull();
  });

  test('falls back to the file name when the image has no alt text', () => {
    render(
      <ZoomableImage src="/assets/cat.png" alt="">
        <img src="/assets/cat.png" alt="" />
      </ZoomableImage>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Expand image' }));
    expect(screen.getByTestId('lightbox-viewer').getAttribute('data-file-name')).toBe('cat.png');
  });

  test('an image without a src is not expandable', () => {
    render(
      <ZoomableImage src={undefined} alt="">
        <img alt="" />
      </ZoomableImage>,
    );
    expect(screen.queryByRole('button', { name: 'Expand image' })).toBeNull();
  });
});
