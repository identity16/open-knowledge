import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  isNewerForkRelease,
  publishForkRelease,
  stageForkRelease,
  promoteForkRelease,
  preflightForkRelease,
  stagedReleaseInventory,
  verifyUploadedInventory,
} from './publish-release.mjs';
import { forkReleasePlan, releaseFileDigest } from './release-plan.mjs';

const fixtures = [];
afterEach(() => {
  for (const path of fixtures.splice(0)) rmSync(path, { recursive: true, force: true });
});

function fixture() {
  const path = mkdtempSync(join(tmpdir(), 'ok16-publish-'));
  fixtures.push(path);
  const plan = forkReleasePlan('0.76.0-identity16.4');
  const files = [plan.cli, plan.dmg, plan.zip, plan.manifest, 'channel.mjs'];
  for (const name of files) writeFileSync(join(path, name), `content:${name}`);
  writeFileSync(
    join(path, 'checksums.txt'),
    files.map((name) => `${releaseFileDigest(join(path, name))}  ${name}`).join('\n') + '\n',
  );
  writeFileSync(join(path, 'release-assets.json'), JSON.stringify([...files, 'checksums.txt']));
  return { path, plan, inventory: stagedReleaseInventory(path, plan.version) };
}

function github(f, corrupt = false, tagSha = null) {
  const sha = 'a'.repeat(40);
  let draft = null;
  let latest = { tag_name: 'identity16-v0.76.0-identity16.3' };
  const invoke = vi.fn((args) => {
    const [command, operation] = args;
    if (command === 'api') {
      if (operation.includes('/compare/'))
        return JSON.stringify({ status: 'ahead', merge_base_commit: { sha } });
      if (operation.endsWith('/releases/latest')) return JSON.stringify(latest);
      if (operation.endsWith('/releases?per_page=100'))
        return JSON.stringify([draft ? [draft] : []]);
      if (operation.endsWith('/git/refs') && args.includes('POST')) {
        tagSha = args.find((arg) => arg.startsWith('sha=')).slice(4);
        return '{}';
      }
      if (operation.includes('/git/ref/tags/')) {
        if (!tagSha) throw Object.assign(new Error('not found'), { notFound: true });
        return JSON.stringify({ object: { type: 'commit', sha: tagSha } });
      }
      if (operation.includes('/commits/')) {
        if (!tagSha)
          throw Object.assign(new Error('No commit found (HTTP 422)'), { notFound: false });
        return JSON.stringify({ sha: tagSha });
      }
      if (operation.includes('/releases/tags/')) {
        throw Object.assign(new Error('draft is not available by tag'), { notFound: true });
      }
      if (operation.endsWith('/releases/42')) {
        if (!draft) throw Object.assign(new Error('not found'), { notFound: true });
        return JSON.stringify(draft);
      }
    }
    if (command === 'release' && operation === 'create')
      draft = {
        id: 42,
        tag_name: f.plan.tag,
        draft: true,
        target_commitish: args[args.indexOf('--target') + 1],
        assets: [],
        html_url: `${f.plan.downloadBase}`,
      };
    else if (command === 'release' && operation === 'upload') {
      draft.assets = f.inventory.map(({ name, size, digest }) => ({ name, size, digest }));
      if (corrupt) draft.assets[0].digest = 'sha256:bad';
    } else if (command === 'release' && operation === 'edit') {
      draft.draft = false;
      draft.prerelease = false;
      latest = { tag_name: f.plan.tag };
    } else throw new Error(`Unexpected operation ${command} ${operation}`);
    return '';
  });
  return {
    invoke,
    setLatest: (value) => {
      latest = { tag_name: `identity16-v${value}` };
    },
    env: {
      GITHUB_REPOSITORY: 'identity16/open-knowledge',
      GITHUB_REF: 'refs/heads/main',
      GITHUB_SHA: sha,
    },
  };
}

