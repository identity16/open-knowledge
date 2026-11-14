import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

const tiers = [
  { suffix: /\.uncached\.test\.[cm]?[jt]sx?$/, config: 'vitest.uncached.config.ts', atRoot: true },
  {
    suffix: /\.browser\.test\.[cm]?[jt]sx?$/,
    config: 'vitest.browser.config.ts',
    env: { VITEST_CHROMIUM_GC_DISK_THRESHOLD_GB: '100000', VITEST_CHROMIUM_GC_FORCE: '1' },
  },
  { suffix: /\.dom\.test\.[cm]?[jt]sx?$/, config: 'vitest.dom.config.ts' },
  { suffix: /\.node\.test\.[cm]?[jt]sx?$/, config: 'vitest.node.config.ts' },
  { suffix: /\.test\.[cm]?[jt]sx?$/, config: 'vitest.config.ts' },
];

function readSource(path) {
  try {
    return readFileSync(resolve(root, path), 'utf8');
  } catch {
    return '';
  }
}

export function usesNodeTestRunner(source) {
  return /from ['"]node:test['"]/.test(source);
}

export function planTestRun(file) {
  const path = relative(root, resolve(file));
  const tier = tiers.find((candidate) => candidate.suffix.test(path));
  if (!tier) return { error: `${path} is not a test file (no .test. segment).` };
  if (!path.startsWith('packages/') && usesNodeTestRunner(readSource(path)))
    return { cwd: root, command: 'node', args: ['--test', path], env: {} };
  if (tier.atRoot)
    return {
      cwd: root,
      command: 'pnpm',
      args: ['exec', 'vitest', 'run', '--config', tier.config, path],
      env: {},
    };
  const match = /^packages\/([^/]+)\/(.+)$/.exec(path);
  if (!match)
    return {
      cwd: root,
      command: 'pnpm',
      args: ['exec', 'vitest', 'run', '--config', 'vitest.scripts.config.ts', path],
      env: {},
    };
  const [, name, inner] = match;
  const config = tier.config;
  if (!existsSync(resolve(root, 'packages', name, config)))
    return { error: `packages/${name} has no ${config} for ${path}.` };
  return {
    cwd: resolve(root, 'packages', name),
    command: 'pnpm',
    args: ['exec', 'vitest', 'run', '--config', config, inner],
    env: tier.env ?? {},
  };
}

function main() {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error('Usage: pnpm test:file <test file>...');
    process.exitCode = 2;
    return;
  }
  for (const file of files) {
    const plan = planTestRun(file);
    if (plan.error) {
      console.error(`✗ ${plan.error}`);
      process.exitCode = 1;
      continue;
    }
    console.log(`▶ ${plan.command} ${plan.args.join(' ')} (in ${relative(root, plan.cwd) || '.'})`);
    const result = spawnSync(plan.command, plan.args, {
      cwd: plan.cwd,
      stdio: 'inherit',
      env: { ...process.env, ...plan.env },
    });
    if (result.status !== 0) process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) main();
