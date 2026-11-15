import { expect, test } from 'vitest';
import {
  assertVerificationReceipt,
  createVerificationReceipt,
  finishVerificationReceipt,
  requireSourceVerification,
  selectVerificationBase,
} from './verification.mjs';
import { verificationGithub } from './verification.test-helper.mjs';

const sha = (letter) => letter.repeat(40);

test('accumulates across failed and cancelled pushes from the closest successful main ancestor', () => {
  const candidate = (head, conclusion) => ({ ...verificationGithub(sha(head)).run, conclusion });
  const candidates = [
    candidate('a', 'success'),
    candidate('b', 'cancelled'),
    candidate('c', 'failure'),
    candidate('d', 'success'),
  ];
  expect(selectVerificationBase(candidates, ['d', 'c', 'b', 'a'].map(sha), sha('d'))).toBe(
    sha('a'),
  );
});

test('ignores newer reruns of older commits and successes from forks, branches or other workflows', () => {
  const good = verificationGithub(sha('c')).run;
  const old = { ...good, id: 999, head_sha: sha('a') };
  const fork = { ...good, head_sha: sha('d'), head_repository: { full_name: 'fork/project' } };
  const branch = { ...good, head_sha: sha('d'), head_branch: 'feature' };
  const other = { ...good, head_sha: sha('d'), path: '.github/workflows/release.yml' };
  expect(
    selectVerificationBase(
      [old, fork, branch, other, good],
      ['e', 'd', 'c', 'b', 'a'].map(sha),
      sha('e'),
    ),
  ).toBe(sha('c'));
  expect(() =>
    selectVerificationBase([fork, branch, other], ['e', 'd'].map(sha), sha('e')),
  ).toThrow('No successful main');
});

test('does not fall back to the previous push when no verified ancestor exists', () => {
  expect(() => selectVerificationBase([], ['b', 'a'].map(sha), sha('b'))).toThrow(
    'No successful main',
  );
});

test('records interruption as running and incomplete or failed steps cannot become passed', () => {
  const pending = createVerificationReceipt(
    sha('a'),
    sha('b'),
    ['deleted.test.ts'],
    ['lint', 'tests'],
    { GITHUB_RUN_ID: '101', GITHUB_RUN_ATTEMPT: '1' },
  );
  expect(pending.status).toBe('running');
  expect(pending.completedAt).toBeUndefined();
  expect(finishVerificationReceipt(pending, [{ label: 'lint', ok: true }]).status).toBe('failed');
  expect(
    finishVerificationReceipt(pending, [
      { label: 'lint', ok: true },
      { label: 'tests', ok: false },
    ]).status,
  ).toBe('failed');
  expect(
    finishVerificationReceipt(pending, [
      { label: 'tests', ok: true },
      { label: 'lint', ok: true },
    ]).status,
  ).toBe('failed');
  expect(
    finishVerificationReceipt(pending, [
      { label: 'lint', ok: true },
      { label: 'tests', ok: true },
    ]).status,
  ).toBe('passed');
});

test.each([
  [
    'dirty source',
    (r) => {
      r.sourceClean = false;
    },
  ],
  [
    'running',
    (r) => {
      r.status = 'running';
      delete r.completedAt;
    },
  ],
  [
    'wrong SHA',
    (r) => {
      r.headSha = sha('b');
    },
  ],
  [
    'wrong attempt',
    (r) => {
      r.runAttempt = '2';
    },
  ],
  [
    'wrong run',
    (r) => {
      r.runId = '202';
    },
  ],
  [
    'omitted step',
    (r) => {
      r.steps.pop();
    },
  ],
  [
    'failed step',
    (r) => {
      r.steps[0].ok = false;
    },
  ],
])('rejects a %s receipt even when the CI run is green', (_, corrupt) => {
  const f = verificationGithub();
  corrupt(f.receipt);
  expect(() => assertVerificationReceipt(f.receipt, f.run, sha('a'))).toThrow('receipt');
});

test('downloads the current attempt receipt only after the exact source run has completed', () => {
  const f = verificationGithub();
  expect(requireSourceVerification(sha('a'), f.invoke)).toEqual(f.receipt);
  expect(f.calls.find((args) => args[0] === 'run')).toEqual(
    expect.arrayContaining(['101', '--name', 'verification-1']),
  );
  f.run.status = 'in_progress';
  f.run.conclusion = null;
  f.calls.length = 0;
  expect(() => requireSourceVerification(sha('a'), f.invoke)).toThrow('Wait for successful');
  expect(f.calls).toHaveLength(1);
});

test('a later failed verification prevents reusing an older success for the same SHA', () => {
  const f = verificationGithub();
  f.candidates.push({ ...f.run, id: 102, conclusion: 'failure' });
  expect(() => requireSourceVerification(sha('a'), f.invoke)).toThrow('Wait for successful');
});

test.each(['missing', 'expired', 'stale attempt'])('refuses %s completion evidence', (kind) => {
  const f = verificationGithub();
  if (kind === 'missing') f.artifacts.length = 0;
  if (kind === 'expired') f.artifacts[0].expired = true;
  if (kind === 'stale attempt') f.run.run_attempt = 2;
  expect(() => requireSourceVerification(sha('a'), f.invoke)).toThrow('missing or expired');
});
