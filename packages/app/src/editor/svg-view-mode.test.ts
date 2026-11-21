import { afterEach, describe, expect, test } from 'vitest';
import { getSvgViewMode, isSvgDocFile, setSvgViewMode } from './svg-view-mode';

describe('svg view mode', () => {
  afterEach(() => {
    setSvgViewMode('a.svg', 'preview');
    setSvgViewMode('b.svg', 'preview');
  });

  test('recognises SVG doc names case-insensitively and nothing else', () => {
    expect(isSvgDocFile('art/logo.svg')).toBe(true);
    expect(isSvgDocFile('art/LOGO.SVG')).toBe(true);
    expect(isSvgDocFile('art/logo.svgz')).toBe(false);
    expect(isSvgDocFile('notes/svg')).toBe(false);
  });

  test('every SVG starts in preview and switches independently', () => {
    expect(getSvgViewMode('a.svg')).toBe('preview');
    setSvgViewMode('a.svg', 'source');
    expect(getSvgViewMode('a.svg')).toBe('source');
    expect(getSvgViewMode('b.svg')).toBe('preview');
    setSvgViewMode('a.svg', 'preview');
    expect(getSvgViewMode('a.svg')).toBe('preview');
  });
});
