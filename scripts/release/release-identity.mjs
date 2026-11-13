import { createHash } from 'node:crypto';
import { closeSync, openSync, readSync } from 'node:fs';

export function releaseFileDigest(path, algorithm = 'sha256', encoding = 'hex') {
  const file = openSync(path, 'r');
  const hash = createHash(algorithm);
  const buffer = Buffer.alloc(1024 * 1024);
  try {
    let count = readSync(file, buffer, 0, buffer.length, null);
    while (count > 0) {
      hash.update(buffer.subarray(0, count));
      count = readSync(file, buffer, 0, buffer.length, null);
    }
    return hash.digest(encoding);
  } finally {
    closeSync(file);
  }
}

const NUMBER = '(?:0|[1-9]\\d*)';
const RELEASE_VERSION = new RegExp(
  `^(${NUMBER})\\.(${NUMBER})\\.(${NUMBER})(?:-identity16\\.(${NUMBER}))?$`,
);
const LEGACY_TAG_PREFIX = 'identity16-v';

export function parseReleaseVersion(version) {
  const match = typeof version === 'string' ? RELEASE_VERSION.exec(version) : null;
  if (!match) throw new Error('Expected a release version such as 0.77.0.');
  const [, major, minor, patch, legacyCounter] = match;
  return {
    core: [major, minor, patch].map((part) => BigInt(part)),
    legacyCounter: legacyCounter === undefined ? null : BigInt(legacyCounter),
  };
}

export function releaseTag(version) {
  return parseReleaseVersion(version).legacyCounter === null
    ? `v${version}`
    : `${LEGACY_TAG_PREFIX}${version}`;
}

export function versionFromTag(tag) {
  const version = tag.startsWith(LEGACY_TAG_PREFIX)
    ? tag.slice(LEGACY_TAG_PREFIX.length)
    : tag.replace(/^v/, '');
  if (releaseTag(version) !== tag) throw new Error(`Not a release tag: ${tag}`);
  return version;
}

export function compareReleaseVersions(left, right) {
  const a = parseReleaseVersion(left);
  const b = parseReleaseVersion(right);
  for (let index = 0; index < a.core.length; index++) {
    if (a.core[index] !== b.core[index]) return a.core[index] > b.core[index] ? 1 : -1;
  }
  if (a.legacyCounter === b.legacyCounter) return 0;
  if (a.legacyCounter === null) return 1;
  if (b.legacyCounter === null) return -1;
  return a.legacyCounter > b.legacyCounter ? 1 : -1;
}

export function releasePlan(version) {
  if (typeof version !== 'string' || version.trim() !== version) parseReleaseVersion(null);
  const tag = releaseTag(version);
  return {
    version,
    tag,
    downloadBase: `https://github.com/identity16/open-knowledge/releases/download/${tag}`,
    dmg: 'OpenKnowledge16-arm64.dmg',
    zip: `OpenKnowledge16-${version}-arm64-mac.zip`,
    manifest: 'latest-mac.yml',
    cli: 'openknowledge-darwin-arm64.tgz',
  };
}

export function validateReleaseInventory(version, assets) {
  const plan = releasePlan(version);
  const required = [plan.cli, plan.dmg, plan.zip, plan.manifest, 'channel.mjs', 'checksums.txt'];
  const allowed = [...required, `${plan.dmg}.blockmap`, `${plan.zip}.blockmap`];
  if (
    !Array.isArray(assets) ||
    new Set(assets.map((asset) => asset.name)).size !== assets.length ||
    required.some((name) => !assets.some((asset) => asset.name === name)) ||
    assets.some(
      (asset) =>
        !allowed.includes(asset.name) ||
        !Number.isSafeInteger(asset.size) ||
        asset.size < 1 ||
        typeof asset.digest !== 'string' ||
        asset.digest.trim() !== asset.digest ||
        !/^sha256:[a-f0-9]{64}$/.test(asset.digest),
    )
  )
    throw new Error('Incomplete or invalid staged release inventory.');
  return assets;
}
