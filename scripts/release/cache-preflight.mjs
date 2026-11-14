import { spawn, spawnSync } from 'node:child_process';
import { lstatSync, readlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export function linkedCachePaths(home = homedir()) {
  return [
    join(home, 'Library/pnpm/store'),
    join(home, 'Library/Caches/pnpm'),
    join(home, 'Library/Caches/electron'),
    join(home, 'Library/Caches/electron-builder'),
    join(home, '.rustup'),
  ].filter((path) => {
    try {
      return lstatSync(path).isSymbolicLink();
    } catch {
      return false;
    }
  });
}

function probe(path, { timeoutMs, command }) {
  return new Promise((settle) => {
    const child = spawn(command[0], [...command.slice(1), path], { stdio: 'ignore' });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      child.unref();
      settle({ path, state: 'hung' });
    }, timeoutMs);
    child.once('error', () => {
      clearTimeout(timer);
      settle({ path, state: 'missing' });
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      settle({ path, state: code === 0 ? 'ok' : 'missing' });
    });
  });
}

export function probeCachePaths(paths, { timeoutMs = 5_000, command = ['/bin/test', '-d'] } = {}) {
  return Promise.all(paths.map((path) => probe(path, { timeoutMs, command })));
}

export function volumeOf(target) {
  const match = /^\/Volumes\/[^/]+/.exec(target);
  return match ? match[0] : null;
}

export function privacyDenied(logText, volume) {
  if (!volume) return false;
  return logText
    .split('\n')
    .some((line) => /System Policy: .* deny\(\d+\) file-/.test(line) && line.includes(volume));
}

function recentKernelDenials() {
  const result = spawnSync(
    '/usr/bin/log',
    [
      'show',
      '--last',
      '2m',
      '--style',
      'compact',
      '--predicate',
      'eventMessage CONTAINS "System Policy"',
    ],
    { encoding: 'utf8', timeout: 30_000 },
  );
  return result.stdout ?? '';
}

export function preflightProblems(results) {
  return results
    .filter((result) => result.state !== 'ok')
    .map((result) => {
      if (result.state === 'missing')
        return `${result.path} points at a target that is not there; mount the drive behind it before building.`;
      if (result.privacyDenied)
        return `${result.path} is blocked by macOS privacy (TCC), not by the drive: the app this command runs under may not read ${result.volume}. Allow that app under System Settings > Privacy & Security (Files and Folders > Removable Volumes, or Full Disk Access) and restart it.`;
      return `${result.path} does not respond and no privacy denial was logged; the drive behind it may be hung. Check or replug it before building.`;
    });
}

export function annotatePrivacyDenials(results, logText) {
  return results.map((result) => {
    if (result.state !== 'hung') return result;
    let target = '';
    try {
      target = readlinkSync(result.path);
    } catch {}
    const volume = volumeOf(target);
    return { ...result, volume, privacyDenied: privacyDenied(logText, volume) };
  });
}

export async function assertCachesRespond() {
  let results = await probeCachePaths(linkedCachePaths());
  if (results.some((result) => result.state === 'hung'))
    results = annotatePrivacyDenials(results, recentKernelDenials());
  const problems = preflightProblems(results);
  if (problems.length === 0) return;
  for (const problem of problems) console.error(`✗ ${problem}`);
  process.exit(1);
}
