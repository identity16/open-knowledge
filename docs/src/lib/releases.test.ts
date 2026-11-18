import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { loadStableReleases, parseChangelog } from './releases';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function changelogFile(text: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'ok-docs-changelog-'));
  dirs.push(dir);
  const path = join(dir, 'CHANGELOG.md');
  writeFileSync(path, text);
  return path;
}

const SAMPLE = [
  '# Changelog',
  '',
  'User-facing changes.',
  '',
  '## 0.81.0 (2026-11-20)',
  '',
  '### Fixes',
  '',
  '- Fixed **it**.',
  '',
  '## 0.80.0',
  '',
  '- Undated.',
  '',
].join('\n');

describe('parseChangelog', () => {
  test('one release per dated section, newest first, linked to the fork', () => {
    const releases = parseChangelog(SAMPLE);
    expect(releases.map((r) => [r.tag, r.publishedAt, r.htmlUrl])).toEqual([
      [
        'v0.81.0',
        '2026-11-20T00:00:00.000Z',
        'https://github.com/identity16/open-knowledge/releases/tag/v0.81.0',
      ],
      ['v0.80.0', null, 'https://github.com/identity16/open-knowledge/releases/tag/v0.80.0'],
    ]);
    expect(releases[0]?.bodyHtml).toContain('<h3>Fixes</h3>');
    expect(releases[0]?.bodyHtml).toContain('<strong>it</strong>');
  });

  test('ignores the preamble and a non-version second-level heading', () => {
    const releases = parseChangelog(`${SAMPLE}## Unreleased\n\n- Not a release.\n`);
    expect(releases).toHaveLength(2);
    expect(releases[1]?.bodyHtml).not.toContain('Not a release');
  });
});

describe('loadStableReleases', () => {
  test('reads the file it is given and honours the limit', async () => {
    const releases = await loadStableReleases(1, { path: changelogFile(SAMPLE), env: {} });
    expect(releases.map((r) => r.tag)).toEqual(['v0.81.0']);
  });

  test('a missing file builds an empty changelog outside production and fails a production build', async () => {
    const missing = join(tmpdir(), 'ok-docs-changelog-missing', 'CHANGELOG.md');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(loadStableReleases(undefined, { path: missing, env: {} })).resolves.toEqual([]);
    expect(warn).toHaveBeenCalled();
    await expect(
      loadStableReleases(undefined, { path: missing, env: { VERCEL_ENV: 'production' } }),
    ).rejects.toThrow(/not found/);
  });

  test('a file without version sections is an error', async () => {
    await expect(
      loadStableReleases(undefined, { path: changelogFile('# Changelog\n'), env: {} }),
    ).rejects.toThrow(/no `## X.Y.Z` sections/);
  });

  test('the repository CHANGELOG.md parses into dated releases', async () => {
    const root = join(process.cwd(), '..', 'CHANGELOG.md');
    const releases = parseChangelog(readFileSync(root, 'utf8'));
    expect(releases.length).toBeGreaterThan(0);
    expect(releases.every((r) => r.publishedAt !== null && r.bodyHtml !== '')).toBe(true);
  });
});