describe('atomic fork publication', () => {
  test('publishes only after uploaded hashes and sizes match the staged inventory', () => {
    const f = fixture();
    const g = github(f);
    expect(publishForkRelease(f.plan.version, f.path, g.env, g.invoke)).toBe(f.plan.downloadBase);
    expect(
      g.invoke.mock.calls.filter(([args]) => args[0] === 'release').map(([args]) => args[1]),
    ).toEqual(['create', 'upload', 'edit']);
  });

  test('leaves a corrupted upload in draft', () => {
    const f = fixture();
    const g = github(f, true);
    expect(() => publishForkRelease(f.plan.version, f.path, g.env, g.invoke)).toThrow(
      /failed verification/,
    );
    expect(g.invoke.mock.calls.some(([args]) => args[0] === 'release' && args[1] === 'edit')).toBe(
      false,
    );
  });

  test('refuses an existing tag for different source before modifying the release', () => {
    const f = fixture();
    const g = github(f, false, 'b'.repeat(40));
    expect(() => publishForkRelease(f.plan.version, f.path, g.env, g.invoke)).toThrow(
      /source commit/,
    );
    expect(g.invoke.mock.calls.some(([args]) => args[0] === 'release')).toBe(false);
  });

  test('refuses stale local checksums, unexpected files and incomplete remote inventories', () => {
    const f = fixture();
    writeFileSync(join(f.path, f.plan.cli), 'changed since build');
    expect(() => stagedReleaseInventory(f.path, f.plan.version)).toThrow(/checksum/);
    expect(() => verifyUploadedInventory(f.inventory, f.inventory.slice(1))).toThrow(/inventory/);
    const names = JSON.parse(readFileSync(join(f.path, 'release-assets.json'), 'utf8'));
    writeFileSync(
      join(f.path, 'release-assets.json'),
      JSON.stringify([...names, '../private-key']),
    );
    expect(() => stagedReleaseInventory(f.path, f.plan.version)).toThrow(/unexpected/);
  });

  test('denies a non-main publication before any GitHub operation', () => {
    const f = fixture();
    const g = github(f);
    expect(() =>
      publishForkRelease(
        f.plan.version,
        f.path,
        { ...g.env, GITHUB_REF: 'refs/heads/feature' },
        g.invoke,
      ),
    ).toThrow(/main branch/);
    expect(g.invoke).not.toHaveBeenCalled();
  });

  test('preflights before building without mutating GitHub', () => {
    const f = fixture();
    const g = github(f);
    expect(preflightForkRelease(f.plan.version, g.env.GITHUB_SHA, g.env, g.invoke)).toBeNull();
    expect(g.invoke.mock.calls.every(([args]) => args[0] === 'api' && !args.includes('POST'))).toBe(
      true,
    );
    g.setLatest('0.76.0-identity16.5');
    expect(() => preflightForkRelease(f.plan.version, g.env.GITHUB_SHA, g.env, g.invoke)).toThrow(
      /newer/,
    );
  });

  test('stages without publishing, then promotes the original source from a newer main workflow', () => {
    const f = fixture();
    const g = github(f);
    const env = { ...g.env, GITHUB_SHA: 'b'.repeat(40) };
    const proof = stageForkRelease(f.plan.version, f.path, g.env.GITHUB_SHA, env, g.invoke);
    expect(g.invoke.mock.calls.some(([args]) => args[1] === 'edit')).toBe(false);
    expect(proof.sourceSha).toBe(g.env.GITHUB_SHA);
    expect(proof.assets.every((asset) => !Object.hasOwn(asset, 'path'))).toBe(true);
    expect(promoteForkRelease(proof, env, g.invoke)).toBe(f.plan.downloadBase);
    const createRef = g.invoke.mock.calls.find(([args]) => args.includes('POST'))[0];
    expect(createRef).toContain(`sha=${g.env.GITHUB_SHA}`);
    expect(createRef).not.toContain(`sha=${env.GITHUB_SHA}`);
  });

  test('retries a lost publication response without changing public files or regressing latest', () => {
    const f = fixture();
    const g = github(f);
    const proof = stageForkRelease(f.plan.version, f.path, g.env.GITHUB_SHA, g.env, g.invoke);
    const lostResponse = (args) => {
      const result = g.invoke(args);
      if (args[0] === 'release' && args[1] === 'edit') throw new Error('Lost response');
      return result;
    };
    expect(() => promoteForkRelease(proof, g.env, lostResponse)).toThrow('Lost response');
    g.setLatest('0.76.0-identity16.10');
    g.invoke.mockClear();
    expect(promoteForkRelease(proof, g.env, g.invoke)).toBe(f.plan.downloadBase);
    expect(g.invoke.mock.calls.every(([args]) => args[0] === 'api' && !args.includes('POST'))).toBe(
      true,
    );
    expect(() =>
      stageForkRelease(f.plan.version, f.path, g.env.GITHUB_SHA, g.env, g.invoke),
    ).toThrow(/already published/);
  });

  test('rejects incomplete proofs and changed remote files before publishing', () => {
    const f = fixture();
    const g = github(f);
    const proof = stageForkRelease(f.plan.version, f.path, g.env.GITHUB_SHA, g.env, g.invoke);
    expect(() => promoteForkRelease({ ...proof, assets: [] }, g.env, g.invoke)).toThrow(
      /inventory/,
    );
    const altered = { ...proof, assets: proof.assets.map((a) => ({ ...a, size: a.size + 1 })) };
    expect(() => promoteForkRelease(altered, g.env, g.invoke)).toThrow(/failed verification/);
    expect(g.invoke.mock.calls.some(([args]) => args[1] === 'edit')).toBe(false);
  });

  test('rejects unrelated source histories before any release mutation', () => {
    const f = fixture();
    const g = github(f);
    const invoke = (args) =>
      args[1].includes('/compare/')
        ? JSON.stringify({ status: 'diverged', merge_base_commit: { sha: 'c'.repeat(40) } })
        : g.invoke(args);
    expect(() => stageForkRelease(f.plan.version, f.path, 'b'.repeat(40), g.env, invoke)).toThrow(
      /ancestor/,
    );
    expect(g.invoke).not.toHaveBeenCalled();
  });

  test('orders fork counters numerically and prevents downgrades', () => {
    expect(isNewerForkRelease('0.76.0-identity16.10', '0.76.0-identity16.9')).toBe(true);
    expect(isNewerForkRelease('0.76.0-identity16.4', '0.76.0-identity16.4')).toBe(false);
    expect(isNewerForkRelease('0.75.9-identity16.99', '0.76.0-identity16.3')).toBe(false);
  });
});
