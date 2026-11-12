import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { parse } from 'yaml';
import development from '../../electron.vite.config';
import release from '../../electron.vite.release.config';

describe('packaged desktop compilation', () => {
  test('preserves the main and sandboxed preload builds', () => {
    expect(release.main).toBe(development.main);
    expect(release.preload).toBe(development.preload);
  });

  test('builds the renderer for development while packaging uses the existing web assets', () => {
    const builder = parse(
      readFileSync(new URL('../../electron-builder.yml', import.meta.url), 'utf8'),
    );
    const main = readFileSync(new URL('../../src/main/index.ts', import.meta.url), 'utf8');
    expect(development.renderer).toBeDefined();
    expect(release.renderer).toBeUndefined();
    expect(builder.files).toContain('!out/renderer/**');
    expect(main).toContain("app.isPackaged ? join(process.resourcesPath, 'app')");
  });
});
