import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  CheckpointStore,
  checkpointName,
  createCandidate,
  createReady,
  createSubmission,
  RELEASE_REPOSITORY,
  RELEASE_WORKFLOW,
  readCheckpoint,
  signedHash,
  validateCandidate,
  validateRecord,
  workflowContext,
} from './release-checkpoint.mjs';
import { releasePlan } from './release-identity.mjs';

const fixtures = [];
afterEach(() => {
  for (const p of fixtures.splice(0)) rmSync(p, { recursive: true, force: true });
});
const version = '0.76.0-identity16.5';
const source = 'a'.repeat(40);
const current = 'b'.repeat(40);
const submissionId = '12ab34cd-1234-4567-89ab-123456789abc';
const env = {
  GITHUB_REPOSITORY: RELEASE_REPOSITORY,
  GITHUB_REF: 'refs/heads/main',
  GITHUB_SHA: current,
  GITHUB_RUN_ID: '303',
};

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'release-checkpoint-'));
  fixtures.push(root);
  const candidateDir = join(root, 'signed');
  mkdirSync(candidateDir);
  for (const name of [
    'signed-app.zip',
    'builder-config.yml',
    'packaging-resources.tar',
    releasePlan(version).cli,
    'channel.mjs',
  ])
    writeFileSync(join(candidateDir, name), `content:${name}`);
  const candidate = createCandidate(candidateDir, version, {
    sourceSha: source,
    sourceRunId: '101',
  });
  return { root, candidateDir, candidate };
}

function run(id, sha) {
  return {
    id: Number(id),
    path: RELEASE_WORKFLOW,
    head_branch: 'main',
    event: 'workflow_dispatch',
    head_sha: sha,
    repository: { full_name: RELEASE_REPOSITORY },
    head_repository: { full_name: RELEASE_REPOSITORY },
  };
}

function storeFixture(f, { wrongRun = {}, corrupt = false } = {}) {
  const artifact = {
    id: 7,
    name: checkpointName('signed', f.candidate),
    expired: false,
    workflow_run: { id: 101, head_sha: source },
  };
  const invoke = vi.fn((args) => {
    if (args[0] === 'run') {
      const directory = args[args.indexOf('--dir') + 1];
      cpSync(f.candidateDir, directory, { recursive: true });
      if (corrupt) writeFileSync(join(directory, 'signed-app.zip'), 'corrupt');
      return '';
    }
    const path = args[1].replace(`repos/${RELEASE_REPOSITORY}/`, '');
    if (path === 'actions/runs/101') return JSON.stringify({ ...run('101', source), ...wrongRun });
    if (path === `compare/${source}...${current}`)
      return JSON.stringify({ status: 'ahead', merge_base_commit: { sha: source } });
    if (path.startsWith('actions/runs/101/artifacts'))
      return JSON.stringify([{ artifacts: [artifact] }]);
    throw new Error(`Unexpected GitHub request: ${path}`);
  });
  return { store: new CheckpointStore(env, invoke), invoke, artifact };
}

