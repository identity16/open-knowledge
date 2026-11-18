import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  cutRelease,
  parseFragment,
  prependSection,
  readFragments,
  releaseNotes,
  renderSection,
  requireReleaseNotes,
  sectionVersions,
} from './changelog.mjs';

const dirs = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function workspace() {
  const dir = mkdtempSync(join(tmpdir(), 'ok-changelog-'));
  dirs.push(dir);
  mkdirSync(join(dir, 'changes'));
  return { dir, changes: join(dir, 'changes'), changelog: join(dir, 'CHANGELOG.md') };
}

const fragment = (type, note) => `---\ntype: ${type}\n---\n${note}\n`;

describe('parseFragment', () => {
  test('reads the type and joins the note into one line', () => {
    expect(
      parseFragment(fragment('fix', 'Publishing no longer\n  drops the title.'), 'a.md'),
    ).toEqual({
      type: 'fix',
      note: 'Publishing no longer drops the title.',
    });
  });

  test('rejects an unknown type, a missing frontmatter and an empty note', () => {
    expect(() => parseFragment(fragment('feat', 'x'), 'a.md')).toThrow(/type must be one of/);
    expect(() => parseFragment('just text\n', 'b.md')).toThrow(/frontmatter/);
    expect(() => parseFragment('---\ntype: fix\n---\n\n', 'c.md')).toThrow(/empty/);
  });
});

describe('renderSection', () => {
  test('groups notes under Features, Fixes and Changes in that order', () => {
    const section = renderSection('0.81.0', '2026-11-20', [
      { type: 'fix', note: 'Fixed A.' },
      { type: 'feature', note: 'Added B.' },
      { type: 'fix', note: 'Fixed C.' },
    ]);
    expect(section).toBe(
      '## 0.81.0 (2026-11-20)\n\n### Features\n\n- Added B.\n\n### Fixes\n\n- Fixed A.\n- Fixed C.\n',
    );
  });

  test('refuses a release with no notes or a malformed version or date', () => {
    expect(() => renderSection('0.81.0', '2026-11-20', [])).toThrow(/no change notes/);
    expect(() => renderSection('v0.81.0', '2026-11-20', [{ type: 'fix', note: 'x' }])).toThrow();
    expect(() => renderSection('0.81.0', '20.11.2026', [{ type: 'fix', note: 'x' }])).toThrow();
  });
});

describe('prependSection and releaseNotes', () => {
  const older = '# Changelog\n\nIntro.\n\n## 0.80.0 (2026-11-19)\n\n### Fixes\n\n- Old fix.\n';

  test('puts the new section above the newest one and keeps the intro', () => {
    const next = prependSection(older, '## 0.81.0 (2026-11-20)\n\n### Fixes\n\n- New fix.\n');
    expect(sectionVersions(next)).toEqual(['0.81.0', '0.80.0']);
    expect(next.startsWith('# Changelog\n\nIntro.\n\n## 0.81.0')).toBe(true);
  });

  test('starts a new changelog with its intro and refuses a version twice', () => {
    expect(prependSection('', '## 0.1.0 (2026-01-01)\n\n- x\n')).toMatch(/^# Changelog\n/);
    expect(() => prependSection(older, '## 0.80.0 (2026-11-21)\n\n- again\n')).toThrow(
      /already has a section for 0.80.0/,
    );
  });

  test('reads back one version’s notes without its heading or the next section', () => {
    const both = prependSection(older, '## 0.81.0 (2026-11-20)\n\n### Fixes\n\n- New fix.\n');
    expect(releaseNotes(both, '0.81.0')).toBe('### Fixes\n\n- New fix.');
    expect(releaseNotes(both, '0.80.0')).toBe('### Fixes\n\n- Old fix.');
    expect(releaseNotes(both, '0.79.0')).toBeNull();
  });
});

describe('cutRelease', () => {
  test('writes the section and removes the notes it used, leaving the README', () => {
    const w = workspace();
    writeFileSync(join(w.changes, 'README.md'), '# How to write a change note\n');
    writeFileSync(join(w.changes, 'b-fix.md'), fragment('fix', 'Fixed it.'));
    writeFileSync(join(w.changes, 'a-feature.md'), fragment('feature', 'Added it.'));

    const result = cutRelease('0.81.0', {
      date: '2026-11-20',
      directory: w.changes,
      path: w.changelog,
    });

    expect(result.consumed).toBe(2);
    expect(releaseNotes(readFileSync(w.changelog, 'utf8'), '0.81.0')).toBe(
      '### Features\n\n- Added it.\n\n### Fixes\n\n- Fixed it.',
    );
    expect(readFragments(w.changes)).toEqual([]);
    expect(existsSync(join(w.changes, 'README.md'))).toBe(true);
  });

  test('a bad note stops the release before anything is written or removed', () => {
    const w = workspace();
    writeFileSync(join(w.changes, 'good.md'), fragment('fix', 'Fine.'));
    writeFileSync(join(w.changes, 'bad.md'), fragment('oops', 'Nope.'));

    expect(() =>
      cutRelease('0.81.0', { date: '2026-11-20', directory: w.changes, path: w.changelog }),
    ).toThrow(/bad.md/);
    expect(existsSync(w.changelog)).toBe(false);
    expect(existsSync(join(w.changes, 'good.md'))).toBe(true);
  });
});

describe('requireReleaseNotes', () => {
  test('returns the notes, or names the command to run when they are missing', () => {
    const w = workspace();
    writeFileSync(w.changelog, '# Changelog\n\n## 0.81.0 (2026-11-20)\n\n### Fixes\n\n- Fixed.\n');
    const env = { OK_CHANGELOG_PATH: w.changelog };
    expect(requireReleaseNotes('0.81.0', env)).toBe('### Fixes\n\n- Fixed.');
    expect(() => requireReleaseNotes('0.82.0', env)).toThrow(/pnpm changelog:release 0.82.0/);
  });
});
