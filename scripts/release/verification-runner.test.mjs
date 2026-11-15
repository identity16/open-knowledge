import { execFileSync, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { gitCleanEnv } from '../git-clean-env.mjs';
import { verificationGithub } from './verification.test-helper.mjs';
import './verify.mjs';

const fixtures = [];
afterEach(() => {
  for (const path of fixtures.splice(0)) rmSync(path, { recursive: true, force: true });
});

function workspace(exitCode) {
  const outer = realpathSync(mkdtempSync(join(tmpdir(), 'verification-runner-')));
  fixtures.push(outer);
  const root = join(outer, 'repository');
  const scripts = join(root, 'scripts/release');
  const bin = join(outer, 'bin');
  const receipt = join(outer, 'receipt.json');
  const observed = join(outer, 'observed');
  mkdirSync(scripts, { recursive: true });
  mkdirSync(bin);
  for (const file of ['verify', 'verification', 'cache-preflight'])
    copyFileSync(new URL(`./${file}.mjs`, import.meta.url), join(scripts, `${file}.mjs`));
  copyFileSync(
    new URL('../git-clean-env.mjs', import.meta.url),
    join(root, 'scripts/git-clean-env.mjs'),
  );
  const backend = join(outer, 'backend.cjs');
  writeFileSync(
    backend,
    [
      "const fs = require('node:fs');",
      `const receipt = JSON.parse(fs.readFileSync(${JSON.stringify(receipt)}, 'utf8'));`,
      `fs.appendFileSync(${JSON.stringify(observed)}, JSON.stringify(receipt) + "\\n");`,
      `process.exit(${exitCode});`,
    ].join('\n'),
  );
  const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
  writeFileSync(
    join(bin, 'pnpm'),
    `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(backend)} "$@"\n`,
    { mode: 0o700 },
  );
  const git = (...args) =>
    execFileSync('git', args, { cwd: root, env: gitCleanEnv(), encoding: 'utf8' }).trim();
  git('init', '--quiet');
  git('config', 'user.email', 'fixture@example.test');
  git('config', 'user.name', 'Fixture');
  git('add', '.');
  git('-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'base');
  const base = git('rev-parse', 'HEAD');
  writeFileSync(join(root, 'change.ts'), 'export const value = 1;\n');
  git('add', 'change.ts');
  git('-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'change');
  return { root, bin, receipt, observed, base, head: git('rev-parse', 'HEAD') };
}

test.each([0, 7])(
  'writes running evidence before commands and final evidence after exit %s',
  (exitCode) => {
    const f = workspace(exitCode);
    const result = spawnSync(
      process.execPath,
      [join(f.root, 'scripts/release/verify.mjs'), f.base, f.receipt],
      {
        cwd: f.root,
        encoding: 'utf8',
        env: { ...gitCleanEnv(), PATH: `${f.bin}:${process.env.PATH}` },
        timeout: 10_000,
      },
    );
    expect(result.status, result.stderr).toBe(exitCode === 0 ? 0 : 1);
    const receipt = JSON.parse(readFileSync(f.receipt, 'utf8'));
    const observations = readFileSync(f.observed, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(observations).toHaveLength(2);
    expect(observations.every((entry) => entry.status === 'running' && !entry.completedAt)).toBe(
      true,
    );
    expect(observations[0].steps).toEqual([]);
    expect(observations[1].steps).toHaveLength(1);
    expect(receipt).toMatchObject({
      headSha: f.head,
      baseSha: f.base,
      changedFiles: ['change.ts'],
      sourceClean: true,
      requiredSteps: ['biome', 'oxlint'],
      status: exitCode === 0 ? 'passed' : 'failed',
    });
    expect(receipt.steps.map((step) => step.ok)).toEqual([exitCode === 0, exitCode === 0]);
  },
);

test('cannot certify uncommitted source in CI even when every command succeeds', () => {
  const f = workspace(0);
  writeFileSync(join(f.root, 'change.ts'), 'export const value = 2;\n');
  const result = spawnSync(
    process.execPath,
    [join(f.root, 'scripts/release/verify.mjs'), f.base, f.receipt],
    {
      cwd: f.root,
      encoding: 'utf8',
      env: { ...gitCleanEnv(), PATH: `${f.bin}:${process.env.PATH}`, GITHUB_ACTIONS: 'true' },
      timeout: 10_000,
    },
  );
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('source tree differs');
  const receipt = JSON.parse(readFileSync(f.receipt, 'utf8'));
  expect(receipt.steps.every((step) => step.ok)).toBe(true);
  expect(receipt).toMatchObject({ status: 'failed', sourceClean: false });
});

test('executes verification when the CLI entry path is a symlink', () => {
  const f = workspace(0);
  const entry = join(dirname(f.root), 'verify-entry.mjs');
  symlinkSync(join(f.root, 'scripts/release/verify.mjs'), entry);
  const result = spawnSync(process.execPath, [entry, f.base, f.receipt], {
    cwd: f.root,
    encoding: 'utf8',
    env: { ...gitCleanEnv(), PATH: `${f.bin}:${process.env.PATH}` },
    timeout: 10_000,
  });
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(readFileSync(f.receipt, 'utf8'))).toMatchObject({
    status: 'passed',
    sourceClean: true,
  });
});

test('resolves the successful Git ancestor through the actual baseline CLI', () => {
  const f = workspace(0);
  const backend = join(dirname(f.root), 'github.cjs');
  writeFileSync(
    backend,
    `console.log(${JSON.stringify(JSON.stringify([{ workflow_runs: [verificationGithub(f.base).run] }]))});`,
  );
  const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
  writeFileSync(
    join(f.bin, 'gh'),
    `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(backend)} "$@"\n`,
    { mode: 0o700 },
  );
  const entry = join(dirname(f.root), 'base-entry.mjs');
  symlinkSync(join(f.root, 'scripts/release/verification.mjs'), entry);
  const result = spawnSync(process.execPath, [entry, 'base', f.head], {
    cwd: f.root,
    encoding: 'utf8',
    env: { ...gitCleanEnv(), PATH: `${f.bin}:${process.env.PATH}` },
    timeout: 10_000,
  });
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout.trim()).toBe(f.base);
});

test('records both sides of a rename when a source filename needs quoting', () => {
  const f = workspace(0);
  const path = 'change\nfile.ts';
  const git = (...args) =>
    execFileSync('git', args, { cwd: f.root, env: gitCleanEnv(), encoding: 'utf8' });
  git('mv', 'change.ts', path);
  git('-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'rename');
  const result = spawnSync(
    process.execPath,
    [join(f.root, 'scripts/release/verify.mjs'), f.head, f.receipt],
    {
      cwd: f.root,
      encoding: 'utf8',
      env: { ...gitCleanEnv(), PATH: `${f.bin}:${process.env.PATH}` },
      timeout: 10_000,
    },
  );
  expect(result.status, result.stderr).toBe(0);
  const receipt = JSON.parse(readFileSync(f.receipt, 'utf8'));
  expect(receipt.changedFiles).toEqual([path, 'change.ts']);
  expect(receipt.requiredSteps).toEqual(['biome', 'oxlint']);
});
