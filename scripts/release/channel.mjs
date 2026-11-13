#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repository = 'identity16/open-knowledge';
export const service = 'com.identity16.openknowledge';
export const assetName = 'openknowledge-darwin-arm64.tgz';
const base = process.env.OPENKNOWLEDGE16_HOME ?? join(homedir(), '.local/share', service);
const cliRelative = 'node_modules/@inkeep/open-knowledge/dist/cli.mjs';
const current = join(base, 'current');

export function releaseIdentity(release) {
  if (
    release.draft ||
    release.prerelease ||
    !/^identity16-v\d+\.\d+\.\d+-identity16\.\d+$/.test(release.tag_name ?? '')
  ) {
    throw new Error('Latest release is not a stable identity16 web release.');
  }
  const asset = release.assets?.find((entry) => entry.name === assetName);
  const checksums = release.assets?.find((entry) => entry.name === 'checksums.txt');
  for (const entry of [asset, checksums]) {
    if (
      !entry ||
      entry.browser_download_url !==
        `https://github.com/${repository}/releases/download/${release.tag_name}/${entry.name}`
    ) {
      throw new Error('Release assets must come from the identity16 repository.');
    }
  }
  return { tag: release.tag_name, asset, checksums };
}

export function verifyChecksum(bytes, checksums) {
  const expected = checksums
    .split('\n')
    .find((line) => line.endsWith(`  ${assetName}`))
    ?.split(' ')[0];
  if (
    !expected ||
    !/^[a-f0-9]{64}$/.test(expected) ||
    createHash('sha256').update(bytes).digest('hex') !== expected
  ) {
    throw new Error('Release checksum mismatch.');
  }
}

async function download(url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(60_000),
    headers: { 'User-Agent': service },
  });
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

function activate(target) {
  const pending = join(base, `current-${process.pid}`);
  symlinkSync(target, pending);
  renameSync(pending, current);
}

const localPinPrefix = 'local:';

export function localPinBaseline(pin) {
  return pin.startsWith(localPinPrefix) ? pin.slice(localPinPrefix.length) : null;
}

export function keepsLocalPin(pin, latestTag) {
  const baseline = localPinBaseline(pin);
  return baseline !== null && baseline === latestTag;
}

function readState() {
  const path = join(base, 'state.json');
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
}

function writeState(state) {
  writeFileSync(join(base, 'state.json'), `${JSON.stringify({ repository, ...state }, null, 2)}\n`);
}

function withLock(work) {
  mkdirSync(join(base, 'releases'), { recursive: true });
  const lock = join(base, 'update.lock');
  mkdirSync(lock);
  return Promise.resolve()
    .then(work)
    .finally(() => rmSync(lock, { recursive: true, force: true }));
}

function installArchive(archive, target) {
  const staging = mkdtempSync(join(base, 'releases', '.install-'));
  try {
    execFileSync(
      'npm',
      [
        'install',
        '--prefix',
        staging,
        '--omit=dev',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        archive,
      ],
      { stdio: 'inherit', timeout: 300_000 },
    );
    const cli = join(staging, cliRelative);
    execFileSync(process.execPath, [cli, '--version'], { stdio: 'inherit', timeout: 30_000 });
    if (!existsSync(join(dirname(cli), 'public/index.html')))
      throw new Error('Web GUI assets are missing.');
    rmSync(join(staging, assetName), { force: true });
    renameSync(staging, target);
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}

function switchTo(target) {
  const previous = existsSync(current) ? readlinkSync(current) : null;
  activate(target);
  const nextChannel = join(target, dirname(cliRelative), 'identity16-channel.mjs');
  if (existsSync(nextChannel)) {
    const pendingChannel = join(base, 'channel.pending.mjs');
    copyFileSync(nextChannel, pendingChannel);
    renameSync(pendingChannel, join(base, 'channel.mjs'));
  }
  return previous;
}

function releaseBaseline(state) {
  if (!state) return null;
  return state.baseline ?? state.tag ?? null;
}

export async function update({ force = false } = {}) {
  if (process.platform !== 'darwin' || process.arch !== 'arm64')
    throw new Error('This channel supports macOS Apple Silicon.');
  mkdirSync(join(base, 'releases'), { recursive: true });
  const pinPath = join(base, 'pinned');
  const pin = existsSync(pinPath) ? readFileSync(pinPath, 'utf8').trim() : null;
  if (!force && pin !== null && localPinBaseline(pin) === null) return;
  await withLock(async () => {
    const release = JSON.parse(
      await download(`https://api.github.com/repos/${repository}/releases/latest`),
    );
    const { tag, asset, checksums } = releaseIdentity(release);
    if (!force && pin !== null && keepsLocalPin(pin, tag)) return;
    const target = join(base, 'releases', tag);
    if (existsSync(current) && readlinkSync(current) === target) {
      if (force) rmSync(pinPath, { force: true });
      console.error(`Already installed: ${tag}`);
      return;
    }
    if (!existsSync(target)) {
      const staging = mkdtempSync(join(base, 'releases', '.download-'));
      try {
        const [bytes, checksumBytes] = await Promise.all([
          download(asset.browser_download_url),
          download(checksums.browser_download_url),
        ]);
        verifyChecksum(bytes, checksumBytes.toString('utf8'));
        const archive = join(staging, assetName);
        writeFileSync(archive, bytes);
        installArchive(archive, target);
      } finally {
        rmSync(staging, { recursive: true, force: true });
      }
    }
    const previous = switchTo(target);
    writeState({ tag, previous });
    rmSync(pinPath, { force: true });
    console.error(`Installed ${repository}@${tag}`);
  });
}

export async function installLocal(archive, label) {
  if (!/^local-[A-Za-z0-9.-]+$/.test(label)) throw new Error(`Invalid local build label: ${label}`);
  await withLock(() => {
    const target = join(base, 'releases', label);
    if (existsSync(target)) rmSync(target, { recursive: true, force: true });
    installArchive(archive, target);
    const baseline = releaseBaseline(readState());
    const previous = switchTo(target);
    writeState({ tag: label, previous, baseline });
    writeFileSync(join(base, 'pinned'), `${localPinPrefix}${baseline ?? ''}`);
    console.error(
      `Installed local build ${label}; it stays until a release newer than ${baseline ?? 'none'} is published.`,
    );
  });
}

function rollback() {
  const state = JSON.parse(readFileSync(join(base, 'state.json'), 'utf8'));
  if (!state.previous || !existsSync(join(state.previous, cliRelative)))
    throw new Error('No previous installation is available.');
  const previous = readlinkSync(current);
  activate(state.previous);
  writeFileSync(join(base, 'pinned'), state.previous);
  writeState({ tag: state.previous.split('/').at(-1), previous, baseline: releaseBaseline(state) });
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'update') return update({ force: true });
  if (command === 'rollback') return rollback();
  if (command === 'install-local') return installLocal(resolve(args[0] ?? ''), args[1] ?? '');
  if (command === 'status') {
    console.log(
      existsSync(current) ? readFileSync(join(base, 'state.json'), 'utf8') : 'Not installed',
    );
    return;
  }
  if (command === 'start' || command === 'run') {
    if (command === 'start') {
      try {
        await update();
      } catch (error) {
        if (!existsSync(join(current, cliRelative))) throw error;
        console.error(`Keeping installed release: ${error.message}`);
      }
    }
    process.execve(
      process.execPath,
      [process.execPath, join(current, cliRelative), ...args],
      process.env,
    );
    return;
  }
  throw new Error(
    'Usage: channel.mjs update | status | rollback | install-local <archive> <label> | run <ok arguments> | start <ok arguments>',
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
