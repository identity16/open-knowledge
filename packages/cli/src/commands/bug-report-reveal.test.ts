import { describe, expect, test, vi } from 'vitest';
import { revealBundle } from './bug-report-reveal.ts';

describe('revealBundle argv shape', () => {
  const SPACED = '/Users/Jane Doe/.ok/bug-reports/2026-08-04-bugreport.zip';

  test('darwin selects the file via open -R', () => {
    const spawn = vi.fn();
    revealBundle(SPACED, 'darwin', spawn);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn).toHaveBeenCalledWith('/usr/bin/open', ['-R', SPACED]);
  });

  test('linux opens the containing folder via xdg-open', () => {
    const spawn = vi.fn();
    revealBundle(SPACED, 'linux', spawn);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn).toHaveBeenCalledWith('xdg-open', ['/Users/Jane Doe/.ok/bug-reports']);
  });

  test('a throwing spawner is swallowed — reveal is a best-effort nicety', () => {
    const spawn = vi.fn(() => {
      throw new Error('spawn failed');
    });
    expect(() => revealBundle(SPACED, 'darwin', spawn)).not.toThrow();
  });
});
