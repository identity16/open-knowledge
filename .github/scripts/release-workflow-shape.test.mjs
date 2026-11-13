import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { parse } from 'yaml';

const workflow = parse(
  readFileSync(new URL('../workflows/release.yml', import.meta.url), 'utf8'),
);
const jobs = workflow.jobs;
const command = (job, suffix) =>
  job.steps.findIndex((step) => step.run?.includes(`release-workflow.mjs ${suffix}`));

describe('recoverable release workflow', () => {
  test('keeps all release stages on main and exposes only the approved resume input', () => {
    expect(workflow.on.push).toBeUndefined();
    expect(Object.keys(workflow.on.workflow_dispatch.inputs)).toEqual([
      'version',
      'resume_run_id',
      'build_only',
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
