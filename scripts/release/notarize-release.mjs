import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {
  createSubmission,
  signedHash,
  validateCandidate,
  validateRecord,
} from './release-checkpoint.mjs';

export function requireApiCredentials(env) {
  const missing = ['APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER'].filter(
    (name) => !env[name],
  );
  if (missing.length) throw new Error(`Missing notarization credentials: ${missing.join(', ')}.`);
  if (
    ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_KEYCHAIN_PROFILE'].some((name) => env[name])
  )
    throw new Error('Use only the dedicated App Store Connect API key for this release.');
}

export async function withNotaryClient(env, action) {
  requireApiCredentials(env);
  const temp = mkdtempSync(join(tmpdir(), 'release-notary-'));
  try {
    const key = env.APPLE_API_KEY.includes('-----BEGIN')
      ? env.APPLE_API_KEY
      : readFileSync(env.APPLE_API_KEY, 'utf8');
    if (!key.startsWith('-----BEGIN PRIVATE KEY-----'))
      throw new Error('APPLE_API_KEY must be a PEM private key or its file path.');
    const path = join(temp, 'key.p8');
    writeFileSync(path, key, { mode: 0o600 });
    return await action((args) => {
      const result = spawnSync(
        'xcrun',
        [
          'notarytool',
          ...args,
          '--key',
          path,
          '--key-id',
          env.APPLE_API_KEY_ID,
          '--issuer',
          env.APPLE_API_ISSUER,
          '--output-format',
          'json',
        ],
        { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
      );
      let body = null;
      try {
        body = JSON.parse(result.stdout);
      } catch {
        body = null;
      }
      return { exitCode: result.status, body };
    }, temp);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

function successful(response, operation) {
  if (response.exitCode !== 0 || !response.body)
    throw new Error(`Notarization ${operation} failed; preserve the checkpoint and retry.`);
  return response.body;
}

export function submitNotary(
  candidate,
  candidateDir,
  outputDir,
  existing,
  producerRunId,
  client,
  temp,
) {
  validateCandidate(candidate, candidateDir, candidate.version);
  if (existing) {
    validateRecord(existing, 'notary', candidate);
    return { receipt: existing, uploaded: false };
  }
  const name = `OpenKnowledge16-${candidate.version}-${signedHash(candidate)}.zip`;
  const history = successful(client(['history']), 'history').history ?? [];
  const previous = history.filter((entry) => entry.name === name);
  const recovered =
    previous.find((entry) => entry.status === 'Accepted') ??
    previous.find((entry) => entry.status === 'In Progress');
  if (previous.length && !recovered)
    throw new Error('The identical signed application was rejected; inspect its notarization log.');
  let id = recovered?.id;
  if (!id) {
    const archive = join(temp, name);
    copyFileSync(join(candidateDir, 'signed-app.zip'), archive);
    id = successful(client(['submit', archive]), 'submission').id;
  }
  const receipt = createSubmission(candidate, id, producerRunId);
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(join(outputDir, 'notary.json'), `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(`Notarization submission saved: ${receipt.submissionId}`);
  return { receipt, uploaded: true };
}

export async function waitNotary(
  candidate,
  receipt,
  client,
  { maxWaitMs = 45 * 60 * 1000, now = Date.now, pause = delay } = {},
) {
  validateRecord(receipt, 'notary', candidate);
  const deadline = now() + maxWaitMs;
  let failures = 0;
  while (now() < deadline) {
    const state = client(['info', receipt.submissionId]);
    if (state.exitCode !== 0 || state.body?.id !== receipt.submissionId) {
      if (++failures >= 3)
        throw new Error('Notarization status lookup failed; resume using the saved submission ID.');
      await pause(5000);
      continue;
    }
    failures = 0;
    if (state.body.status === 'Accepted') return;
    if (state.body.status !== 'In Progress')
      throw new Error(`Notarization ${receipt.submissionId} was rejected: ${state.body.status}.`);
    console.log(`Waiting for existing notarization submission: ${receipt.submissionId}`);
    client(['wait', receipt.submissionId, '--timeout', '5m']);
    await pause(1000);
  }
  throw new Error(
    `Notarization is still processing. Resume the workflow with the same submission ID ${receipt.submissionId}.`,
  );
}