describe('signed release checkpoints', () => {
  test('does not serialize credentials passed alongside build identity', () => {
    const f = fixture();
    const receipt = createCandidate(f.candidateDir, version, {
      sourceSha: source,
      sourceRunId: '101',
      CSC_LINK: 'private-certificate',
      APPLE_API_KEY: 'private-key',
    });
    expect(JSON.stringify(receipt)).not.toContain('private-');
    expect(Object.keys(receipt).sort()).toEqual([
      'files',
      'kind',
      'schema',
      'sourceRunId',
      'sourceSha',
      'version',
    ]);
  });

  test('rejects metadata symlinks and malformed JSON without echoing its contents', () => {
    const f = fixture();
    const path = join(f.candidateDir, 'candidate.json');
    const elsewhere = join(f.root, 'private');
    writeFileSync(elsewhere, 'private-key-content');
    rmSync(path);
    symlinkSync(elsewhere, path);
    expect(() => readCheckpoint(f.candidateDir, 'candidate')).toThrow(/metadata file/);
    rmSync(path);
    writeFileSync(path, 'private-key-content');
    expect(() => readCheckpoint(f.candidateDir, 'candidate')).toThrow(
      'Invalid checkpoint metadata JSON.',
    );
  });

  test('recovers a historical main build while retaining the original source SHA', () => {
    const f = fixture();
    const g = storeFixture(f);
    const result = g.store.restoreCandidate(version, '101', join(f.root, 'restored'), true);
    expect(result.sourceSha).toBe(source);
    expect(result.sourceRunId).toBe('101');
    expect(result.sourceSha).not.toBe(env.GITHUB_SHA);
  });

  test.each([
    { head_branch: 'feature' },
    { event: 'pull_request' },
    { path: '.github/workflows/other.yml' },
    { head_repository: { full_name: 'attacker/fork' } },
    { head_sha: 'invalid' },
  ])('rejects an untrusted producer before downloading: %j', (wrongRun) => {
    const f = fixture();
    const g = storeFixture(f, { wrongRun });
    expect(() => g.store.restoreCandidate(version, '101', join(f.root, 'restored'), true)).toThrow(
      /workflow/,
    );
    expect(g.invoke.mock.calls.some(([args]) => args[0] === 'run')).toBe(false);
  });

  test('refuses corrupted restored bytes', () => {
    const f = fixture();
    const g = storeFixture(f, { corrupt: true });
    expect(() => g.store.restoreCandidate(version, '101', join(f.root, 'restored'), true)).toThrow(
      /Corrupted/,
    );
  });

  test('rejects missing or ambiguous checkpoints when explicitly resuming', () => {
    const f = fixture();
    const g = storeFixture(f);
    const invoke = (args) =>
      args[1]?.includes('/artifacts?') ? JSON.stringify([{ artifacts: [] }]) : g.invoke(args);
    const store = new CheckpointStore(env, invoke);
    expect(store.restoreCandidate(version, '101', join(f.root, 'new'))).toBeNull();
    expect(() => store.restoreCandidate(version, '101', join(f.root, 'new'), true)).toThrow(
      /missing/,
    );
  });

  test('requires matching versions, regular files and a complete inventory', () => {
    const f = fixture();
    expect(() => validateCandidate(f.candidate, f.candidateDir, '0.76.0-identity16.6')).toThrow(
      /requested release/,
    );
    const path = join(f.candidateDir, 'signed-app.zip');
    const target = join(f.root, 'elsewhere');
    writeFileSync(target, readFileSync(path));
    rmSync(path);
    symlinkSync(target, path);
    expect(() => validateCandidate(f.candidate, f.candidateDir, version)).toThrow(/Corrupted/);
  });

  test('does not allow checkpoint source commits outside current main history', () => {
    const f = fixture();
    const g = storeFixture(f);
    const store = new CheckpointStore(env, (args) =>
      args[1]?.includes('/compare/')
        ? JSON.stringify({ status: 'diverged', merge_base_commit: { sha: 'c'.repeat(40) } })
        : g.invoke(args),
    );
    expect(() => store.restoreCandidate(version, '101', join(f.root, 'restored'), true)).toThrow(
      /ancestor/,
    );
  });

  test('rejects non-main execution contexts', () => {
    expect(() => workflowContext({ ...env, GITHUB_REF: 'refs/heads/feature' })).toThrow(
      /main branch/,
    );
    expect(() => workflowContext({ ...env, GITHUB_RUN_ID: '../bad' })).toThrow(/main branch/);
  });
});

