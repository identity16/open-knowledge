import { appendFileSync, copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { submitNotary, waitNotary, withNotaryClient } from './notarize-release.mjs';
import { preflightForkRelease, promoteForkRelease, stageForkRelease } from './publish-release.mjs';
import {
  CheckpointStore,
  checkpointName,
  createCandidate,
  createReady,
  readCheckpoint,
  validateRecord,
  workflowContext,
} from './release-checkpoint.mjs';
import { forkReleasePlan } from './release-identity.mjs';

export async function runReleaseStep(command, env = process.env) {
  const context = workflowContext(env);
  const version = env.FORK_VERSION;
  const plan = forkReleasePlan(version);
  const root = resolve(import.meta.dirname, '../../.fork-release');
  const signed = join(root, 'signed');
  const notary = join(root, 'notary');
  const ready = join(root, 'ready');
  const store = new CheckpointStore(env);
  const output = (values) => {
    for (const [key, value] of Object.entries(values)) {
      if (String(value).includes('\n') || String(value).includes('\r'))
        throw new Error('Invalid workflow output.');
      appendFileSync(env.GITHUB_OUTPUT, `${key}=${value}\n`);
    }
  };
  const restore = () => store.restoreCandidate(version, env.CANDIDATE_RUN_ID, signed, true);
  if (command === 'restore') {
    const candidate = store.restoreCandidate(
      version,
      env.RESUME_RUN_ID || context.sourceRunId,
      signed,
      Boolean(env.RESUME_RUN_ID),
    );
    const staged = candidate && store.restoreRecord('ready', candidate, ready);
    if (!staged) preflightForkRelease(version, candidate?.sourceSha ?? context.sourceSha, env);
    output({
      reused: Boolean(candidate),
      candidate_run_id: candidate?.sourceRunId ?? context.sourceRunId,
      ready_run_id: staged?.producerRunId ?? '',
      signed_name: checkpointName('signed', { version }),
    });
  } else if (command === 'sign') {
    mkdirSync(signed, { recursive: true });
    copyFileSync(join(root, 'web', plan.cli), join(signed, plan.cli));
    const { buildDesktop } = await import('./build-desktop.mjs');
    await buildDesktop(version, signed, env, { signOnly: true });
    createCandidate(signed, version, context);
  } else if (command === 'submit') {
    const candidate = restore();
    const existing = store.restoreRecord('notary', candidate, notary);
    const result = await withNotaryClient(env, (client, temp) =>
      submitNotary(candidate, signed, notary, existing, context.sourceRunId, client, temp),
    );
    output({ new_notary: result.uploaded, notary_name: checkpointName('notary', candidate) });
  } else if (command === 'wait') {
    const candidate = readCheckpoint(signed, 'candidate');
    await withNotaryClient(env, (client) =>
      waitNotary(candidate, readCheckpoint(notary, 'notary'), client),
    );
  } else if (command === 'prepare-package') {
    const candidate = restore();
    const staged = store.restoreRecord('ready', candidate, ready);
    output({ reused: Boolean(staged), ready_run_id: staged?.producerRunId ?? '' });
  } else if (command === 'package') {
    const candidate = readCheckpoint(signed, 'candidate');
    const submission = store.restoreRecord('notary', candidate, notary);
    if (!submission) throw new Error('The notarization submission checkpoint is missing.');
    const assets = join(root, 'assets');
    const { packageDesktop } = await import('./build-desktop.mjs');
    await packageDesktop(version, signed, assets, env);
    const staged = stageForkRelease(version, assets, candidate.sourceSha, env);
    const receipt = createReady(
      candidate,
      submission,
      staged.releaseId,
      staged.assets,
      context.sourceRunId,
    );
    mkdirSync(ready, { recursive: true });
    writeFileSync(join(ready, 'ready.json'), `${JSON.stringify(receipt, null, 2)}\n`);
    output({ ready_name: checkpointName('ready', candidate), ready_run_id: context.sourceRunId });
  } else if (command === 'promote') {
    const candidate = restore();
    const staged = store.restoreRecord('ready', candidate, ready);
    if (!staged || staged.producerRunId !== env.READY_RUN_ID)
      throw new Error('The verified draft release checkpoint is missing or has changed.');
    validateRecord(staged, 'ready', candidate);
    console.log(promoteForkRelease(staged, env));
  } else throw new Error('Unknown fork release workflow step.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await runReleaseStep(process.argv[2]);
