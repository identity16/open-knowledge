import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { parse, stringify } from 'yaml';
import { requireNotarizationCredentials } from './build-desktop.mjs';
import { releaseTag, versionFromTag } from './release-identity.mjs';
import { releasePlan, releaseFileDigest, stageDesktopRelease } from './release-plan.mjs';

const fixtures = [];
afterEach(() => {
  for (const path of fixtures.splice(0)) rmSync(path, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'ok16-release-'));
  fixtures.push(root);
  const packaged = join(root, 'packaged');
  const release = join(root, 'release');
  mkdirSync(packaged);
  mkdirSync(release);
  const plan = releasePlan('0.76.0-identity16.3');
  writeFileSync(join(release, plan.cli), 'web cli');
  writeFileSync(join(release, 'channel.mjs'), 'channel');
  const manifest = {
    version: plan.version,
    path: plan.zip,
    minimumSystemVersion: '22.0.0',
    files: [plan.zip, plan.dmg].map((name) => {
      const bytes = Buffer.from(name);
      writeFileSync(join(packaged, name), bytes);
      return {
        url: name,
        size: bytes.length,
        sha512: createHash('sha512').update(bytes).digest('base64'),
      };
    }),
  };
  writeFileSync(join(packaged, plan.manifest), stringify(manifest));
  return { packaged, release, plan, manifest };
}

describe('release inventory', () => {
  test('hashes artifacts larger than one read buffer without retaining the whole file', () => {
    const { packaged } = fixture();
    const path = join(packaged, 'large-asset');
    const bytes = Buffer.alloc(2 * 1024 * 1024 + 17, 0x5a);
    writeFileSync(path, bytes);
    expect(releaseFileDigest(path)).toBe(createHash('sha256').update(bytes).digest('hex'));
  });
  test.each([
    'v0.76.0-identity16.3',
    '0.76.0-beta.3',
    '0.76.0-identity16.03',
    '0.76.0-identity16.3\n',
    '../v1',
    '',
    undefined,
  ])('rejects an invalid release version %j', (version) => {
    expect(() => releasePlan(version)).toThrow(/release version/);
  });

  test('plain versions get v tags while legacy versions keep their original tags', () => {
    expect(releasePlan('0.77.0').tag).toBe('v0.77.0');
    expect(releasePlan('0.77.0').zip).toBe('OpenKnowledge16-0.77.0-arm64-mac.zip');
    expect(releasePlan('0.76.0-identity16.6').tag).toBe('identity16-v0.76.0-identity16.6');
    for (const version of ['0.77.0', '0.76.0-identity16.6'])
      expect(versionFromTag(releaseTag(version))).toBe(version);
    expect(() => versionFromTag('v0.76.0-identity16.6')).toThrow(/release tag/);
    expect(() => versionFromTag('identity16-v0.77.0')).toThrow(/release tag/);
  });

  test('pins updater downloads to the versioned release and checksums every published file', () => {
    const { packaged, release, plan } = fixture();
    writeFileSync(join(packaged, `${plan.zip}.blockmap`), 'delta data');
    const assets = stageDesktopRelease(packaged, release, plan.version);
    const manifest = parse(readFileSync(join(release, plan.manifest), 'utf8'));
    expect(manifest.files.map((entry) => entry.url)).toEqual(
      [plan.zip, plan.dmg].map((name) => `${plan.downloadBase}/${name}`),
    );
    expect(manifest.path).toBe(`${plan.downloadBase}/${plan.zip}`);
    expect(assets).toContain(`${plan.zip}.blockmap`);
    const sums = readFileSync(join(release, 'checksums.txt'), 'utf8');
    for (const name of assets.filter((asset) => asset !== 'checksums.txt')) {
      expect(sums).toContain(
        `${createHash('sha256')
          .update(readFileSync(join(release, name)))
          .digest('hex')}  ${name}\n`,
      );
    }
  });

  test('refuses a corrupted update ZIP before staging any desktop installer', () => {
    const { packaged, release, plan } = fixture();
    writeFileSync(join(packaged, plan.zip), 'tampered');
    expect(() => stageDesktopRelease(packaged, release, plan.version)).toThrow(/does not match/);
    expect(existsSync(join(release, plan.dmg))).toBe(false);
  });

  test.each(['missing-zip', 'wrong-version', 'wrong-platform', 'foreign-url'])(
    'refuses an incomplete or mismatched update manifest: %s',
    (mode) => {
      const { packaged, release, plan, manifest } = fixture();
      if (mode === 'missing-zip')
        manifest.files = manifest.files.filter((entry) => entry.url !== plan.zip);
      if (mode === 'wrong-version') manifest.version = '0.76.0-identity16.2';
      if (mode === 'wrong-platform') manifest.minimumSystemVersion = '1.0.0';
      if (mode === 'foreign-url') manifest.files[1].url = 'https://example.com/app.dmg';
      writeFileSync(join(packaged, plan.manifest), stringify(manifest));
      expect(() => stageDesktopRelease(packaged, release, plan.version)).toThrow();
      expect(existsSync(join(release, plan.dmg))).toBe(false);
    },
  );

  test('requires the web archive in the same release', () => {
    const { packaged, release, plan } = fixture();
    rmSync(join(release, plan.cli));
    expect(() => stageDesktopRelease(packaged, release, plan.version)).toThrow(
      /openknowledge-darwin-arm64.tgz/,
    );
  });
});

describe('release credential requirements', () => {
  const complete = {
    APPLE_API_KEY: 'key-file',
    APPLE_API_KEY_ID: 'key-id',
    APPLE_API_ISSUER: 'issuer',
    CSC_KEYCHAIN: 'keychain',
  };

  test('rejects unsigned or partially configured releases without printing credential values', () => {
    expect(() => requireNotarizationCredentials({})).toThrow(/APPLE_API_KEY/);
    expect(() => requireNotarizationCredentials({ ...complete, CSC_KEYCHAIN: undefined })).toThrow(
      /Developer ID/,
    );
    expect(() =>
      requireNotarizationCredentials({ ...complete, CSC_LINK: 'test-sensitive-link' }),
    ).toThrow('CSC_KEY_PASSWORD is required with CSC_LINK.');
    expect(() =>
      requireNotarizationCredentials({ ...complete, APPLE_ID: 'test-sensitive-identity' }),
    ).toThrow('Use only the dedicated App Store Connect API key for this release.');
  });
});
