import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { createNotionBaseStore } from './base-store.ts';

const PAGE = '41ca0a3f-aba4-8150-aad5-c7e056948abe';
const dirs: string[] = [];
function store() {
  const dir = mkdtempSync(join(tmpdir(), 'ok-notion-base-'));
  dirs.push(dir);
  return { dir: join(dir, 'notion'), bases: createNotionBaseStore(join(dir, 'notion')) };
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const base = { page: PAGE, workspace: 'w1', docName: 'notes/a', markdown: '# A', publishedAt: 'x' };

describe('createNotionBaseStore', () => {
  test('round-trips a base keyed by page id with owner-only permissions', () => {
    const { dir, bases } = store();
    expect(bases.get(PAGE)).toBeNull();
    bases.set(base);
    expect(bases.get(PAGE)).toEqual(base);
    expect(statSync(join(dir, `${PAGE}.json`)).mode & 0o777).toBe(0o600);
  });

  test('a renamed document keeps the same base because the key is the page', () => {
    const { bases } = store();
    bases.set(base);
    bases.set({ ...base, docName: 'renamed/b' });
    expect(bases.get(PAGE)?.docName).toBe('renamed/b');
  });

  test('a corrupt file reads as no base, and remove deletes it', () => {
    const { dir, bases } = store();
    bases.set(base);
    writeFileSync(join(dir, `${PAGE}.json`), '{not json');
    expect(bases.get(PAGE)).toBeNull();
    bases.remove(PAGE);
    bases.remove(PAGE);
  });

  test('refuses a key that is not a page id, so it cannot escape the directory', () => {
    const { bases } = store();
    expect(() => bases.get('../../etc/passwd')).toThrow();
  });
});
