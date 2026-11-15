import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function verificationGithub(sourceSha = 'a'.repeat(40)) {
  const run = {
    id: 101,
    run_attempt: 1,
    path: '.github/workflows/verify.yml',
    event: 'push',
    head_branch: 'main',
    head_sha: sourceSha,
    repository: { full_name: 'identity16/open-knowledge' },
    head_repository: { full_name: 'identity16/open-knowledge' },
    status: 'completed',
    conclusion: 'success',
  };
  const receipt = {
    schemaVersion: 1,
    scope: 'changed',
    baseSha: 'c'.repeat(40),
    headSha: sourceSha,
    runId: '101',
    runAttempt: '1',
    startedAt: '2026-11-15T10:00:00.000Z',
    completedAt: '2026-11-15T10:00:01.000Z',
    status: 'passed',
    sourceClean: true,
    changedFiles: ['packages/core/src/change.ts'],
    requiredSteps: ['lint', 'tests'],
    steps: [
      { label: 'lint', ok: true },
      { label: 'tests', ok: true },
    ],
  };
  const artifacts = [{ name: 'verification-1', expired: false }];
  const state = { run, receipt, artifacts, candidates: [run], calls: [] };
  state.invoke = (args) => {
    state.calls.push(args);
    if (args[0] === 'api' && args[1].includes('/actions/workflows/verify.yml/runs?'))
      return JSON.stringify([{ workflow_runs: state.candidates }]);
    if (args[0] === 'api' && args[1].includes('/artifacts?'))
      return JSON.stringify([{ artifacts: state.artifacts }]);
    if (args[0] === 'run' && args[1] === 'download') {
      writeFileSync(
        join(args[args.indexOf('--dir') + 1], 'receipt.json'),
        JSON.stringify(state.receipt),
      );
      return '';
    }
    throw new Error(`Unexpected verification request: ${args.join(' ')}`);
  };
  return state;
}
