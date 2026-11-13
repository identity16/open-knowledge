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

export function releasePlan(version) {
  if (
    typeof version !== 'string' ||
    version.trim() !== version ||
    !/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)-identity16\.(?:0|[1-9]\d*)$/.test(
      version ?? '',
    )
  ) {
    throw new Error('Expected a release version such as 0.76.0-identity16.3.');
  }
  const tag = `identity16-v${version}`;
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
