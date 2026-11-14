import { spawnSync } from 'node:child_process';
import {
  constants,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { releasePlan, releaseFileDigest, validateReleaseInventory } from './release-identity.mjs';

export const RELEASE_REPOSITORY = 'identity16/open-knowledge';
export const RELEASE_WORKFLOW = '.github/workflows/release.yml';
const SHA = /^[a-f0-9]{40}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const RUN = /^[1-9]\d*$/;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

function matches(pattern, value) {
  return typeof value === 'string' && value.trim() === value && pattern.test(value);
}

export function readCheckpoint(directory, name) {
  if (!['candidate', 'notary', 'ready'].includes(name)) throw new Error('Unknown checkpoint type.');
  const path = join(directory, `${name}.json`);
  if (!lstatSync(path).isFile() || statSync(path).size > 65536)
    throw new Error('Invalid checkpoint metadata file.');
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new Error('Invalid checkpoint metadata JSON.');
  }
}

export function github(args, optional = false) {
  const result = spawnSync('gh', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (result.error || result.status !== 0) {
    if (optional && result.stderr?.includes('(HTTP 404)')) return null;
    throw new Error(
      `GitHub operation failed: ${result.stderr?.trim() || result.error?.code || result.status}`,
    );
  }
  return result.stdout;
}

export function workflowContext(env = process.env) {
  if (
    env.GITHUB_REPOSITORY !== RELEASE_REPOSITORY ||
    env.GITHUB_REF !== 'refs/heads/main' ||
    !matches(SHA, env.GITHUB_SHA) ||
    !matches(RUN, env.GITHUB_RUN_ID)
  ) {
    throw new Error('Run the release workflow on the main branch.');
  }
  return { sourceSha: env.GITHUB_SHA, sourceRunId: env.GITHUB_RUN_ID };
}

function requireIdentity(value) {
  releasePlan(value?.version);
  if (value?.schema !== 1 || !matches(SHA, value.sourceSha) || !matches(RUN, value.sourceRunId))
    throw new Error('Invalid release checkpoint identity.');
}

function requireFile(file) {
  if (
    typeof file?.name !== 'string' ||
    file.name.includes('/') ||
    file.name.includes('\\') ||
    file.name === '.' ||
    file.name === '..' ||
    !matches(DIGEST, file.sha256) ||
    !Number.isSafeInteger(file.size) ||
    file.size < 1
  )
    throw new Error('Invalid checkpoint file.');
}

export function signedHash(candidate) {
  return candidate.files.find((file) => file.name === 'signed-app.zip').sha256;
}

export function checkpointName(kind, candidate) {
  return kind === 'signed'
    ? `release-signed-${candidate.version}`
    : `release-${kind}-${signedHash(candidate)}`;
}

export function createCandidate(directory, version, context) {
  const plan = releasePlan(version);
  const files = [
    'signed-app.zip',
    'builder-config.yml',
    'packaging-resources.tar',
    plan.cli,
    'channel.mjs',
  ].map((name) => {
    const path = join(directory, name);
    if (!lstatSync(path).isFile()) throw new Error('Checkpoint files must be regular files.');
    return { name, size: statSync(path).size, sha256: releaseFileDigest(path) };
  });
  const receipt = {
    schema: 1,
    kind: 'signed',
    version,
    sourceSha: context.sourceSha,
    sourceRunId: context.sourceRunId,
    files,
  };
  validateCandidate(receipt, directory, version);
  writeFileSync(join(directory, 'candidate.json'), `${JSON.stringify(receipt, null, 2)}\n`);
  return receipt;
}

export function validateCandidate(receipt, directory, version) {
  requireIdentity(receipt);
  const plan = releasePlan(version);
  const names = [
    'signed-app.zip',
    'builder-config.yml',
    'packaging-resources.tar',
    plan.cli,
    'channel.mjs',
  ];
  if (
    receipt.kind !== 'signed' ||
    receipt.version !== version ||
    !Array.isArray(receipt.files) ||
    receipt.files.length !== names.length ||
    new Set(receipt.files.map((f) => f.name)).size !== names.length
  )
    throw new Error('The signed checkpoint does not match the requested release.');
  for (const file of receipt.files) {
    requireFile(file);
    if (!names.includes(file.name)) throw new Error('Unexpected signed checkpoint file.');
    const path = join(directory, file.name);
    if (
      !lstatSync(path).isFile() ||
      statSync(path).size !== file.size ||
      releaseFileDigest(path) !== file.sha256
    )
      throw new Error(`Corrupted checkpoint file: ${file.name}`);
  }
  if (readdirSync(directory).some((name) => ![...names, 'candidate.json'].includes(name)))
    throw new Error('Unexpected files in the signed checkpoint directory.');
  return receipt;
}

export function createSubmission(candidate, submissionId, producerRunId) {
  const receipt = {
    schema: 1,
    kind: 'notary',
    version: candidate.version,
    sourceSha: candidate.sourceSha,
    sourceRunId: candidate.sourceRunId,
    signedSha256: signedHash(candidate),
    producerRunId,
    submissionId,
  };
  validateRecord(receipt, 'notary', candidate);
  return receipt;
}

export function createReady(candidate, submission, releaseId, assets, producerRunId) {
  validateRecord(submission, 'notary', candidate);
  const receipt = {
    ...createSubmission(candidate, submission.submissionId, producerRunId),
    kind: 'ready',
    releaseId,
    assets: assets.map(({ name, size, digest }) => ({ name, size, digest })),
  };
  return validateRecord(receipt, 'ready', candidate);
}

export function validateRecord(receipt, kind, candidate) {
  requireIdentity(receipt);
  if (
    receipt.kind !== kind ||
    receipt.version !== candidate.version ||
    receipt.sourceSha !== candidate.sourceSha ||
    receipt.sourceRunId !== candidate.sourceRunId ||
    receipt.signedSha256 !== signedHash(candidate) ||
    !matches(RUN, receipt.producerRunId) ||
    !matches(UUID, receipt.submissionId)
  )
    throw new Error('The checkpoint belongs to a different signed application.');
  if (kind === 'ready') {
    if (!Number.isSafeInteger(receipt.releaseId) || receipt.releaseId < 1)
      throw new Error('Invalid staged release ID.');
    validateReleaseInventory(receipt.version, receipt.assets);
  }
  return receipt;
}

export class CheckpointStore {
  constructor(env = process.env, invoke = github) {
    this.context = workflowContext(env);
    this.invoke = invoke;
    this.shelf = env.RELEASE_CHECKPOINT_DIR || null;
  }

  shelve(name, directory, files = readdirSync(directory)) {
    if (!this.shelf) return false;
    const target = join(this.shelf, this.context.sourceRunId, name);
    const staging = `${target}.partial`;
    rmSync(staging, { recursive: true, force: true });
    mkdirSync(staging, { recursive: true });
    for (const file of files)
      copyFileSync(join(directory, file), join(staging, file), constants.COPYFILE_FICLONE);
    rmSync(target, { recursive: true, force: true });
    renameSync(staging, target);
    return true;
  }

  shelved(name, runId) {
    if (!this.shelf || !existsSync(this.shelf)) return [];
    const runs = runId === undefined ? readdirSync(this.shelf) : [String(runId)];
    return runs
      .filter((run) => matches(RUN, run) && existsSync(join(this.shelf, run, name)))
      .sort((a, b) => Number(b) - Number(a))
      .map((run) => ({ runId: run, path: join(this.shelf, run, name) }));
  }

  unshelve(path, directory) {
    mkdirSync(directory, { recursive: true });
    for (const file of readdirSync(path))
      copyFileSync(join(path, file), join(directory, file), constants.COPYFILE_FICLONE);
  }

  pruneShelf(maxAgeMs = 3 * 24 * 60 * 60 * 1000, now = Date.now()) {
    if (!this.shelf || !existsSync(this.shelf)) return;
    for (const run of readdirSync(this.shelf)) {
      const path = join(this.shelf, run);
      if (now - statSync(path).mtimeMs > maxAgeMs) rmSync(path, { recursive: true, force: true });
    }
  }

  api(path, optional = false) {
    const result = this.invoke(['api', `repos/${RELEASE_REPOSITORY}/${path}`], optional);
    return result === null ? null : JSON.parse(result);
  }

  trustedRun(runId) {
    if (!matches(RUN, String(runId))) throw new Error('Invalid workflow run ID.');
    const run = this.api(`actions/runs/${runId}`);
    if (
      String(run.id) !== String(runId) ||
      run.path !== RELEASE_WORKFLOW ||
      run.event !== 'workflow_dispatch' ||
      run.head_branch !== 'main' ||
      run.repository?.full_name !== RELEASE_REPOSITORY ||
      run.head_repository?.full_name !== RELEASE_REPOSITORY ||
      !matches(SHA, run.head_sha)
    )
      throw new Error('The checkpoint was not produced by main release workflow.');
    this.ancestor(run.head_sha, this.context.sourceSha);
    return run;
  }

  ancestor(source, target) {
    if (source === target) return;
    const comparison = this.api(`compare/${source}...${target}`);
    if (comparison.status !== 'ahead' || comparison.merge_base_commit?.sha !== source)
      throw new Error('The checkpoint source is not an ancestor of the current main commit.');
  }

  artifacts(path) {
    const pages = JSON.parse(
      this.invoke(['api', `repos/${RELEASE_REPOSITORY}/${path}`, '--paginate', '--slurp']),
    );
    return pages.flatMap((page) => page.artifacts).filter((artifact) => !artifact.expired);
  }

  download(artifact, directory) {
    mkdirSync(directory, { recursive: true });
    this.invoke([
      'run',
      'download',
      String(artifact.workflow_run.id),
      '--repo',
      RELEASE_REPOSITORY,
      '--name',
      artifact.name,
      '--dir',
      directory,
    ]);
  }

  localCandidate(version, runId, directory) {
    if (!existsSync(join(directory, 'candidate.json'))) return null;
    const receipt = validateCandidate(readCheckpoint(directory, 'candidate'), directory, version);
    if (receipt.sourceRunId !== String(runId))
      throw new Error('The local signed checkpoint belongs to a different workflow run.');
    return receipt;
  }

  localRecord(kind, candidate, directory) {
    if (!existsSync(join(directory, `${kind}.json`))) return null;
    return validateRecord(readCheckpoint(directory, kind), kind, candidate);
  }

  restoreCandidate(version, runId, directory, required = false) {
    const local = this.localCandidate(version, runId, directory);
    if (local) return local;
    const run = this.trustedRun(runId);
    const name = checkpointName('signed', { version });
    const kept = this.shelved(name, runId)[0];
    if (kept) this.unshelve(kept.path, directory);
    else {
      const matches = this.artifacts(`actions/runs/${runId}/artifacts?per_page=100`).filter(
        (a) => a.name === name,
      );
      if (!matches.length && !required) return null;
      if (matches.length !== 1)
        throw new Error('The signed checkpoint is missing, expired or ambiguous.');
      const artifact = matches[0];
      if (
        String(artifact.workflow_run?.id) !== String(runId) ||
        artifact.workflow_run.head_sha !== run.head_sha
      )
        throw new Error('The signed artifact has an unexpected producer.');
      this.download(artifact, directory);
    }
    const receipt = validateCandidate(readCheckpoint(directory, 'candidate'), directory, version);
    if (receipt.sourceSha !== run.head_sha || receipt.sourceRunId !== String(runId))
      throw new Error('The signed artifact does not match its source workflow.');
    return receipt;
  }

  restoreRecord(kind, candidate, directory) {
    const local = this.localRecord(kind, candidate, directory);
    if (local) return local;
    const name = checkpointName(kind, candidate);
    for (const kept of this.shelved(name)) {
      const run = this.trustedRun(kept.runId);
      this.ancestor(candidate.sourceSha, run.head_sha);
      this.unshelve(kept.path, directory);
      const receipt = validateRecord(readCheckpoint(directory, kind), kind, candidate);
      if (receipt.producerRunId !== String(run.id))
        throw new Error('The kept checkpoint producer does not match the checkpoint.');
      return receipt;
    }
    const matches = this.artifacts(
      `actions/artifacts?name=${encodeURIComponent(name)}&per_page=100`,
    )
      .filter((a) => a.name === name)
      .sort((a, b) => b.id - a.id);
    for (const artifact of matches) {
      const run = this.trustedRun(String(artifact.workflow_run?.id));
      this.ancestor(candidate.sourceSha, run.head_sha);
      this.download(artifact, directory);
      const receipt = validateRecord(readCheckpoint(directory, kind), kind, candidate);
      if (receipt.producerRunId !== String(run.id))
        throw new Error('The artifact producer does not match the checkpoint.');
      return receipt;
    }
    return null;
  }
}
