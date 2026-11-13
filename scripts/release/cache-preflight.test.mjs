import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { linkedCachePaths, preflightProblems, probeCachePaths } from './cache-preflight.mjs';

function withHome(run) {
  const home = mkdtempSync(join(tmpdir(), 'cache-preflight-'));
  return Promise.resolve(run(home)).finally(() => rmSync(home, { recursive: true, force: true }));
}

test('only symlinked cache paths are probed', () =>
  withHome((home) => {
    mkdirSync(join(home, 'Library/Caches/pnpm'), { recursive: true });
    mkdirSync(join(home, 'target'));
    symlinkSync(join(home, 'target'), join(home, '.rustup'));
    assert.deepEqual(linkedCachePaths(home), [join(home, '.rustup')]);
  }));

test('a reachable link passes and a dangling link is reported as missing', () =>
  withHome(async (home) => {
    mkdirSync(join(home, 'target'));
    symlinkSync(join(home, 'target'), join(home, 'live'));
    symlinkSync(join(home, 'gone'), join(home, 'dangling'));
    const results = await probeCachePaths([join(home, 'live'), join(home, 'dangling')]);
    assert.deepEqual(
      results.map((result) => result.state),
      ['ok', 'missing'],
    );
    const problems = preflightProblems(results);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /dangling points at a target that is not there/);
  }));

test('a probe that outlives the timeout is reported as hung without waiting for it', async () => {
  const started = Date.now();
  const results = await probeCachePaths(['/somewhere'], {
    timeoutMs: 100,
    command: ['/bin/sh', '-c', 'sleep 5', 'sh'],
  });
  assert.deepEqual(results, [{ path: '/somewhere', state: 'hung' }]);
  assert.ok(Date.now() - started < 2_000);
  assert.match(preflightProblems(results)[0], /\/somewhere does not respond/);
});
