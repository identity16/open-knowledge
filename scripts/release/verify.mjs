import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { assertCachesRespond } from './cache-preflight.mjs';
import { createVerificationReceipt, finishVerificationReceipt } from './verification.mjs';

const root = resolve(import.meta.dirname, '../..');

const dependents = {
  core: ['server', 'app', 'cli', 'desktop'],
  server: ['app', 'cli', 'desktop'],
  app: ['cli', 'desktop'],
};
const typecheckPackages = new Set(['app', 'cli', 'core', 'desktop', 'notion-oauth-worker', 'server']);
const unitConfigs = { app: ['vitest.unit.config.ts', 'vitest.dom.config.ts'] };
const lintable = /\.(?:[cm]?[jt]sx?|json|jsonc|css)$/;
const oxlintable = /\.(?:[cm]?[jt]sx?)$/;
const biomeScope = /^(?:packages\/|docs\/|[^/]+\.(?:json|jsonc|ts)$)/;
const appRenderSource = /^packages\/app\/src\/.+\.tsx?$/;

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
    reactCompiler: files
      .filter((file) => appRenderSource.test(file))
      .map((file) => relative('packages/app', file)),
    releaseScripts: files.some((file) => file.startsWith('scripts/release/')),
    scriptSources: files.filter((file) =>
      /^(?:scripts|\.github\/scripts)\/.+\.[cm]?[jt]sx?$/.test(file),
    ),
    workflowTests: files.some((file) => /^\.github\/workflows\/.+\.ya?ml$/.test(file)),
  };
}

function changedFiles(base) {
  const git = (...args) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
  const files = new Set([
    ...git('diff', '--name-only', '-z', '--no-renames', `${base}...HEAD`),
    ...git('diff', '--name-only', '-z', '--no-renames', 'HEAD'),
    ...git('ls-files', '-z', '--others', '--exclude-standard'),
  ]);
  return [...files].sort();
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

export function verificationCommands(plan) {
  const commands = [];
  const add = (label, command, args, cwd = root) => commands.push({ label, command, args, cwd });
  if (plan.biome.length > 0)
    add('biome', 'pnpm', ['exec', 'biome', 'check', '--error-on-warnings', ...plan.biome]);
  if (plan.oxlint.length > 0)
    add('oxlint', 'pnpm', ['exec', 'oxlint', '--max-warnings', '0', ...plan.oxlint]);
  if (plan.typecheck.includes('desktop')) {
    add('build cli types for desktop', 'pnpm', ['--dir', 'packages/cli', 'run', 'build:cli']);
    add('build cli skill assets for desktop', 'pnpm', [
      '--dir',
      'packages/cli',
      'run',
      'build:skill-asset',
    ]);
  }
  for (const name of plan.typecheck)
    add(`typecheck ${name}`, 'pnpm', ['--dir', `packages/${name}`, 'run', 'typecheck']);
  if (plan.reactCompiler.length > 0)
    add(
      'react compiler app',
      'node',
      ['scripts/check-react-compiler.ts', ...plan.reactCompiler],
      resolve(root, 'packages/app'),
    );
  for (const { name, config, sources } of plan.tests)
    add(
      `tests ${name} ${config}`,
      'pnpm',
      ['exec', 'vitest', 'related', '--run', '--config', config, '--passWithNoTests', ...sources],
      resolve(root, `packages/${name}`),
    );
  if (plan.scriptSources.length > 0)
    add('related tooling tests', 'pnpm', [
      'exec',
      'vitest',
      'related',
      '--run',
      '--config',
      'vitest.scripts.config.ts',
      '--passWithNoTests',
      ...plan.scriptSources,
    ]);
  if (plan.workflowTests)
    add('workflow contracts', 'pnpm', [
      'exec',
      'vitest',
      'run',
      '--config',
      'vitest.scripts.config.ts',
      '.github/scripts/',
    ]);
  if (plan.releaseScripts)
    add('release script tests', 'node', [
      '--test',
      'scripts/release/cache-preflight.test.mjs',
      'scripts/release/channel.test.mjs',
      'scripts/release/deploy-local.test.mjs',
      'scripts/release/verify.test.mjs',
      'scripts/release/preview.test.mjs',
    ]);
  return commands;
}

async function main() {
  await assertCachesRespond();
  const [requestedBase, receiptPath] = process.argv.slice(2);
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const base = git(
    'rev-parse',
    '--verify',
    `${requestedBase ?? git('merge-base', 'HEAD', 'origin/main')}^{commit}`,
  );
  const files = changedFiles(base);
  const plan = planVerify(files);
  plan.biome = plan.biome.filter((file) => existsSync(resolve(root, file)));
  plan.oxlint = plan.oxlint.filter((file) => existsSync(resolve(root, file)));
  plan.reactCompiler = plan.reactCompiler.filter((file) =>
    existsSync(resolve(root, 'packages/app', file)),
  );
  const commands = verificationCommands(plan);
  const sourceCleanAtStart = git('status', '--porcelain') === '';
  let receipt = createVerificationReceipt(
    base,
    git('rev-parse', 'HEAD'),
    files,
    commands.map((entry) => entry.label),
  );
  const save = () => {
    if (!receiptPath) return;
    mkdirSync(dirname(resolve(receiptPath)), { recursive: true });
    writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  };
  save();
  console.log(`Verifying ${files.length} changed files against ${base.slice(0, 12)}.`);
  for (const command of commands) {
    receipt.steps.push(step(command.label, command.command, command.args, command.cwd));
    save();
  }
  receipt = finishVerificationReceipt(receipt, receipt.steps);
  receipt.sourceClean = sourceCleanAtStart && git('status', '--porcelain') === '';
  const env = process.env;
  if (receiptPath && env.GITHUB_ACTIONS === 'true' && !receipt.sourceClean) {
    receipt.status = 'failed';
    receipt.failure = 'The source tree differs from the recorded commit.';
    console.error(receipt.failure);
  }
  save();
  console.log('\nSummary');
  for (const result of receipt.steps)
    console.log(`  ${result.ok ? '✓' : '✗'} ${result.label} ${result.seconds}s`);
  console.log(
    '  integration, e2e and full check are not run; use pnpm run check before a release.',
  );
  if (receipt.status !== 'passed') process.exitCode = 1;
}

if (import.meta.main) main();
