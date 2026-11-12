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

export function forkReleasePlan(version) {
  if (
    typeof version !== 'string' ||
    version.trim() !== version ||
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
