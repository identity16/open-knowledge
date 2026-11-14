import { expect, test } from 'vitest';
import { failureCauses, jobLines, runnerUnavailable } from './watch-release.mjs';

test('job lines show conclusion, duration and runner', () => {
  expect(
    jobLines([
      {
        name: 'build',
        status: 'completed',
        conclusion: 'success',
        started_at: '2026-11-14T03:00:00Z',
        completed_at: '2026-11-14T03:03:48Z',
        runner_name: 'macmini-ok',
      },
      { name: 'publish', status: 'completed', conclusion: 'skipped', runner_name: null },
    ]),
  ).toEqual(['build      success      228s  macmini-ok', 'publish    skipped         -  -']);
});

test('failure causes keep the telling lines once and drop secrets and noise', () => {
  const log = [
    'notarize\tsubmit\t2026-11-13T10:46:27.7783590Z notarytool (exit 1): Error: HTTP status code: 403. A required agreement is missing or has expired.',
    'build\tsign\t2026-11-14T03:03:08.2509340Z   ⨯ Invalid output directory: contains unsupported shell-special characters',
    'build\tsign\t2026-11-14T03:03:08.2842670Z ##[error]Process completed with exit code 1.',
    'build\tsign\t2026-11-14T03:03:08.2842670Z ##[error]Process completed with exit code 1.',
    'build\tsign\t2026-11-14T03:03:00.0000000Z   CSC_LINK: ***',
    'build\tsign\t2026-11-14T03:03:00.0000000Z compiling 120 modules',
  ].join('\n');
  expect(failureCauses(log)).toEqual([
    'notarytool (exit 1): Error: HTTP status code: 403. A required agreement is missing or has expired.',
    '⨯ Invalid output directory: contains unsupported shell-special characters',
    '##[error]Process completed with exit code 1.',
  ]);
});

test('an unassigned runner is recognised from the run view', () => {
  expect(
    runnerUnavailable(
      'X The job was not acquired by Runner of type hosted even after multiple attempts',
    ),
  ).toBe(true);
  expect(runnerUnavailable('✓ build in 3m48s')).toBe(false);
});