describe('notarization checkpoint binding', () => {
  test('binds a submission to the exact signed ZIP and source build', () => {
    const f = fixture();
    const record = createSubmission(f.candidate, submissionId, '202');
    expect(validateRecord(record, 'notary', f.candidate)).toBe(record);
    expect(record.signedSha256).toBe(signedHash(f.candidate));
    for (const change of [
      { signedSha256: 'd'.repeat(64) },
      { sourceSha: current },
      { sourceRunId: '999' },
      { submissionId: 'bad' },
    ])
      expect(() => validateRecord({ ...record, ...change }, 'notary', f.candidate)).toThrow();
  });

  test('can restore a submission saved by a later resume run', () => {
    const f = fixture();
    const record = createSubmission(f.candidate, submissionId, '202');
    const directory = join(f.root, 'record');
    const invoke = vi.fn((args) => {
      if (args[0] === 'run') {
        mkdirSync(directory, { recursive: true });
        writeFileSync(join(directory, 'notary.json'), JSON.stringify(record));
        return '';
      }
      if (args[1].includes('/actions/artifacts?'))
        return JSON.stringify([
          {
            artifacts: [
              {
                id: 9,
                name: checkpointName('notary', f.candidate),
                expired: false,
                workflow_run: { id: 202 },
              },
            ],
          },
        ]);
      if (args[1].endsWith('/actions/runs/202')) return JSON.stringify(run('202', current));
      if (args[1].includes('/compare/'))
        return JSON.stringify({ status: 'ahead', merge_base_commit: { sha: source } });
      throw new Error('Unexpected request');
    });
    const store = new CheckpointStore(env, invoke);
    expect(store.restoreRecord('notary', f.candidate, directory).submissionId).toBe(submissionId);
    expect(invoke.mock.calls[0][0][1]).toContain(
      encodeURIComponent(checkpointName('notary', f.candidate)),
    );
  });
});

describe('checkpoints produced earlier in the same job', () => {
  test('reuses the signed files already in place instead of downloading them again', () => {
    const f = fixture();
    const g = storeFixture(f);
    expect(g.store.restoreCandidate(version, '101', f.candidateDir, true)).toEqual(f.candidate);
    expect(g.invoke).not.toHaveBeenCalled();
  });

  test('refuses local signed files from another run or with changed bytes', () => {
    const f = fixture();
    const g = storeFixture(f);
    expect(() => g.store.restoreCandidate(version, '202', f.candidateDir, true)).toThrow(
      /different workflow run/,
    );
    writeFileSync(join(f.candidateDir, 'signed-app.zip'), 'changed');
    expect(() => g.store.restoreCandidate(version, '101', f.candidateDir, true)).toThrow(
      /Corrupted/,
    );
    expect(g.invoke).not.toHaveBeenCalled();
  });

  test('reuses a local submission record only when it binds the same signed application', () => {
    const f = fixture();
    const directory = join(f.root, 'notary');
    mkdirSync(directory);
    const record = createSubmission(f.candidate, submissionId, '101');
    writeFileSync(join(directory, 'notary.json'), JSON.stringify(record));
    const invoke = vi.fn();
    const store = new CheckpointStore(env, invoke);
    expect(store.restoreRecord('notary', f.candidate, directory)).toEqual(record);
    writeFileSync(
      join(directory, 'notary.json'),
      JSON.stringify({ ...record, signedSha256: 'd'.repeat(64) }),
    );
    expect(() => store.restoreRecord('notary', f.candidate, directory)).toThrow(/different signed/);
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe('verified draft checkpoints', () => {
  test('requires a complete release inventory and preserves original source identity', () => {
    const f = fixture();
    const plan = releasePlan(version);
    const submission = createSubmission(f.candidate, submissionId, '202');
    const assets = [
      plan.cli,
      plan.dmg,
      plan.zip,
      plan.manifest,
      'channel.mjs',
      'checksums.txt',
    ].map((name) => ({
      name,
      size: 12,
      digest: `sha256:${'d'.repeat(64)}`,
      path: '/private/temporary/path',
    }));
    const record = createReady(f.candidate, submission, 42, assets, '303');
    expect(record.sourceSha).toBe(source);
    expect(record.sourceRunId).toBe('101');
    expect(record.producerRunId).toBe('303');
    expect(JSON.stringify(record)).not.toContain('/private/');
    for (const change of [
      { assets: [] },
      { assets: [...record.assets, record.assets[0]] },
      { releaseId: 0 },
      { sourceSha: current },
      { assets: record.assets.map((a) => ({ ...a, digest: 'sha256:invalid' })) },
    ])
      expect(() => validateRecord({ ...record, ...change }, 'ready', f.candidate)).toThrow();
  });
});
