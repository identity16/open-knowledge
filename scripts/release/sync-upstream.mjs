import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = 'identity16/open-knowledge';
const upstream = 'inkeep/open-knowledge';
const head = 'inkeep:main';
const title = 'chore: sync inkeep/open-knowledge main';

function github(method, endpoint, data) {
  const args = ['api', '--method', method, endpoint];
  if (data) args.push('--input', '-');
  return JSON.parse(
    execFileSync('gh', args, { encoding: 'utf8', input: data ? JSON.stringify(data) : undefined }),
  );
}

export function pullRequestBody(comparison, upstreamSha) {
  return `## Summary

\`inkeep/open-knowledge:main → ${repository}:main\`

Brings upstream's new commits into this repository. The PR follows upstream main as it moves.

## Evidence

- **Before:** at the last check, ${comparison.ahead_by} upstream commits were not in main.
- **After:** merges [upstream ${upstreamSha.slice(0, 12)}](https://github.com/${upstream}/commit/${upstreamSha}).
- [Full comparison](https://github.com/${repository}/compare/main...inkeep:main)
- This automation does not build, typecheck or test the result; check GitHub's mergeability status for conflicts.

## Merge Danger

**Door:** two-way. This script only manages the PR; it never changes main or publishes a release.

**Blast Radius:** the whole product

Review upstream's changes against this product's UI, release channel, install and recovery behaviour before merging.
Use **Create a merge commit** to keep upstream history; a squash or rebase merge makes the same upstream commits reappear next time.
Conflicts are not resolved automatically. Upstream's head is read-only, so resolve them on a branch of this repository and open a replacement PR.
`;
}

export function syncUpstream({ api = github, report = console.log } = {}) {
  const upstreamCommit = api('GET', `repos/${upstream}/commits/main`);
  const comparison = api('GET', `repos/${repository}/compare/main...${upstreamCommit.sha}`);
  if (comparison.ahead_by === 0) {
    report('Every upstream main commit is already in main; no PR needed.');
    return { action: 'unchanged' };
  }
  if (!Number.isSafeInteger(comparison.ahead_by) || comparison.ahead_by < 0)
    throw new Error('Invalid upstream comparison.');
  const pulls = api(
    'GET',
    `repos/${repository}/pulls?state=all&head=${encodeURIComponent(head)}&base=main&sort=created&direction=desc&per_page=100`,
  );
  const open = pulls.find((pr) => pr.state === 'open');
  const rejected = pulls.find(
    (pr) => pr.state === 'closed' && !pr.merged_at && pr.head.sha === upstreamCommit.sha,
  );
  if (!open && rejected) {
    report(
      `A PR for this upstream commit was already closed: ${rejected.html_url}. Not reopening it.`,
    );
    return { action: 'dismissed', url: rejected.html_url };
  }
  const data = { title, body: pullRequestBody(comparison, upstreamCommit.sha) };
  const pr = open
    ? api('PATCH', `repos/${repository}/pulls/${open.number}`, data)
    : api('POST', `repos/${repository}/pulls`, {
        ...data,
        head,
        base: 'main',
        maintainer_can_modify: false,
      });
  report(
    `${open ? 'Updated PR' : 'Opened PR'}: ${pr.html_url}\n${comparison.ahead_by} upstream commits. Nothing is merged or released automatically.`,
  );
  return { action: open ? 'updated' : 'created', url: pr.html_url };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const summary = process.argv[2];
  try {
    syncUpstream({
      report: (message) => {
        console.log(message);
        if (summary) appendFileSync(summary, `${message}\n`);
      },
    });
  } catch (error) {
    console.error(error.message);
    if (summary)
      appendFileSync(
        summary,
        `Managing the sync PR failed. main and local installs are unchanged.\n`,
      );
    process.exitCode = 1;
  }
}
