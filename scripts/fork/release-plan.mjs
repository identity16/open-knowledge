import { createHash } from 'node:crypto';
import {
  closeSync,
  copyFileSync,
  existsSync,
  openSync,
  readFileSync,
  readSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';

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

export function forkReleasePlan(version) {
  if (
    !/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)-identity16\.(?:0|[1-9]\d*)$/.test(
      version ?? '',
    )
  ) {
    throw new Error('Expected a fork version such as 0.76.0-identity16.3.');
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

export function stageDesktopRelease(packagedDir, releaseDir, version) {
  const plan = forkReleasePlan(version);
  for (const name of [plan.cli, plan.dmg, plan.zip, plan.manifest]) {
    const root = name === plan.cli ? releaseDir : packagedDir;
    if (!existsSync(join(root, name))) throw new Error(`Release asset is missing: ${name}`);
  }
  const manifest = parse(readFileSync(join(packagedDir, plan.manifest), 'utf8'));
  if (
    manifest?.version !== version ||
    !Array.isArray(manifest.files) ||
    manifest.files.length === 0
  ) {
    throw new Error('The desktop update manifest does not describe this release.');
  }
  if (!manifest.files.some((entry) => entry.url === plan.zip)) {
    throw new Error('The desktop update manifest has no update ZIP.');
  }
  const allowed = new Set([plan.zip, plan.dmg]);
  for (const entry of manifest.files) {
    if (!allowed.has(entry.url)) throw new Error('The update manifest names an unexpected asset.');
    const path = join(packagedDir, entry.url);
    const digest = releaseFileDigest(path, 'sha512', 'base64');
    if (entry.sha512 !== digest || entry.size !== statSync(path).size) {
      throw new Error(`The update asset does not match its manifest: ${entry.url}`);
    }
    entry.url = `${plan.downloadBase}/${encodeURIComponent(entry.url)}`;
  }
  if (manifest.path !== undefined) {
    if (!allowed.has(manifest.path))
      throw new Error('The legacy update path names an unexpected asset.');
    manifest.path = `${plan.downloadBase}/${encodeURIComponent(manifest.path)}`;
  }
  if (manifest.minimumSystemVersion !== '22.0.0') {
    throw new Error('The update manifest must require Darwin 22.0.0.');
  }
  const assets = [plan.cli, plan.dmg, plan.zip, plan.manifest, 'channel.mjs'];
  for (const name of [plan.dmg, plan.zip]) {
    copyFileSync(join(packagedDir, name), join(releaseDir, name));
    const blockmap = `${name}.blockmap`;
    if (existsSync(join(packagedDir, blockmap))) {
      copyFileSync(join(packagedDir, blockmap), join(releaseDir, blockmap));
      assets.push(blockmap);
    }
  }
  writeFileSync(join(releaseDir, plan.manifest), stringify(manifest));
  const checksums = assets.map((name) => {
    const digest = releaseFileDigest(join(releaseDir, name));
    return `${digest}  ${name}`;
  });
  writeFileSync(join(releaseDir, 'checksums.txt'), `${checksums.join('\n')}\n`);
  return [...assets, 'checksums.txt'];
}
