import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { createNotionConnectionRegistry } from './connection-registry.ts';

const dirs: string[] = [];
function tempPath() {
  const dir = mkdtempSync(join(tmpdir(), 'ok-notion-registry-'));
  dirs.push(dir);
  return join(dir, 'home', 'notion.yml');
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const joon = {
  workspaceId: 'w1',
  workspaceName: 'Joon',
  workspaceIcon: null,
  connectedAt: '2026-11-18T00:00:00.000Z',
};

describe('createNotionConnectionRegistry', () => {
  test('starts empty when the file does not exist', () => {
    expect(createNotionConnectionRegistry(tempPath()).list()).toEqual([]);
  });

  test('upsert adds, replaces by workspace, and persists with owner-only permissions', () => {
    const path = tempPath();
    const registry = createNotionConnectionRegistry(path);
    registry.upsert(joon);
    registry.upsert({ ...joon, workspaceId: 'w2', workspaceName: 'MUFI' });
    registry.upsert({ ...joon, workspaceName: 'Joon renamed' });

    const reread = createNotionConnectionRegistry(path);
    expect(reread.list().map((c) => [c.workspaceId, c.workspaceName])).toEqual([
      ['w2', 'MUFI'],
      ['w1', 'Joon renamed'],
    ]);
    expect(reread.get('w2')?.workspaceName).toBe('MUFI');
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readFileSync(path, 'utf8')).not.toContain('token');
  });

  test('remove reports whether a connection was there', () => {
    const registry = createNotionConnectionRegistry(tempPath());
    registry.upsert(joon);
    expect(registry.remove('w1')).toBe(true);
    expect(registry.remove('w1')).toBe(false);
    expect(registry.list()).toEqual([]);
  });

  test('skips malformed entries instead of failing the whole list', () => {
    const path = tempPath();
    const registry = createNotionConnectionRegistry(path);
    registry.upsert(joon);
    writeFileSync(path, `${readFileSync(path, 'utf8')}  - workspaceName: no id\n`);
    expect(registry.list().map((c) => c.workspaceId)).toEqual(['w1']);
  });
});
