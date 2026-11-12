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

const fixtures = [];
afterEach(() => {
  for (const path of fixtures.splice(0)) rmSync(path, { recursive: true, force: true });
});

test('bootstraps release recovery and preflight without installing workspace dependencies', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'fork-workflow-bootstrap-')));
  fixtures.push(root);
  const scripts = join(root, 'scripts/fork');
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
fs.appendFileSync(process.env.FORK_TEST_COMMANDS, JSON.stringify(args) + '\\n');
const path = args[1];
if (args[0] !== 'api' || args.includes('POST')) throw new Error('Unexpected mutation');
if (path.endsWith('/actions/runs/303')) console.log(JSON.stringify({
  id: 303, path: '.github/workflows/identity16-web-release.yml', event: 'workflow_dispatch',
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
      FORK_VERSION: '0.76.0-identity16.5',
      FORK_TEST_COMMANDS: commands,
    },
  });
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  expect(readFileSync(output, 'utf8')).toBe(
    'reused=false\ncandidate_run_id=303\nready_run_id=\nsigned_name=fork-signed-0.76.0-identity16.5\n',
  );
  expect(readFileSync(commands, 'utf8')).not.toContain('release","create');
});
