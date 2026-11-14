import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { createCandidate } from './release-checkpoint.mjs';
import { releasePlan } from './release-identity.mjs';

const fixtures = [];
afterEach(() => {
  for (const path of fixtures.splice(0)) rmSync(path, { recursive: true, force: true });
});

test('bootstraps release recovery and preflight without installing workspace dependencies', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'release-workflow-bootstrap-')));
  fixtures.push(root);
  const scripts = join(root, 'scripts/release');
  const bin = join(root, 'bin');
  mkdirSync(scripts, { recursive: true });
  mkdirSync(bin);
  for (const file of [
    'release-workflow',
    'release-identity',
    'release-checkpoint',
    'notarize-release',
    'publish-release',
  ])
    copyFileSync(new URL(`./${file}.mjs`, import.meta.url), join(scripts, `${file}.mjs`));
  const backend = join(root, 'github.cjs');
  writeFileSync(
    backend,
    `
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.RELEASE_TEST_COMMANDS, JSON.stringify(args) + '\\n');
const path = args[1];
if (args[0] !== 'api' || args.includes('POST')) throw new Error('Unexpected mutation');
if (path.endsWith('/actions/runs/303')) console.log(JSON.stringify({
  id: 303, path: '.github/workflows/release.yml', event: 'workflow_dispatch',
  head_branch: 'main', head_sha: 'a'.repeat(40),
  repository: { full_name: 'identity16/open-knowledge' },
  head_repository: { full_name: 'identity16/open-knowledge' },
}));
else if (path.includes('/artifacts?')) console.log('[{"artifacts":[]}]');
else if (path.includes('/releases?')) console.log('[[]]');
else if (path.includes('/git/ref/') || path.endsWith('/releases/latest')) {
  process.stderr.write('(HTTP 404)'); process.exitCode = 1;
} else throw new Error('Unexpected request');
`,
  );
  const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
  writeFileSync(
    join(bin, 'gh'),
    `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(backend)} "$@"\n`,
    { mode: 0o700 },
  );
  const output = join(root, 'output');
  const commands = join(root, 'commands');
  const result = spawnSync(process.execPath, [join(scripts, 'release-workflow.mjs'), 'restore'], {
    cwd: root,
    encoding: 'utf8',
    env: {
      PATH: `${bin}:${process.env.PATH}`,
      GITHUB_REPOSITORY: 'identity16/open-knowledge',
      GITHUB_REF: 'refs/heads/main',
      GITHUB_SHA: 'a'.repeat(40),
      GITHUB_RUN_ID: '303',
      GITHUB_OUTPUT: output,
      RELEASE_VERSION: '0.76.0-identity16.5',
      RELEASE_TEST_COMMANDS: commands,
    },
  });
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  expect(readFileSync(output, 'utf8')).toBe(
    'reused=false\ncandidate_run_id=303\nready_run_id=\nsigned_name=release-signed-0.76.0-identity16.5\n',
  );
  expect(readFileSync(commands, 'utf8')).not.toContain('release","create');
});

function workspace() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'release-workflow-background-')));
  fixtures.push(root);
  const scripts = join(root, 'scripts/release');
  const bin = join(root, 'bin');
  mkdirSync(scripts, { recursive: true });
  mkdirSync(bin);
  for (const file of [
    'release-workflow',
    'release-identity',
    'release-checkpoint',
    'notarize-release',
    'publish-release',
  ])
    copyFileSync(new URL(`./${file}.mjs`, import.meta.url), join(scripts, `${file}.mjs`));
  writeFileSync(join(bin, 'gh'), `#!/bin/sh\necho '[{"artifacts":[]}]'\n`, { mode: 0o700 });
  const background = join(root, '.release/notary-run');
  const env = {
    PATH: `${bin}:${process.env.PATH}`,
    GITHUB_REPOSITORY: 'identity16/open-knowledge',
    GITHUB_REF: 'refs/heads/main',
    GITHUB_SHA: 'a'.repeat(40),
    GITHUB_RUN_ID: '303',
    GITHUB_OUTPUT: join(root, 'output'),
    RELEASE_VERSION: '0.76.0-identity16.5',
    CANDIDATE_RUN_ID: '303',
  };
  const step = (command) =>
    spawnSync(process.execPath, [join(scripts, 'release-workflow.mjs'), command], {
      cwd: root,
      encoding: 'utf8',
      env,
    });
  return { root, background, env, step };
}

test('hands the background submission ID to the checkpoint step and prints its log once', () => {
  const w = workspace();
  mkdirSync(w.background, { recursive: true });
  writeFileSync(join(w.background, 'log'), 'Notarization submission saved: id\n');
  writeFileSync(
    join(w.background, 'submitted.json'),
    JSON.stringify({ uploaded: true, name: 'release-notary-x' }),
  );
  const submitted = w.step('notarize-submitted');
  expect(submitted.status).toBe(0);
  expect(submitted.stdout).toBe('Notarization submission saved: id\n');
  expect(readFileSync(w.env.GITHUB_OUTPUT, 'utf8')).toBe(
    'new_notary=true\nnotary_name=release-notary-x\n',
  );
  writeFileSync(join(w.background, 'log'), 'Notarization submission saved: id\nAccepted\n');
  writeFileSync(join(w.background, 'exit-code'), '0\n');
  const accepted = w.step('notarize-accepted');
  expect(accepted.status).toBe(0);
  expect(accepted.stdout).toBe('Accepted\n');
});

test('fails the waiting steps with the background exit code when notarization fails', () => {
  const w = workspace();
  mkdirSync(w.background, { recursive: true });
  writeFileSync(join(w.background, 'log'), 'rejected\n');
  writeFileSync(join(w.background, 'exit-code'), '1\n');
  for (const command of ['notarize-submitted', 'notarize-accepted']) {
    const result = w.step(command);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('(exit 1)');
  }
});

test('starts notarization detached and records how it ended', async () => {
  const w = workspace();
  const signed = join(w.root, '.release/signed');
  mkdirSync(signed, { recursive: true });
  for (const name of [
    'signed-app.zip',
    'builder-config.yml',
    'packaging-resources.tar',
    releasePlan(w.env.RELEASE_VERSION).cli,
    'channel.mjs',
  ])
    writeFileSync(join(signed, name), `content:${name}`);
  createCandidate(signed, w.env.RELEASE_VERSION, { sourceSha: 'a'.repeat(40), sourceRunId: '303' });
  const started = w.step('notarize-start');
  expect(started.status).toBe(0);
  const submitted = w.step('notarize-submitted');
  expect(submitted.status).not.toBe(0);
  expect(submitted.stdout).toContain('Missing notarization credentials');
  expect(readFileSync(join(w.background, 'exit-code'), 'utf8').trim()).toBe('1');
});
