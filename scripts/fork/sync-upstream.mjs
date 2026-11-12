import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const fork = 'identity16/open-knowledge';
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

\`inkeep/open-knowledge:main → identity16/open-knowledge:main\`

원본의 새 commit을 fork에 반영하는 PR입니다. 원본 main이 움직이면 이 PR의 내용도 갱신됩니다.

## Evidence

- **Before:** 마지막 확인 시점에 upstream commit ${comparison.ahead_by}개가 fork main에 포함되지 않았습니다.
- **After:** 병합 대상으로 [upstream ${upstreamSha.slice(0, 12)}](https://github.com/${upstream}/commit/${upstreamSha})를 확인했습니다.
- [전체 변경 비교](https://github.com/${fork}/compare/main...inkeep:main)
- 이 자동화는 빌드·타입체크·테스트를 실행하거나 통과를 보증하지 않습니다. 충돌 여부는 GitHub의 mergeability 표시를 확인하세요.

## Merge Danger

**Door:** two-way — 이 workflow는 PR만 관리하며 main을 변경하거나 Release를 배포하지 않습니다.

**Blast Radius:** 제품 전반

원본 변경과 fork의 GUI·Release 채널·설치 및 복구 동작을 검토하고 검증한 뒤 머지하세요.
upstream 이력을 보존하도록 **Create a merge commit**을 사용하세요. Squash/rebase merge는 같은 upstream commit이 다음 주에 다시 제안되는 원인이 됩니다.
충돌은 자동 해결하지 않습니다. 원본 head에는 쓰기 권한이 없으므로, 필요한 경우 fork의 별도 브랜치에서 merge하고 충돌을 해결해 대체 PR을 여세요.
`;
}

export function syncUpstream({ api = github, report = console.log } = {}) {
  const upstreamCommit = api('GET', `repos/${upstream}/commits/main`);
  const comparison = api('GET', `repos/${fork}/compare/main...${upstreamCommit.sha}`);
  if (comparison.ahead_by === 0) {
    report('upstream main의 모든 commit이 fork main에 포함돼 있습니다. PR을 만들지 않습니다.');
    return { action: 'unchanged' };
  }
  if (!Number.isSafeInteger(comparison.ahead_by) || comparison.ahead_by < 0)
    throw new Error('Invalid upstream comparison.');
  const pulls = api(
    'GET',
    `repos/${fork}/pulls?state=all&head=${encodeURIComponent(head)}&base=main&sort=created&direction=desc&per_page=100`,
  );
  const open = pulls.find((pr) => pr.state === 'open');
  const rejected = pulls.find(
    (pr) => pr.state === 'closed' && !pr.merged_at && pr.head.sha === upstreamCommit.sha,
  );
  if (!open && rejected) {
    report(
      `같은 upstream commit의 PR이 이미 닫혔습니다: ${rejected.html_url}. 다시 열지 않습니다.`,
    );
    return { action: 'dismissed', url: rejected.html_url };
  }
  const data = { title, body: pullRequestBody(comparison, upstreamCommit.sha) };
  const pr = open
    ? api('PATCH', `repos/${fork}/pulls/${open.number}`, data)
    : api('POST', `repos/${fork}/pulls`, {
        ...data,
        head,
        base: 'main',
        maintainer_can_modify: false,
      });
  report(
    `${open ? '기존 PR 갱신' : 'PR 생성'}: ${pr.html_url}\nupstream commit ${comparison.ahead_by}개. 자동 머지·배포는 하지 않습니다.`,
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
        `동기화 PR 관리 실패. main과 로컬 설치본은 변경하지 않았습니다. workflow 로그를 확인하세요.\n`,
      );
    process.exitCode = 1;
  }
}
