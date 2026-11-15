import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gitCleanEnv } from '../git-clean-env.mjs';

const repository = 'identity16/open-knowledge';
const workflow = '.github/workflows/verify.yml';
const shaPattern = /^[a-f0-9]{40}$/;

function github(args) {
  const result = spawnSync('gh', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (result.status !== 0 || result.error)
    throw new Error('Could not read GitHub verification evidence.');
  return result.stdout;
}

function trustedRun(run) {
  return (
    run.path === workflow &&
    run.event === 'push' &&
    run.head_branch === 'main' &&
    run.repository?.full_name === repository &&
    run.head_repository?.full_name === repository
  );
}

function runs(query, invoke) {
  const pages = JSON.parse(
    invoke([
      'api',
      `repos/${repository}/actions/workflows/verify.yml/runs?per_page=100&branch=main&${query}`,
      '--paginate',
      '--slurp',
    ]),
  );
  return pages.flatMap((page) => page.workflow_runs);
}

export function selectVerificationBase(candidates, history, headSha) {
  if (!shaPattern.test(headSha) || history[0] !== headSha)
    throw new Error('Invalid verification history.');
  const successful = new Set(
    candidates
      .filter(
        (run) =>
          trustedRun(run) &&
          run.status === 'completed' &&
          run.conclusion === 'success' &&
          run.head_sha !== headSha,
      )
      .map((run) => run.head_sha),
  );
  const base = history.find((sha) => successful.has(sha));
  if (!base)
    throw new Error('No successful main verification exists on this first-parent history.');
  return base;
}

export function createVerificationReceipt(
  baseSha,
  headSha,
  changedFiles,
  requiredSteps,
  env = process.env,
) {
  if (!shaPattern.test(baseSha) || !shaPattern.test(headSha))
    throw new Error('Invalid verification source SHA.');
  return {
    schemaVersion: 1,
    scope: 'changed',
    baseSha,
    headSha,
    runId: env.GITHUB_RUN_ID ?? null,
    runAttempt: env.GITHUB_RUN_ATTEMPT ?? null,
    startedAt: new Date().toISOString(),
    status: 'running',
    sourceClean: false,
    changedFiles,
    requiredSteps,
    steps: [],
  };
}

export function finishVerificationReceipt(receipt, steps) {
  const complete =
    receipt.requiredSteps.length === steps.length &&
    receipt.requiredSteps.every(
      (label, index) => steps[index].label === label && steps[index].ok === true,
    );
  return {
    ...receipt,
    steps,
    status: complete ? 'passed' : 'failed',
    completedAt: new Date().toISOString(),
  };
}

export function assertVerificationReceipt(receipt, run, sourceSha) {
  if (
    !trustedRun(run) ||
    run.status !== 'completed' ||
    run.conclusion !== 'success' ||
    run.head_sha !== sourceSha ||
    !Number.isSafeInteger(run.id) ||
    !Number.isSafeInteger(run.run_attempt)
  )
    throw new Error('The source has no completed successful main verification.');
  if (
    receipt.schemaVersion !== 1 ||
    receipt.scope !== 'changed' ||
    receipt.status !== 'passed' ||
    receipt.sourceClean !== true ||
    receipt.headSha !== sourceSha ||
    !shaPattern.test(receipt.baseSha) ||
    receipt.baseSha === sourceSha ||
    String(receipt.runId) !== String(run.id) ||
    String(receipt.runAttempt) !== String(run.run_attempt) ||
    !Array.isArray(receipt.changedFiles) ||
    receipt.changedFiles.some((path) => typeof path !== 'string') ||
    !Array.isArray(receipt.requiredSteps) ||
    !Array.isArray(receipt.steps) ||
    receipt.requiredSteps.some((label) => typeof label !== 'string') ||
    receipt.requiredSteps.length !== receipt.steps.length ||
    receipt.requiredSteps.some(
      (label, index) => receipt.steps[index]?.label !== label || receipt.steps[index]?.ok !== true,
    ) ||
    !Number.isFinite(Date.parse(receipt.startedAt)) ||
    !Number.isFinite(Date.parse(receipt.completedAt)) ||
    Date.parse(receipt.completedAt) < Date.parse(receipt.startedAt)
  )
    throw new Error(
      'The verification receipt is incomplete or does not match the source and run attempt.',
    );
  return receipt;
}

export function requireSourceVerification(sourceSha, invoke = github) {
  if (!shaPattern.test(sourceSha)) throw new Error('Invalid verification source SHA.');
  const candidates = runs(`head_sha=${sourceSha}`, invoke)
    .filter((run) => trustedRun(run) && run.head_sha === sourceSha)
    .sort((a, b) => b.id - a.id);
  const run = candidates[0];
  if (
    run?.status !== 'completed' ||
    run.conclusion !== 'success' ||
    !Number.isSafeInteger(run.run_attempt) ||
    run.run_attempt < 1
  )
    throw new Error('Wait for successful main verification of the original release source.');
  const pages = JSON.parse(
    invoke([
      'api',
      `repos/${repository}/actions/runs/${run.id}/artifacts?per_page=100`,
      '--paginate',
      '--slurp',
    ]),
  );
  const name = `verification-${run.run_attempt}`;
  const artifacts = pages
    .flatMap((page) => page.artifacts)
    .filter((artifact) => artifact.name === name && artifact.expired === false);
  if (artifacts.length !== 1)
    throw new Error('The completed verification receipt is missing or expired.');
  const directory = mkdtempSync(join(tmpdir(), 'ok-verification-'));
  try {
    invoke([
      'run',
      'download',
      String(run.id),
      '--repo',
      repository,
      '--name',
      name,
      '--dir',
      directory,
    ]);
    return assertVerificationReceipt(
      JSON.parse(readFileSync(join(directory, 'receipt.json'), 'utf8')),
      run,
      sourceSha,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const [command, headSha] = process.argv.slice(2);
  if (command !== 'base' || !shaPattern.test(headSha))
    throw new Error('Usage: node scripts/release/verification.mjs base <head SHA>');
  const history = execFileSync('git', ['rev-list', '--first-parent', headSha], {
    encoding: 'utf8',
    env: gitCleanEnv(),
  })
    .trim()
    .split('\n');
  console.log(selectVerificationBase(runs('status=success', github), history, headSha));
}
