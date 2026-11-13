import { copyFileSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';
import { releasePlan, releaseFileDigest } from './release-identity.mjs';

export { releasePlan, releaseFileDigest } from './release-identity.mjs';

export function stageDesktopRelease(packagedDir, releaseDir, version) {
  const plan = releasePlan(version);
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
