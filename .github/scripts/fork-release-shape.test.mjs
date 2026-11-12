import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { parse } from 'yaml';

const workflow = parse(
  readFileSync(new URL('../workflows/identity16-web-release.yml', import.meta.url), 'utf8'),
);

describe('fork release workflow', () => {
  test('keeps signing and publication on the main branch of the fork', () => {
    expect(workflow.on.push).toBeUndefined();
    expect(workflow.on.workflow_dispatch.inputs.version.required).toBe(true);
    expect(workflow.jobs.build.if).toBe(
      "github.repository == 'identity16/open-knowledge' && github.ref == 'refs/heads/main'",
    );
    expect(workflow.jobs.build.environment).toBe('release-signing');
    expect(workflow.concurrency['cancel-in-progress']).toBe(false);
  });

  test('builds the shared web archive and verifies desktop installers before publication', () => {
    const steps = workflow.jobs.build.steps;
    const web = steps.findIndex((step) =>
      step.run?.includes('node scripts/fork/build-release.mjs'),
    );
    const desktop = steps.findIndex((step) =>
      step.run?.includes('node scripts/fork/build-desktop.mjs'),
    );
    const publish = steps.findIndex((step) =>
      step.run?.includes('node scripts/fork/publish-release.mjs'),
    );
    expect(web).toBeGreaterThan(-1);
    expect(desktop).toBeGreaterThan(web);
    expect(publish).toBeGreaterThan(desktop);
    expect(
      steps.find((step) => step.uses?.startsWith('actions/checkout@')).with['persist-credentials'],
    ).toBe(false);
  });
});
