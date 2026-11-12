import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { assetName, releaseIdentity, repository, verifyChecksum } from './channel.mjs';

function release() {
  const tag_name = 'identity16-v0.76.0-identity16.1';
  return {
    tag_name,
    draft: false,
    prerelease: false,
    assets: [assetName, 'checksums.txt'].map((name) => ({
      name,
      browser_download_url: `https://github.com/${repository}/releases/download/${tag_name}/${name}`,
    })),
  };
}

test('accepts only published fork releases with both fork-owned assets', () => {
  assert.equal(releaseIdentity(release()).tag, release().tag_name);
  for (const field of ['draft', 'prerelease']) {
    assert.throws(() => releaseIdentity({ ...release(), [field]: true }));
  }
  assert.throws(() => releaseIdentity({ ...release(), tag_name: 'v0.76.0' }));
  assert.throws(() => releaseIdentity({ ...release(), assets: [] }));
  const upstream = release();
  upstream.assets[0].browser_download_url = upstream.assets[0].browser_download_url.replace(
    repository,
    'inkeep/open-knowledge',
  );
  assert.throws(() => releaseIdentity(upstream));
});

test('rejects damaged packages and missing or invalid checksums', () => {
  const data = Buffer.from('release contents');
  const digest = createHash('sha256').update(data).digest('hex');
  const checksums = `${digest}  ${assetName}\n`;
  verifyChecksum(data, checksums);
  assert.throws(() => verifyChecksum(Buffer.from('damaged'), checksums));
  assert.throws(() => verifyChecksum(data, ''));
  assert.throws(() => verifyChecksum(data, `invalid  ${assetName}\n`));
});

test('rollback changes the active release and pins service startup to it', () => {
  const home = mkdtempSync(join(tmpdir(), 'identity16-channel-'));
  try {
    const targets = ['old', 'new'].map((name) => join(home, 'releases', name));
    for (const [index, target] of targets.entries()) {
      const dist = join(target, 'node_modules/@inkeep/open-knowledge/dist');
      mkdirSync(dist, { recursive: true });
      writeFileSync(join(dist, 'cli.mjs'), `console.log('release-${index}');`);
    }
    symlinkSync(targets[1], join(home, 'current'));
    writeFileSync(join(home, 'state.json'), JSON.stringify({ previous: targets[0] }));
    const options = {
      env: { ...process.env, IDENTITY16_OPENKNOWLEDGE_HOME: home },
      encoding: 'utf8',
    };
    const channel = join(import.meta.dirname, 'channel.mjs');
    execFileSync(process.execPath, [channel, 'rollback'], options);
    assert.equal(readlinkSync(join(home, 'current')), targets[0]);
    assert.equal(readFileSync(join(home, 'pinned'), 'utf8'), targets[0]);
    assert.equal(
      execFileSync(process.execPath, [channel, 'start', '--version'], options).trim(),
      'release-0',
    );
    assert.equal(
      JSON.parse(execFileSync(process.execPath, [channel, 'status'], options)).repository,
      repository,
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
