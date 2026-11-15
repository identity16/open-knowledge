import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { gitCleanEnv } from './git-clean-env.mjs';
import {
  compareDefinitions,
  inspectTestChanges,
  renderTestChanges,
  testDefinitions,
} from './test-changes.mjs';

const fixtures = [];
afterEach(() => {
  for (const path of fixtures.splice(0)) rmSync(path, { recursive: true, force: true });
});
const scan = (source) => testDefinitions('behavior.test.ts', source);

test('reports generic window and POSIX tests even inside a Windows skip wrapper', () => {
  const before = scan(
    "describe.skipIf(process.platform === 'win32')('result window', () => { test('stops its own window', () => expect(true).toBe(true)); });",
  );
  const report = compareDefinitions(before, []);
  expect(report.removed.map((entry) => entry.titles.join(' > '))).toEqual([
    'result window',
    'result window > stops its own window',
  ]);
});

test('recognizes aliases, namespace runners, default node:test, chained each and tagged each', () => {
  const source = [
    "import { it as scenario } from 'vitest';",
    "import * as v from 'vitest';",
    "import check from 'node:test';",
    "scenario.skipIf(false).each([1])('one %s', () => {});",
    "v.describe('suite', () => v.test('two', () => {}));",
    "check('three', () => {});",
    "test.each`value\nrow`('four', () => {});",
    "test.todo('five');",
  ].join('\n');
  expect(
    scan(source)
      .filter((entry) => entry.kind === 'test')
      .map((entry) => entry.titles.at(-1)),
  ).toEqual(['one %s', 'two', 'three', 'four', 'five']);
});

test('ignores comments, strings, assertions, hooks and test.step helpers', () => {
  expect(
    scan(
      "const text = \"test('fake', () => {})\"; beforeEach(() => {}); test.step('phase', () => {}); expect('test').toBe('test');",
    ),
  ).toEqual([]);
});

test('inventories variable and computed titles without executing their data', () => {
  const source =
    "for (const name of names) { test(name, () => {}); } describe(label, () => it(prefix + ' child', handler)); const conditional = test.skipIf(enabled);";
  expect(scan(source).map((entry) => entry.titles)).toEqual([
    ['<expression: name>'],
    ['<expression: label>'],
    ['<expression: label>', "<expression: prefix + ' child'>"],
  ]);
});

test('keeps node:test context subtests under their parent and accepts callback references', () => {
  const definitions = scan(
    "import test from 'node:test'; test('parent', async (t) => { await t.test('child', () => {}); }); test('reference', runScenario);",
  );
  expect(definitions.map((entry) => entry.titles)).toEqual([
    ['parent'],
    ['parent', 'child'],
    ['reference'],
  ]);
});

test('distinguishes duplicates and reports renamed definitions as removed and added', () => {
  const before = scan("test('same', () => {}); test('same', () => {}); test('old', () => {});");
  const after = scan("test('same', () => {}); test('new', () => {});");
  const report = compareDefinitions(before, after);
  expect(report.removed.map((entry) => [entry.titles[0], entry.occurrence])).toEqual([
    ['same', 1],
    ['old', 0],
  ]);
  expect(report.added.map((entry) => entry.titles[0])).toEqual(['new']);
});

test('reports body changes and inherited skip changes without marking unchanged bodies', () => {
  const before = scan(
    "describe.skipIf(false)('suite', () => { test('one', () => expect(1).toBe(1)); });",
  );
  const after = scan(
    "describe.skipIf(true)('suite', () => { test('one', () => expect(1).toBe(1)); });",
  );
  expect(compareDefinitions(before, after).modified).toHaveLength(2);
  expect(
    compareDefinitions(
      scan("test('one',()=>{expect(1).toBe(1)});"),
      scan("test('one', () => { expect(1).toBe(1); });"),
    ).modified,
  ).toEqual([]);
});

test('rejects invalid syntax rather than silently reporting that tests disappeared', () => {
  expect(() => scan("test('broken', () => {")).toThrow('invalid syntax');
});

test('compares committed snapshots including deleted files and file renames', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'test-changes-'));
  fixtures.push(cwd);
  const git = (...args) =>
    execFileSync('git', args, { cwd, env: gitCleanEnv(), encoding: 'utf8' }).trim();
  git('init', '--quiet');
  git('config', 'user.email', 'fixture@example.test');
  git('config', 'user.name', 'Fixture');
  writeFileSync(join(cwd, 'old.test.ts'), "test('safe path', () => {});");
  git('add', 'old.test.ts');
  git('-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'base');
  const base = git('rev-parse', 'HEAD');
  git('mv', 'old.test.ts', 'new.test.ts');
  git('-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'rename');
  const report = inspectTestChanges(base, 'HEAD', cwd);
  expect(report.removed[0].path).toBe('old.test.ts');
  expect(report.added[0].path).toBe('new.test.ts');
  expect(report.headSha).toBe(git('rev-parse', 'HEAD'));
});

test('escapes untrusted titles and filenames in the PR summary', () => {
  const report = {
    baseSha: 'a',
    headSha: 'b',
    removed: [
      { path: '<file>|.test.ts', line: 1, kind: 'test', titles: ['<script>[click](url) | `code`'] },
    ],
    added: [],
    modified: [],
  };
  const text = renderTestChanges(report);
  expect(text).toContain('&lt;script&gt;&#91;click&#93;');
  expect(text).not.toContain('<script>');
  expect(text).toContain('Parameterized rows are not expanded');
});
