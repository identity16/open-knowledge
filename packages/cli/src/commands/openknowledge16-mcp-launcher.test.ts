import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { buildManagedServerEntry } from './editors.ts';

afterEach(() => vi.unstubAllEnvs());

describe('fork MCP launcher isolation', () => {
  test('runs the fork wrapper with its own channel instead of upstream npm', () => {
    const home = mkdtempSync(join(tmpdir(), 'ok16-mcp-'));
    try {
      const bundle = join(
        home,
        'Applications',
        'OpenKnowledge16.app',
        'Contents/Resources/cli/bin',
      );
      mkdirSync(bundle, { recursive: true });
      const wrapper = join(bundle, 'ok.sh');
      writeFileSync(wrapper, '#!/bin/sh\nprintf "%s:%s" "$OK_CHANNEL" "$1"\n');
      chmodSync(wrapper, 0o755);
      vi.stubEnv('OK_CHANNEL', 'openknowledge16');
      const entry = buildManagedServerEntry({ mode: 'published', platformName: 'darwin' });
      const args = entry.args as string[];
      const chain = args[2] ?? '';
      const result = spawnSync('/bin/sh', ['-c', chain], {
        env: { HOME: home, PATH: '/usr/bin:/bin' },
        encoding: 'utf8',
      });
      expect(result.status).toBe(0);
      expect(result.stdout).toBe('identity16:mcp');
      expect(chain).not.toContain('npx');
      expect(chain).not.toContain('OpenKnowledge.app');
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
