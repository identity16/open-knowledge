import type { HocuspocusProvider } from '@hocuspocus/provider';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import * as Y from 'yjs';
import { setSvgViewMode } from '@/editor/svg-view-mode';

vi.doMock('@/components/ImageViewer', () => ({
  ImageViewer: ({ src, fileName }: { src: string; fileName: string }) => (
    <img data-testid="svg-preview-image" src={src} alt={fileName} />
  ),
}));

vi.doMock('./TextDocEditor', () => ({
  TextDocEditor: ({ docName }: { docName: string }) => (
    <div data-testid="svg-source-editor">{docName}</div>
  ),
}));

const DOC = 'art/logo.svg';

function fakeProvider(markup: string): { provider: HocuspocusProvider; ytext: Y.Text } {
  const document = new Y.Doc();
  const ytext = document.getText('source');
  ytext.insert(0, markup);
  return { provider: { document } as unknown as HocuspocusProvider, ytext };
}

function decodedSrc(): string {
  const src = screen.getByTestId('svg-preview-image').getAttribute('src') ?? '';
  return decodeURIComponent(src.replace('data:image/svg+xml;charset=utf-8,', ''));
}

describe('SvgDocView', () => {
  afterEach(() => {
    cleanup();
    setSvgViewMode(DOC, 'preview');
  });

  test('previews the document text as an image and follows edits', async () => {
    const { SvgDocView } = await import('./SvgDocView');
    const { provider, ytext } = fakeProvider('<svg><rect/></svg>');
    render(<SvgDocView docName={DOC} provider={provider} />);

    expect(decodedSrc()).toBe('<svg><rect/></svg>');
    act(() => {
      ytext.insert(ytext.length - '</svg>'.length, '<circle/>');
    });
    expect(decodedSrc()).toBe('<svg><rect/><circle/></svg>');
    expect(screen.queryByTestId('svg-source-editor')).toBeNull();
  });

  test('shows the source editor when the file is switched to source', async () => {
    const { SvgDocView } = await import('./SvgDocView');
    const { provider } = fakeProvider('<svg/>');
    render(<SvgDocView docName={DOC} provider={provider} />);

    act(() => setSvgViewMode(DOC, 'source'));
    expect(screen.getByTestId('svg-source-editor').textContent).toBe(DOC);
    expect(screen.queryByTestId('svg-preview-image')).toBeNull();

    act(() => setSvgViewMode(DOC, 'preview'));
    expect(screen.getByTestId('svg-preview-image')).toBeTruthy();
  });
});
