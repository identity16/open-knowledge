import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { parse } from 'yaml';

const workflow = parse(readFileSync(new URL('../workflows/release.yml', import.meta.url), 'utf8'));
const jobs = workflow.jobs;
const job = jobs.release;
const steps = job.steps;
const command = (suffix) =>
  steps.findIndex((step) => step.run?.includes(`release-workflow.mjs ${suffix}`));
const stepOf = (suffix) => steps[command(suffix)];
const uploadOf = (path) =>
  steps.findIndex((s) => s.uses?.startsWith('actions/upload-artifact@') && s.with.path === path);

describe('recoverable release workflow', () => {
  test('runs the whole release as one job on the self-hosted Mac mini unless a dispatch asks for GitHub', () => {
    expect(Object.keys(jobs)).toEqual(['release']);
    const runner = workflow.on.workflow_dispatch.inputs.runner;
    expect(runner.options).toEqual(['github', 'macmini']);
    expect(runner.default).toBe('macmini');
    expect(job['runs-on']).toContain("inputs.runner == 'macmini'");
    expect(job['runs-on']).toContain('"self-hosted","ok-macmini"');
    expect(job['runs-on']).toContain("|| 'macos-26'");
  });

  test('keeps installs and turbo outputs on the Mac mini instead of round-tripping the GitHub cache', () => {
    const checkout = steps.findIndex((s) => s.uses?.startsWith('actions/checkout@'));
    expect(steps[checkout].with.clean).toBe(false);
    expect(steps[checkout + 1].run).toBe('git clean -ffdx -e node_modules -e .turbo');
    const turbo = steps.find((s) => s.uses?.startsWith('actions/cache@'));
    expect(turbo.with.path).toBe('.turbo/cache');
    expect(turbo.if).toContain("inputs.runner != 'macmini'");
    const install = steps.find((s) => s.run?.startsWith('pnpm install'));
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

  test('keeps the release on main and exposes only the approved resume input', () => {
    expect(workflow.on.push).toBeUndefined();
    expect(Object.keys(workflow.on.workflow_dispatch.inputs)).toEqual([
      'version',
      'resume_run_id',
      'build_only',
      'runner',
    ]);
    expect(workflow.on.workflow_dispatch.inputs.build_only.default).toBe(false);
    for (const suffix of [
      'notarize-start',
      'notarize-submitted',
      'notarize-accepted',
      'prepare-package',
      'package',
      'promote',
    ])
      expect(stepOf(suffix).if).toContain('!inputs.build_only');
    expect(workflow.on.workflow_dispatch.inputs.version.required).toBe(true);
    expect(workflow.on.workflow_dispatch.inputs.resume_run_id.required).toBe(false);
    expect(workflow.permissions).toEqual({ contents: 'read', actions: 'read' });
    expect(job.permissions).toEqual({ contents: 'write', actions: 'read' });
    expect(workflow.concurrency['cancel-in-progress']).toBe(false);
    expect(job.if).toContain("github.repository == 'identity16/open-knowledge'");
    expect(job.if).toContain("github.ref == 'refs/heads/main'");
    expect(
      steps.find((s) => s.uses?.startsWith('actions/checkout@')).with['persist-credentials'],
    ).toBe(false);
  });

  test('hands the GitHub token only to the steps that call gh, never to dependency installs', () => {
    expect(JSON.stringify(workflow.env)).not.toContain('token');
    expect(JSON.stringify(job.env ?? {})).not.toContain('token');
    const holders = steps.filter((s) => s.env?.GH_TOKEN).map((s) => s.run);
    expect(holders).toEqual(
      ['restore', 'notarize-start', 'prepare-package', 'package', 'promote'].map(
        (suffix) => stepOf(suffix).run,
      ),
    );
    for (const step of steps.filter((s) => s.run?.includes('install')))
      expect(step.env?.GH_TOKEN, step.name).toBeUndefined();
  });

  test('restores before dependency installation and guards every build mutation', () => {
    expect(command('restore')).toBeLessThan(
      steps.findIndex((s) => s.run?.includes('pnpm install')),
    );
    expect(Object.keys(stepOf('sign').env).sort()).toEqual(['CSC_KEY_PASSWORD', 'CSC_LINK']);
    for (const step of steps
      .slice(0, command('sign') + 2)
      .filter((s) => s.run?.includes('pnpm') || s.uses?.startsWith('actions/upload-artifact@')))
      expect(step.if).toContain("steps.restore.outputs.reused != 'true'");
  });

  test('preserves each checkpoint before the stage that could lose it', () => {
    expect(uploadOf('.release/signed/')).toBeGreaterThan(command('sign'));
    expect(uploadOf('.release/signed/')).toBeLessThan(command('notarize-submitted'));
    expect(uploadOf('.release/notary/notary.json')).toBeGreaterThan(command('notarize-submitted'));
    expect(uploadOf('.release/notary/notary.json')).toBeLessThan(command('notarize-accepted'));
    expect(stepOf('notarize-submitted').id).toBe('submit');
    expect(uploadOf('.release/ready/ready.json')).toBeGreaterThan(command('package'));
    expect(uploadOf('.release/ready/ready.json')).toBeLessThan(command('promote'));
    for (const suffix of ['notarize-start', 'notarize-submitted', 'notarize-accepted'])
      expect(stepOf(suffix).if).toContain("steps.restore.outputs.ready_run_id == ''");
  });

  test('gives each stage only the secrets it uses', () => {
    const secrets = (suffix) =>
      Object.entries(stepOf(suffix).env ?? {})
        .filter(([, value]) => String(value).includes('secrets.'))
        .map(([name]) => name)
        .sort();
    expect(secrets('notarize-start')).toEqual([
      'APPLE_API_ISSUER',
      'APPLE_API_KEY',
      'APPLE_API_KEY_ID',
    ]);
    expect(secrets('notarize-submitted')).toEqual([]);
    expect(secrets('notarize-accepted')).toEqual([]);
    expect(secrets('package')).toEqual(['CSC_KEY_PASSWORD', 'CSC_LINK']);
    expect(secrets('prepare-package')).toEqual([]);
    expect(secrets('promote')).toEqual([]);
    for (const step of steps.filter((s) => s.run?.includes('install')))
      expect(JSON.stringify(step.env ?? {}), step.name).not.toContain('secrets.');
  });

  test('runs no dependency code while the Apple key is held by the background notarization', () => {
    const during = steps.slice(command('notarize-start') + 1, command('notarize-accepted') + 1);
    for (const step of during)
      expect(
        step.uses?.startsWith('actions/upload-artifact@') ||
          (step.run ?? '').startsWith('node scripts/release/release-workflow.mjs notarize-'),
        step.name,
      ).toBe(true);
    expect(command('notarize-start')).toBeGreaterThan(command('sign'));
    expect(command('notarize-start')).toBeGreaterThan(
      steps.findIndex((s) => s.name === 'Test product boundaries'),
    );
  });

  test('publishes the verified draft from this run or the one that staged it', () => {
    expect(stepOf('promote').env.READY_RUN_ID).toBe(
      '${{ steps.prepare.outputs.ready_run_id || steps.package.outputs.ready_run_id }}',
    );
    for (const suffix of ['notarize-start', 'prepare-package', 'package', 'promote'])
      expect(stepOf(suffix).env.CANDIDATE_RUN_ID).toBe(
        '${{ steps.restore.outputs.candidate_run_id }}',
      );
    const uploads = steps.filter((s) => s.uses?.startsWith('actions/upload-artifact@'));
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
