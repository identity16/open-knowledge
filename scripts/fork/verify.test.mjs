import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planVerify } from './verify.mjs';

test('an app-only change lints, typechecks app and its consumers, and runs related app tests', () => {
  const plan = planVerify(['packages/app/src/App.tsx', 'packages/app/src/globals.css']);
  assert.deepEqual(plan.biome, ['packages/app/src/App.tsx', 'packages/app/src/globals.css']);
  assert.deepEqual(plan.oxlint, ['packages/app/src/App.tsx']);
  assert.deepEqual(plan.typecheck, ['app', 'cli', 'desktop']);
  assert.deepEqual(
    plan.tests.map((entry) => entry.config),
    ['vitest.config.ts', 'vitest.dom.config.ts'],
  );
  assert.deepEqual(plan.tests[0].sources, ['src/App.tsx']);
  assert.equal(plan.forkScripts, false);
});

test('a core change typechecks every consumer', () => {
  const plan = planVerify(['packages/core/src/index.ts']);
  assert.deepEqual(plan.typecheck, ['app', 'cli', 'core', 'desktop', 'server']);
  assert.deepEqual(plan.tests, [
    { name: 'core', config: 'vitest.config.ts', sources: ['src/index.ts'] },
  ]);
});

test('fork tooling changes run the fork script tests and skip biome', () => {
  const plan = planVerify([
    'scripts/fork/channel.mjs',
    '.changeset/x.md',
    '.turbo-cache/meta.json',
  ]);
  assert.deepEqual(plan.biome, []);
  assert.deepEqual(plan.oxlint, ['scripts/fork/channel.mjs']);
  assert.deepEqual(plan.typecheck, []);
  assert.equal(plan.forkScripts, true);
});

test('root config files stay in biome scope', () => {
  assert.deepEqual(planVerify(['package.json', 'biome.json']).biome, [
    'package.json',
    'biome.json',
  ]);
});
