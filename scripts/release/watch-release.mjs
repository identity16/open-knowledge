import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { repository } from './channel.mjs';

const noise =
  /ELECTRON_SKIP|PUPPETEER_SKIP|TURBO_TELEMETRY|GH_TOKEN|RELEASE_VERSION|CSC_|APPLE_API/;
const cause = /##\[error\]|⨯|notarytool \(exit|Error: |not acquired by Runner/;

export function jobLines(jobs) {
  return jobs.map((job) => {
    const seconds =
      job.started_at && job.completed_at
        ? `${Math.round((Date.parse(job.completed_at) - Date.parse(job.started_at)) / 1000)}s`
        : '-';
    return `${job.name.padEnd(10)} ${(job.conclusion ?? job.status).padEnd(10)} ${seconds.padStart(6)}  ${job.runner_name || '-'}`;
  });
}

export function failureCauses(log) {
  const seen = new Set();
  const causes = [];
  for (const line of log.split('\n')) {
    if (noise.test(line) || !cause.test(line)) continue;
    const message = line.replace(/^.*?\d{4}-\d{2}-\d{2}T[\d:.]+Z\s*/, '').trim();
    if (message === '' || seen.has(message)) continue;
    seen.add(message);
    causes.push(message);
  }
  return causes.slice(0, 12);
}

export function runnerUnavailable(viewText) {
  return /not acquired by Runner/.test(viewText);
}

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

async function main() {
  const [runId, flag] = process.argv.slice(2);
  if (!runId) {
    console.error('Usage: node scripts/release/watch-release.mjs <run id> [--wait]');
    process.exitCode = 2;
    return;
  }
  const run = () =>
    JSON.parse(
      gh(['run', 'view', runId, '-R', repository, '--json', 'status,conclusion,name,url']),
    );
  let state = run();
  while (flag === '--wait' && state.status !== 'completed') {
    await delay(20_000);
    state = run();
  }
  const jobs = JSON.parse(gh(['api', `repos/${repository}/actions/runs/${runId}/jobs`])).jobs;
  console.log(`${state.name}: ${state.status === 'completed' ? state.conclusion : state.status}`);
  console.log(state.url);
  for (const line of jobLines(jobs)) console.log(`  ${line}`);
  if (state.conclusion === 'success' || state.status !== 'completed') return;
  if (runnerUnavailable(gh(['run', 'view', runId, '-R', repository])))
    console.log(
      '  cause: no runner was assigned (hosted capacity or the self-hosted runner is offline)',
    );
  let log = '';
  try {
    log = gh(['run', 'view', runId, '-R', repository, '--log-failed']);
  } catch {}
  for (const message of failureCauses(log)) console.log(`  cause: ${message}`);
  process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) await main();
