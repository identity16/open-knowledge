import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+-identity16\.\d+$/.test(version ?? '')) {
  throw new Error('Usage: node scripts/fork/build-release.mjs X.Y.Z-identity16.N');
}
if (process.platform !== 'darwin' || process.arch !== 'arm64') {
  throw new Error('This release channel currently supports macOS Apple Silicon only.');
}
const root = resolve(import.meta.dirname, '../..');
const output = resolve(process.argv[3] ?? `${root}/.fork-release`);
mkdirSync(output, { recursive: true });
const manifest = resolve(root, 'packages/cli/package.json');
const original = readFileSync(manifest, 'utf8');
try {
  writeFileSync(manifest, `${JSON.stringify({ ...JSON.parse(original), version }, null, 2)}\n`);
  execFileSync('pnpm', ['exec', 'turbo', 'run', 'build', '--filter=@inkeep/open-knowledge'], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, TURBO_CACHE_DIR: `${root}/.turbo/cache`, TURBO_TELEMETRY_DISABLED: '1' },
  });
  copyFileSync(
    resolve(root, 'scripts/fork/channel.mjs'),
    resolve(root, 'packages/cli/dist/identity16-channel.mjs'),
  );
  execFileSync('npm', ['pack', '--ignore-scripts', '--pack-destination', output], {
    cwd: resolve(root, 'packages/cli'),
    stdio: 'inherit',
  });
  const packed = readdirSync(output).find(
    (name) => name === `inkeep-open-knowledge-${version}.tgz`,
  );
  if (!packed) throw new Error('npm did not produce the expected release package.');
  const asset = 'openknowledge-darwin-arm64.tgz';
  renameSync(resolve(output, packed), resolve(output, asset));
  const digest = createHash('sha256')
    .update(readFileSync(resolve(output, asset)))
    .digest('hex');
  writeFileSync(resolve(output, 'checksums.txt'), `${digest}  ${asset}\n`);
} finally {
  writeFileSync(manifest, original);
}
