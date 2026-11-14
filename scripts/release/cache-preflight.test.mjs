import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  annotatePrivacyDenials,
  linkedCachePaths,
  preflightProblems,
  privacyDenied,
  probeCachePaths,
  volumeOf,
} from './cache-preflight.mjs';

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

const denial =
  "2026-11-14 11:24:03.507 E  kernel[0:81de2d] [com.apple.sandbox.reporting:violation] System Policy: ls(87062) deny(4) file-read-data /Volumes/Joon's Portable SSD/agent-builds";

test('a hung cache on a volume the kernel just denied is reported as a privacy block', () =>
  withHome((home) => {
    symlinkSync("/Volumes/Joon's Portable SSD/agent-builds/pnpm-store", join(home, '.rustup'));
    const [result] = annotatePrivacyDenials(
      [{ path: join(home, '.rustup'), state: 'hung' }],
      denial,
    );
    assert.equal(result.volume, "/Volumes/Joon's Portable SSD");
    assert.equal(result.privacyDenied, true);
    assert.match(
      preflightProblems([result])[0],
      /blocked by macOS privacy \(TCC\), not by the drive/,
    );
  }));

test('without a logged denial a hung cache still points at the drive', () => {
  assert.equal(privacyDenied('', '/Volumes/Other'), false);
  assert.equal(privacyDenied(denial, '/Volumes/Other'), false);
  assert.equal(volumeOf('/Users/joon/cache'), null);
  assert.match(
    preflightProblems([{ path: '/x', state: 'hung', privacyDenied: false }])[0],
    /no privacy denial was logged; the drive behind it may be hung/,
  );
});
