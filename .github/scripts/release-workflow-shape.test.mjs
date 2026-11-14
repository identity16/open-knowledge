import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { parse } from 'yaml';

const workflow = parse(readFileSync(new URL('../workflows/release.yml', import.meta.url), 'utf8'));
const jobs = workflow.jobs;
const command = (job, suffix) =>
  job.steps.findIndex((step) => step.run?.includes(`release-workflow.mjs ${suffix}`));

describe('recoverable release workflow', () => {
  test('runs the macOS jobs on the self-hosted Mac mini only when a dispatch asks for it', () => {
    const runner = workflow.on.workflow_dispatch.inputs.runner;
    expect(runner.options).toEqual(['github', 'macmini']);
    expect(runner.default).toBe('macmini');
    for (const name of ['build', 'notarize', 'package']) {
      const runsOn = jobs[name]['runs-on'];
      expect(runsOn).toContain("inputs.runner == 'macmini'");
      expect(runsOn).toContain('"self-hosted","ok-macmini"');
      expect(runsOn).toContain("|| 'macos-26'");
    }
    expect(jobs.publish['runs-on']).toBe('ubuntu-latest');
  });

  test('keeps installs and turbo outputs on the Mac mini instead of round-tripping the GitHub cache', () => {
    for (const job of Object.values(jobs)) {
      const checkout = job.steps.findIndex((s) => s.uses?.startsWith('actions/checkout@'));
      expect(job.steps[checkout].with.clean).toBe(false);
      expect(job.steps[checkout + 1].run).toBe('git clean -ffdx -e node_modules -e .turbo');
    }
    const turbo = jobs.build.steps.find((s) => s.uses?.startsWith('actions/cache@'));
    expect(turbo.with.path).toBe('.turbo/cache');
    expect(turbo.if).toContain("inputs.runner != 'macmini'");
    const install = jobs.build.steps.find((s) => s.run?.startsWith('pnpm install'));
    expect(install.run).toContain('node scripts/create-turbo-cache-key.mjs');
  });

  test('no workflow that can reach the self-hosted runner is triggered by pull requests', () => {
    for (const file of readdirSync(new URL('../workflows/', import.meta.url))) {
      const text = readFileSync(new URL(`../workflows/${file}`, import.meta.url), 'utf8');
      if (!text.includes('self-hosted')) continue;
      const triggers = parse(text).on;
      expect(Object.keys(triggers).filter((name) => name.startsWith('pull_request'))).toEqual([]);
    }
  });

  test('keeps all release stages on main and exposes only the approved resume input', () => {
    expect(workflow.on.push).toBeUndefined();
    expect(Object.keys(workflow.on.workflow_dispatch.inputs)).toEqual([
      'version',
      'resume_run_id',
      'build_only',
      'runner',
    ]);
    expect(workflow.on.workflow_dispatch.inputs.build_only.default).toBe(false);
    for (const name of ['notarize', 'package', 'publish'])
      expect(jobs[name].if).toContain('!inputs.build_only');
    expect(workflow.on.workflow_dispatch.inputs.version.required).toBe(true);
    expect(workflow.on.workflow_dispatch.inputs.resume_run_id.required).toBe(false);
    expect(workflow.permissions.actions).toBe('read');
    expect(workflow.concurrency['cancel-in-progress']).toBe(false);
    for (const job of Object.values(jobs)) {
      expect(job.if).toContain("github.repository == 'identity16/open-knowledge'");
      expect(job.if).toContain("github.ref == 'refs/heads/main'");
      expect(
        job.steps.find((step) => step.uses?.startsWith('actions/checkout@')).with[
          'persist-credentials'
        ],
      ).toBe(false);
    }
  });

  test('restores before dependency installation and guards every build mutation', () => {
    expect(command(jobs.build, 'restore')).toBeLessThan(
      jobs.build.steps.findIndex((s) => s.run?.includes('pnpm install')),
    );
    const sign = jobs.build.steps[command(jobs.build, 'sign')];
    expect(Object.keys(sign.env).sort()).toEqual(['CSC_KEY_PASSWORD', 'CSC_LINK']);
    for (const step of jobs.build.steps.filter(
      (s) => s.run?.includes('pnpm') || s.uses?.startsWith('actions/upload-artifact@'),
    ))
      expect(step.if).toContain("steps.restore.outputs.reused != 'true'");
    expect(jobs.build.permissions).toBeUndefined();
  });

  test('persists the submission ID before Apple waiting without importing signing keys', () => {
    expect(jobs.notarize.needs).toBe('build');
    const upload = jobs.notarize.steps.findIndex((s) =>
      s.uses?.startsWith('actions/upload-artifact@'),
    );
    expect(upload).toBeGreaterThan(command(jobs.notarize, 'submit'));
    expect(upload).toBeLessThan(command(jobs.notarize, 'wait'));
    expect(JSON.stringify(jobs.notarize)).not.toContain('CSC_LINK');
    expect(JSON.stringify(jobs.notarize)).not.toContain('pnpm install');
    expect(jobs.notarize.if).toContain("needs.build.outputs.ready_run_id == ''");
  });

  test('separates package verification from publication and scopes retained files', () => {
    expect(jobs.package.needs).toEqual(['build', 'notarize']);
    expect(jobs.publish.needs).toEqual(['build', 'package']);
    expect(jobs.publish.environment).toBeUndefined();
    expect(JSON.stringify(jobs.publish)).not.toContain('secrets.');
    expect(JSON.stringify(jobs.publish)).not.toContain('pnpm install');
    expect(command(jobs.publish, 'promote')).toBeGreaterThan(-1);
    const uploads = Object.values(jobs)
      .flatMap((j) => j.steps)
      .filter((s) => s.uses?.startsWith('actions/upload-artifact@'));
    expect(uploads.map((s) => s.with.path)).toEqual([
      '.release/signed/',
      '.release/notary/notary.json',
      '.release/ready/ready.json',
    ]);
    for (const upload of uploads) {
      expect(upload.with['retention-days']).toBe(3);
      expect(upload.with['if-no-files-found']).toBe('error');
    }
    expect(uploads[0].with['compression-level']).toBe(0);
  });
});
