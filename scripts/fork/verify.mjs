import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');

const dependents = {
  core: ['server', 'app', 'cli', 'desktop'],
  server: ['app', 'cli', 'desktop'],
  app: ['cli', 'desktop'],
};
const typecheckPackages = new Set(['app', 'cli', 'core', 'desktop', 'server']);
const unitConfigs = { app: ['vitest.config.ts', 'vitest.dom.config.ts'] };
const lintable = /\.(?:[cm]?[jt]sx?|json|jsonc|css)$/;
const oxlintable = /\.(?:[cm]?[jt]sx?)$/;
const biomeScope = /^(?:packages\/|docs\/|[^/]+\.(?:json|jsonc|ts)$)/;

function packageOf(file) {
  const match = /^packages\/([^/]+)\//.exec(file);
  return match ? match[1] : null;
}

export function planVerify(files) {
  const changed = new Set();
  for (const file of files) {
    const name = packageOf(file);
    if (name !== null) changed.add(name);
  }
  const typecheck = new Set();
  for (const name of changed) {
    if (typecheckPackages.has(name)) typecheck.add(name);
    for (const dependent of dependents[name] ?? []) typecheck.add(dependent);
  }
  const tests = [];
  for (const name of changed) {
    if (!typecheckPackages.has(name)) continue;
    const sources = files
      .filter((file) => packageOf(file) === name && oxlintable.test(file))
      .map((file) => relative(`packages/${name}`, file));
    if (sources.length === 0) continue;
    for (const config of unitConfigs[name] ?? ['vitest.config.ts']) {
      tests.push({ name, config, sources });
    }
  }
  return {
    biome: files.filter((file) => lintable.test(file) && biomeScope.test(file)),
    oxlint: files.filter((file) => oxlintable.test(file)),
    typecheck: [...typecheck].sort(),
    tests,
    forkScripts: files.some((file) => file.startsWith('scripts/fork/')),
  };
}

function changedFiles(base) {
  const git = (...args) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
  const files = new Set([
    ...git('diff', '--name-only', '--diff-filter=d', `${base}...HEAD`),
    ...git('diff', '--name-only', '--diff-filter=d', 'HEAD'),
    ...git('ls-files', '--others', '--exclude-standard'),
  ]);
  return [...files].filter((file) => existsSync(resolve(root, file))).sort();
}

function step(label, command, args, cwd = root) {
  const started = Date.now();
  process.stdout.write(`\n▶ ${label}\n`);
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const ok = result.status === 0;
  process.stdout.write(`${ok ? '✓' : '✗'} ${label} (${seconds}s)\n`);
  return { label, ok, seconds };
}

function main() {
  const base =
    process.argv[2] ??
    execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], {
      cwd: root,
      encoding: 'utf8',
    }).trim();
  const files = changedFiles(base);
  if (files.length === 0) {
    console.log(`No changes against ${base}.`);
    return;
  }
  const plan = planVerify(files);
  console.log(`Verifying ${files.length} changed files against ${base.slice(0, 12)}.`);
  const results = [];
  if (plan.biome.length > 0)
    results.push(
      step('biome', 'pnpm', ['exec', 'biome', 'check', '--error-on-warnings', ...plan.biome]),
    );
  if (plan.oxlint.length > 0)
    results.push(step('oxlint', 'pnpm', ['exec', 'oxlint', '--max-warnings', '0', ...plan.oxlint]));
  for (const name of plan.typecheck)
    results.push(
      step(`typecheck ${name}`, 'pnpm', ['--dir', `packages/${name}`, 'run', 'typecheck']),
    );
  for (const { name, config, sources } of plan.tests)
    results.push(
      step(
        `tests ${name} ${config}`,
        'pnpm',
        ['exec', 'vitest', 'related', '--run', '--config', config, '--passWithNoTests', ...sources],
        resolve(root, `packages/${name}`),
      ),
    );
  if (plan.forkScripts)
    results.push(
      step('fork script tests', 'node', [
        '--test',
        'scripts/fork/channel.test.mjs',
        'scripts/fork/deploy-local.test.mjs',
        'scripts/fork/verify.test.mjs',
      ]),
    );
  console.log('\nSummary');
  for (const result of results)
    console.log(`  ${result.ok ? '✓' : '✗'} ${result.label} ${result.seconds}s`);
  console.log(
    '  integration, e2e and full check are not run; use pnpm run check before a release.',
  );
  if (results.some((result) => !result.ok)) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) main();
