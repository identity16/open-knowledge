import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { buildReleaseAsset } from './build-release.mjs';
import { service } from './channel.mjs';

const root = resolve(import.meta.dirname, '../..');
const serviceUrl = 'http://127.0.0.1:8080/';

export function localBuildIdentity({ sha, dirty, now }) {
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, '');
  const suffix = dirty ? `${sha}.dirty.${stamp}` : sha;
  return { version: `0.0.0-local.${suffix}`, label: `local-${suffix}` };
}

async function waitForService(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(serviceUrl, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return true;
    } catch {}
    await new Promise((settle) => setTimeout(settle, 1_000));
  }
  return false;
}

async function main() {
  const started = Date.now();
  const rustupProxies = join(homedir(), '.cargo/bin');
  if (existsSync(rustupProxies))
    process.env.PATH = `${rustupProxies}${delimiter}${process.env.PATH}`;
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const identity = localBuildIdentity({
    sha: git('rev-parse', '--short', 'HEAD'),
    dirty: git('status', '--porcelain', '--untracked-files=no') !== '',
    now: new Date(),
  });
  const asset = buildReleaseAsset({
    version: identity.version,
    output: resolve(root, '.release/local'),
  });
  execFileSync(
    process.execPath,
    [resolve(import.meta.dirname, 'channel.mjs'), 'install-local', asset, identity.label],
    { stdio: 'inherit' },
  );
  const restart = spawnSync(
    'launchctl',
    ['kickstart', '-k', `gui/${process.getuid()}/${service}`],
    { stdio: 'inherit' },
  );
  if (restart.status !== 0) throw new Error(`Could not restart ${service} with launchctl.`);
  const up = await waitForService(90_000);
  const seconds = Math.round((Date.now() - started) / 1000);
  if (!up) throw new Error(`${identity.label} is installed but ${serviceUrl} did not answer.`);
  console.log(`Deployed ${identity.label} to ${serviceUrl} in ${seconds}s.`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
