import { spawn } from 'node:child_process';
import { lstatSync } from 'node:fs';
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

export function probeCachePaths(
  paths,
  { timeoutMs = 5_000, command = ['/bin/test', '-d'] } = {},
) {
  return Promise.all(paths.map((path) => probe(path, { timeoutMs, command })));
}

export function preflightProblems(results) {
  return results
    .filter((result) => result.state !== 'ok')
    .map((result) =>
      result.state === 'hung'
        ? `${result.path} does not respond; the drive behind it is hung. Check or replug it before building.`
        : `${result.path} points at a target that is not there; mount the drive behind it before building.`,
    );
}

export async function assertCachesRespond() {
  const problems = preflightProblems(await probeCachePaths(linkedCachePaths()));
  if (problems.length === 0) return;
  for (const problem of problems) console.error(`✗ ${problem}`);
  process.exit(1);
}
