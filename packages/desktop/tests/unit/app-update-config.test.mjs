import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { parse } from 'yaml';
import { appUpdateConfig, ensureAppUpdateConfig } from '../../scripts/app-update-config.mjs';

const dirs = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const packager = {
  config: {
    publish: [
      {
        provider: 'generic',
        url: 'https://github.com/identity16/open-knowledge/releases/latest/download',
        channel: 'latest',
      },
    ],
  },
  appInfo: { updaterCacheDirName: 'openknowledge16-updater' },
};

describe('app-update.yml for directory builds', () => {
  test('writes the first publish entry with the updater cache dir before signing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'app-update-'));
    dirs.push(dir);
    const result = ensureAppUpdateConfig(dir, packager);
    expect(result.written).toBe(true);
    expect(parse(readFileSync(result.path, 'utf8'))).toEqual({
      provider: 'generic',
      url: 'https://github.com/identity16/open-knowledge/releases/latest/download',
      channel: 'latest',
      updaterCacheDirName: 'openknowledge16-updater',
    });
  });

  test('keeps a file electron-builder already wrote', () => {
    const dir = mkdtempSync(join(tmpdir(), 'app-update-'));
    dirs.push(dir);
    writeFileSync(join(dir, 'app-update.yml'), 'provider: github\n');
    expect(ensureAppUpdateConfig(dir, packager).written).toBe(false);
    expect(readFileSync(join(dir, 'app-update.yml'), 'utf8')).toBe('provider: github\n');
  });

  test('refuses to invent a feed when no publish provider is configured', () => {
    expect(() => appUpdateConfig([], 'x-updater')).toThrow(/no publish provider/);
    expect(appUpdateConfig({ provider: 'github', owner: 'o', repo: 'r' }, 'x').provider).toBe(
      'github',
    );
  });
});
