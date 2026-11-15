import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { parse } from 'yaml';

const verification = parse(
  readFileSync(new URL('../workflows/verify.yml', import.meta.url), 'utf8'),
);
const review = parse(
  readFileSync(new URL('../workflows/test-changes.yml', import.meta.url), 'utf8'),
);
const steps = verification.jobs.changed.steps;

test('keeps untrusted PR inventory off the self-hosted runner with read-only permissions', () => {
  expect(review.on.pull_request.branches).toEqual(['main']);
  expect(review.jobs.inventory['runs-on']).toBe('ubuntu-latest');
  expect(review.permissions).toEqual({ contents: 'read' });
  expect(
    review.jobs.inventory.steps.find((step) => step.run?.includes('pnpm --filter')).run,
  ).toContain('--ignore-scripts');
});

test('resolves the baseline from successful history instead of the previous push', () => {
  const baseline = steps.findIndex((step) => step.id === 'baseline');
  const verify = steps.findIndex((step) => step.run?.includes('pnpm verify:changed'));
  expect(baseline).toBeGreaterThan(-1);
  expect(baseline).toBeLessThan(verify);
  expect(steps[baseline].run).toContain('verification.mjs base');
  expect(JSON.stringify(verification)).not.toContain('github.event.before');
  expect(verification.permissions).toEqual({ contents: 'read', actions: 'read' });
  expect(steps.filter((step) => step.env?.GH_TOKEN)).toEqual([steps[baseline]]);
});

test('preserves an attempt-specific receipt on failure or cancellation as well as success', () => {
  const verify = steps.findIndex((step) => step.run?.includes('pnpm verify:changed'));
  const upload = steps.findIndex((step) => step.uses?.startsWith('actions/upload-artifact@'));
  expect(steps[verify].run).toContain('$VERIFICATION_BASE_SHA');
  expect(steps[verify].run).toContain('$RUNNER_TEMP/verification/receipt.json');
  expect(upload).toBeGreaterThan(verify);
  expect(steps[upload].if).toContain('always()');
  expect(steps[upload].with.name).toContain('github.run_attempt');
  expect(steps[upload].with['if-no-files-found']).toBe('error');
});
