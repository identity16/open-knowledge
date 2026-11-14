import { spawn } from 'node:child_process';
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { submitNotary, waitNotary, withNotaryClient } from './notarize-release.mjs';
import { preflightRelease, promoteRelease, stageRelease } from './publish-release.mjs';
import {
  CheckpointStore,
  checkpointName,
  createCandidate,
  createReady,
  readCheckpoint,
  validateRecord,
  workflowContext,
} from './release-checkpoint.mjs';
import { releasePlan } from './release-identity.mjs';

export async function runReleaseStep(command, env = process.env) {
  const context = workflowContext(env);
  const version = env.RELEASE_VERSION;
  const plan = releasePlan(version);
  const root = resolve(import.meta.dirname, '../../.release');
  const signed = join(root, 'signed');
  const notary = join(root, 'notary');
  const ready = join(root, 'ready');
  const store = new CheckpointStore(env);
  const background = join(root, 'notary-run');
  const logPath = join(background, 'log');
  const exitPath = join(background, 'exit-code');
  const submittedPath = join(background, 'submitted.json');
  const printedPath = join(background, 'printed');
  const printNewLog = () => {
    const from = existsSync(printedPath) ? Number(readFileSync(printedPath, 'utf8')) : 0;
    const log = existsSync(logPath) ? readFileSync(logPath) : Buffer.alloc(0);
    process.stdout.write(log.subarray(from));
    writeFileSync(printedPath, String(log.length));
  };
  const backgroundExit = () =>
    existsSync(exitPath) ? Number(readFileSync(exitPath, 'utf8').trim()) : null;
  const awaitBackground = async (done) => {
    const deadline = Date.now() + 50 * 60 * 1000;
    while (!done() && backgroundExit() === null) {
      if (Date.now() > deadline) throw new Error('The background notarization never finished.');
      await delay(1000);
    }
    printNewLog();
  };
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
    if (!staged) preflightRelease(version, candidate?.sourceSha ?? context.sourceSha, env);
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
  } else if (command === 'notarize-start') {
    restore();
    mkdirSync(background, { recursive: true });
    const script = fileURLToPath(import.meta.url);
    const child = spawn(
      '/bin/sh',
      ['-c', 'node "$0" notarize-run > "$1" 2>&1; echo $? > "$2"', script, logPath, exitPath],
      { detached: true, stdio: 'ignore', env },
    );
    child.unref();
    console.log('Submitting the signed application to Apple in the background.');
  } else if (command === 'notarize-run') {
    const candidate = restore();
    const existing = store.restoreRecord('notary', candidate, notary);
    const result = await withNotaryClient(env, (client, temp) =>
      submitNotary(candidate, signed, notary, existing, context.sourceRunId, client, temp),
    );
    writeFileSync(
      submittedPath,
      JSON.stringify({ uploaded: result.uploaded, name: checkpointName('notary', candidate) }),
    );
    await withNotaryClient(env, (client) =>
      waitNotary(candidate, readCheckpoint(notary, 'notary'), client),
    );
  } else if (command === 'notarize-submitted') {
    await awaitBackground(() => existsSync(submittedPath));
    if (!existsSync(submittedPath))
      throw new Error(`The background submission failed (exit ${backgroundExit()}).`);
    const submitted = JSON.parse(readFileSync(submittedPath, 'utf8'));
    output({ new_notary: submitted.uploaded, notary_name: submitted.name });
  } else if (command === 'notarize-accepted') {
    await awaitBackground(() => false);
    if (backgroundExit() !== 0)
      throw new Error(`The background notarization failed (exit ${backgroundExit()}).`);
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
    const staged = stageRelease(version, assets, candidate.sourceSha, env);
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
    console.log(promoteRelease(staged, env));
  } else throw new Error('Unknown release workflow step.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await runReleaseStep(process.argv[2]);
