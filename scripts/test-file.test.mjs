import { expect, test } from 'vitest';
import { planTestRun, usesNodeTestRunner } from './test-file.mjs';

test('each test tier gets its own vitest config inside its package', () => {
  const dom = planTestRun('packages/app/src/components/FileTree.dom.test.tsx');
  expect(dom.args).toEqual([
    'exec',
    'vitest',
    'run',
    '--config',
    'vitest.dom.config.ts',
    'src/components/FileTree.dom.test.tsx',
  ]);
  expect(dom.cwd).toMatch(/packages\/app$/);
  const browser = planTestRun('packages/app/src/components/file-tree-reorder-drop.browser.test.ts');
  expect(browser.args[4]).toBe('vitest.browser.config.ts');
  expect(browser.env.VITEST_CHROMIUM_GC_FORCE).toBe('1');
  expect(planTestRun('packages/app/src/lib/file-tree-sort.test.ts').args[4]).toBe(
    'vitest.config.ts',
  );
  expect(planTestRun('packages/core/src/config/schema.test.ts').args[4]).toBe('vitest.config.ts');
});

test('repo scripts run under node:test or the scripts vitest config, and odd paths are refused', () => {
  expect(planTestRun('scripts/release/channel.test.mjs').args).toEqual([
    '--test',
    'scripts/release/channel.test.mjs',
  ]);
  expect(planTestRun('scripts/release/notarize-release.test.mjs').args[4]).toBe(
    'vitest.scripts.config.ts',
  );
  expect(planTestRun('packages/server/src/x.dom.test.ts').error).toBe(
    'packages/server has no vitest.dom.config.ts for packages/server/src/x.dom.test.ts.',
  );
  expect(planTestRun('packages/app/src/App.tsx').error).toMatch(/not a test file/);
  expect(usesNodeTestRunner("import { test } from 'node:test';")).toBe(true);
});
