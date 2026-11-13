import { spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  releasePlan,
  releaseFileDigest,
  validateReleaseInventory,
} from './release-identity.mjs';

const REPOSITORY = 'identity16/open-knowledge';

function gh(args) {
  const result = spawnSync('gh', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (result.error || result.status !== 0) {
    const error = new Error(
      'A GitHub release operation failed. Inspect the release state before retrying.',
    );
    error.notFound = result.stderr?.includes('(HTTP 404)') ?? false;
    throw error;
  }
  return result.stdout;
}

export function isNewerRelease(version, previous) {
  releasePlan(version);
  releasePlan(previous);
  const parts = (value) =>
    value
      .replace('-identity16.', '.')
      .split('.')
      .map((part) => BigInt(part));
  const left = parts(version);
  const right = parts(previous);
  for (let index = 0; index < left.length; index++) {
    if (left[index] !== right[index]) return left[index] > right[index];
  }
  return false;
}

export function stagedReleaseInventory(directory, version) {
  const plan = releasePlan(version);
  const required = [plan.cli, plan.dmg, plan.zip, plan.manifest, 'channel.mjs', 'checksums.txt'];
  const allowed = new Set([...required, `${plan.dmg}.blockmap`, `${plan.zip}.blockmap`]);
  const names = JSON.parse(readFileSync(join(directory, 'release-assets.json'), 'utf8'));
  if (
    !Array.isArray(names) ||
    new Set(names).size !== names.length ||
    names.some((name) => !allowed.has(name)) ||
    required.some((name) => !names.includes(name))
  ) {
    throw new Error('The staged release inventory is incomplete or contains unexpected assets.');
  }
  const sums = new Map(
    readFileSync(join(directory, 'checksums.txt'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => {
        const match = /^([a-f0-9]{64}) {2}(\S+)$/.exec(line);
        if (!match) throw new Error('Malformed release checksum file.');
        return [match[2], match[1]];
      }),
  );
  return names.map((name) => {
    const path = join(directory, name);
    const sha256 = releaseFileDigest(path);
    const size = statSync(path).size;
    if (!size || (name !== 'checksums.txt' && sums.get(name) !== sha256)) {
      throw new Error(`The staged release checksum does not match ${name}.`);
    }
    return { name, path, size, digest: `sha256:${sha256}` };
  });
}

export function verifyUploadedInventory(expected, uploaded) {
  if (
    expected.length !== uploaded.length ||
    new Set(uploaded.map((asset) => asset.name)).size !== uploaded.length
  ) {
    throw new Error('The draft release inventory does not match the local inventory.');
  }
  for (const asset of expected) {
    const remote = uploaded.find((entry) => entry.name === asset.name);
    if (remote?.size !== asset.size || remote?.digest !== asset.digest) {
      throw new Error(`The uploaded release asset failed verification: ${asset.name}.`);
    }
  }
}

function publicationContext(version, sourceSha, env, invoke) {
  if (
    env.GITHUB_REPOSITORY !== REPOSITORY ||
    env.GITHUB_REF !== 'refs/heads/main' ||
    typeof env.GITHUB_SHA !== 'string' ||
    env.GITHUB_SHA.trim() !== env.GITHUB_SHA ||
    !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA) ||
    typeof sourceSha !== 'string' ||
    sourceSha.trim() !== sourceSha ||
    !/^[a-f0-9]{40}$/.test(sourceSha)
  )
    throw new Error('Publish only from main branch in GitHub Actions.');
  const plan = releasePlan(version);
  const api = (path, optional = false) => {
    try {
      return JSON.parse(invoke(['api', `repos/${REPOSITORY}/${path}`]));
    } catch (error) {
      if (optional && error.notFound) return null;
      throw error;
    }
  };
  if (sourceSha !== env.GITHUB_SHA) {
    const comparison = api(`compare/${sourceSha}...${env.GITHUB_SHA}`);
    if (comparison.status !== 'ahead' || comparison.merge_base_commit?.sha !== sourceSha)
      throw new Error('The release source must be an ancestor of the current main commit.');
  }
  const tagCommit = () =>
    api(`git/ref/tags/${plan.tag}`, true) ? api(`commits/${plan.tag}`).sha : null;
  const checkSource = (release) => {
    const existing = tagCommit();
    if (
      (existing && existing !== sourceSha) ||
      (release && (release.tag_name !== plan.tag || release.target_commitish !== sourceSha))
    )
      throw new Error('The release tag or draft targets a different source commit.');
    return existing;
  };
  const checkLatest = () => {
    const latest = api('releases/latest', true);
    if (latest && !isNewerRelease(version, latest.tag_name.replace(/^identity16-v/, '')))
      throw new Error('A release must be newer than the latest published release.');
  };
  const findRelease = () => {
    const pages = JSON.parse(
      invoke(['api', `repos/${REPOSITORY}/releases?per_page=100`, '--paginate', '--slurp']),
    );
    return pages.flat().find((entry) => entry.tag_name === plan.tag) ?? null;
  };
  return { plan, api, checkSource, checkLatest, findRelease };
}

export function preflightRelease(version, sourceSha, env = process.env, invoke = gh) {
  const context = publicationContext(version, sourceSha, env, invoke);
  const release = context.findRelease();
  context.checkSource(release);
  if (release && !release.draft)
    throw new Error('This release is already published; choose a new version.');
  context.checkLatest();
  return release;
}

const DRAFT_VISIBILITY_ATTEMPTS = 10;
const DRAFT_VISIBILITY_PAUSE_MS = 2_000;

function pauseSync(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

export function stageRelease(
  version,
  directory,
  sourceSha,
  env = process.env,
  invoke = gh,
  pause = pauseSync,
) {
  const { plan, api, findRelease } = publicationContext(version, sourceSha, env, invoke);
  let release = preflightRelease(version, sourceSha, env, invoke);
  const inventory = stagedReleaseInventory(directory, version);
  if (release?.assets.some((asset) => !inventory.some((entry) => entry.name === asset.name)))
    throw new Error('The existing draft contains unexpected assets; inspect it before resuming.');
  if (!release) {
    invoke([
      'release',
      'create',
      plan.tag,
      '--repo',
      REPOSITORY,
      '--target',
      sourceSha,
      '--draft',
      '--prerelease=false',
      '--latest=false',
      '--title',
      `OpenKnowledge16 ${version}`,
      '--notes',
      `OpenKnowledge16 for macOS 13+ on Apple Silicon, plus the web GUI and CLI. Installation and migration: https://github.com/${REPOSITORY}/blob/${sourceSha}/MIGRATION_IDENTITY16.md`,
    ]);
    release = findRelease();
    for (let attempt = 1; !release && attempt < DRAFT_VISIBILITY_ATTEMPTS; attempt += 1) {
      pause(DRAFT_VISIBILITY_PAUSE_MS);
      release = findRelease();
    }
    if (!release?.draft) throw new Error('GitHub did not confirm creation of the draft release.');
  }
  invoke([
    'release',
    'upload',
    plan.tag,
    '--repo',
    REPOSITORY,
    '--clobber',
    ...inventory.map((asset) => asset.path),
  ]);
  release = api(`releases/${release.id}`);
  verifyUploadedInventory(inventory, release.assets);
  return {
    version,
    sourceSha,
    releaseId: release.id,
    assets: inventory.map(({ name, size, digest }) => ({ name, size, digest })),
  };
}

export function promoteRelease(proof, env = process.env, invoke = gh) {
  const { plan, api, checkSource, checkLatest } = publicationContext(
    proof.version,
    proof.sourceSha,
    env,
    invoke,
  );
  validateReleaseInventory(proof.version, proof.assets);
  if (!Number.isSafeInteger(proof.releaseId) || proof.releaseId < 1)
    throw new Error('Invalid staged release ID.');
  let release = api(`releases/${proof.releaseId}`);
  const existingTag = checkSource(release);
  verifyUploadedInventory(proof.assets, release.assets);
  if (!release.draft) {
    if (!existingTag || release.prerelease)
      throw new Error('The published release does not match the staged stable release.');
    return release.html_url;
  }
  checkLatest();
  if (!existingTag)
    invoke([
      'api',
      `repos/${REPOSITORY}/git/refs`,
      '--method',
      'POST',
      '-f',
      `ref=refs/tags/${plan.tag}`,
      '-f',
      `sha=${proof.sourceSha}`,
    ]);
  if (api(`commits/${plan.tag}`).sha !== proof.sourceSha)
    throw new Error('The release tag does not point to the original build source commit.');
  invoke([
    'release',
    'edit',
    plan.tag,
    '--repo',
    REPOSITORY,
    '--draft=false',
    '--prerelease=false',
    '--latest',
  ]);
  release = api(`releases/${proof.releaseId}`);
  if (release.draft || release.prerelease || api('releases/latest').tag_name !== plan.tag)
    throw new Error('GitHub did not confirm publication as the latest stable release.');
  return release.html_url;
}

export function publishRelease(version, directory, env = process.env, invoke = gh) {
  return promoteRelease(
    stageRelease(version, directory, env.GITHUB_SHA, env, invoke),
    env,
    invoke,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const directory = resolve(import.meta.dirname, '../../.release');
  console.log(publishRelease(process.argv[2], directory));
}
