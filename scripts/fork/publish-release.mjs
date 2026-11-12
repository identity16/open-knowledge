import { spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { forkReleasePlan, releaseFileDigest } from './release-identity.mjs';

const REPOSITORY = 'identity16/open-knowledge';

function gh(args) {
  const result = spawnSync('gh', args, { encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    const error = new Error(
      'A GitHub release operation failed. Inspect the release state before retrying.',
    );
    error.notFound = result.stderr?.includes('(HTTP 404)') ?? false;
    throw error;
  }
  return result.stdout;
}

export function isNewerForkRelease(version, previous) {
  forkReleasePlan(version);
  forkReleasePlan(previous);
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
  const plan = forkReleasePlan(version);
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

export function publishForkRelease(version, directory, env = process.env, invoke = gh) {
  if (
    env.GITHUB_REPOSITORY !== REPOSITORY ||
    env.GITHUB_REF !== 'refs/heads/main' ||
    !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? '')
  ) {
    throw new Error('Publish only from the fork main branch in GitHub Actions.');
  }
  const plan = forkReleasePlan(version);
  const inventory = stagedReleaseInventory(directory, version);
  const api = (path, optional = false) => {
    try {
      return JSON.parse(invoke(['api', `repos/${REPOSITORY}/${path}`]));
    } catch (error) {
      if (optional && error.notFound) return null;
      throw error;
    }
  };
  const findRelease = () => {
    const pages = JSON.parse(
      invoke(['api', `repos/${REPOSITORY}/releases?per_page=100`, '--paginate', '--slurp']),
    );
    return pages.flat().find((entry) => entry.tag_name === plan.tag) ?? null;
  };
  const latest = api('releases/latest', true);
  if (latest && !isNewerForkRelease(version, latest.tag_name.replace(/^identity16-v/, ''))) {
    throw new Error('A fork release must be newer than the latest published release.');
  }
  let release = findRelease();
  if (release && !release.draft)
    throw new Error('This release is already published; choose a new version.');
  if (release?.assets.some((asset) => !inventory.some((entry) => entry.name === asset.name))) {
    throw new Error('The existing draft contains unexpected assets; inspect it before resuming.');
  }
  const tagExists = () => api(`git/ref/tags/${plan.tag}`, true) !== null;
  const existingTag = tagExists() ? api(`commits/${plan.tag}`) : null;
  if (existingTag && existingTag.sha !== env.GITHUB_SHA)
    throw new Error('The release tag does not point to the workflow source commit.');
  if (release && !existingTag && release.target_commitish !== env.GITHUB_SHA)
    throw new Error('The existing draft targets a different source commit.');
  if (!release) {
    invoke([
      'release',
      'create',
      plan.tag,
      '--repo',
      REPOSITORY,
      '--target',
      env.GITHUB_SHA,
      '--draft',
      '--prerelease=false',
      '--latest=false',
      '--title',
      `OpenKnowledge16 ${version}`,
      '--notes',
      `OpenKnowledge16 for macOS 13+ on Apple Silicon, plus the fork web GUI and CLI. Installation and migration: https://github.com/${REPOSITORY}/blob/${env.GITHUB_SHA}/MIGRATION_IDENTITY16.md`,
    ]);
    release = findRelease();
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
  if (!tagExists()) {
    invoke([
      'api',
      `repos/${REPOSITORY}/git/refs`,
      '--method',
      'POST',
      '-f',
      `ref=refs/tags/${plan.tag}`,
      '-f',
      `sha=${env.GITHUB_SHA}`,
    ]);
  }
  if (api(`commits/${plan.tag}`).sha !== env.GITHUB_SHA)
    throw new Error('The release tag does not point to the workflow source commit.');
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
  release = api(`releases/${release.id}`);
  if (release.draft || release.prerelease || api('releases/latest').tag_name !== plan.tag) {
    throw new Error('GitHub did not confirm publication as the latest stable release.');
  }
  return release.html_url;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const directory = resolve(import.meta.dirname, '../../.fork-release');
  console.log(publishForkRelease(process.argv[2], directory));
}
