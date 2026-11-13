---
name: upstream-sync
description: Bring selected changes from upstream inkeep/open-knowledge into this repository, which now develops independently. Use when the user asks to sync, pull, port or check upstream ("upstream 싱크", "원본 변경 가져와", "inkeep 쪽 바뀐 거 있어?"). Upstream is not tracked automatically; nothing runs on a schedule.
---

# Upstream sync

이 저장소가 제품의 원장이다. inkeep/open-knowledge(OK)에서 출발했지만 2026-11-13부터 독자적으로 개발하며, 원본은 자동으로 따라가지 않고 사용자가 요청할 때 필요한 변경만 골라 가져온다.

## 1. 무엇이 쌓였는지 보고한다

```bash
git fetch upstream main
git log --oneline --no-merges main..upstream/main | head -100
git diff --stat main...upstream/main | tail -1
```

커밋을 관심사별로 묶어 짧게 보고한다: 버그 픽스, 보안, 기능, CI·릴리스, 문서. 이 저장소가 이미 바꾼 파일(`git diff --name-only $(git merge-base main upstream/main) main`)과 겹치는 묶음은 충돌 위험으로 표시한다.

## 2. 가져올 범위를 사용자와 정한다

- **골라 가져오기 (기본):** 사용자가 고른 커밋만 `git cherry-pick -x <sha>`로 새 브랜치에 옮긴다. `-x`로 원본 커밋을 메시지에 남긴다.
- **전체 병합:** 사용자가 명시적으로 원할 때만. `node scripts/release/sync-upstream.mjs`가 `inkeep:main → main` PR을 열거나 갱신한다. squash가 아니라 merge commit으로 합쳐야 같은 커밋이 다시 제안되지 않는다.

upstream의 CI·릴리스·미러 관련 변경(`.github/`, `release.yml`, `desktop-release*.yml`, 미러 allowlist)은 이 저장소가 쓰지 않으므로 기본으로 제외한다.

## 3. 충돌은 이 저장소의 방향을 기준으로 푼다

이 저장소의 결정(모바일 UI, `scripts/release/`, `release.yml`, 채널, 캐시 정책)을 되돌리지 않는다. 판단이 갈리는 충돌은 멈추고 양쪽 의도를 한 줄씩 정리해 묻는다.

## 4. 검증하고 넘긴다

```bash
pnpm verify:changed
pnpm preview   # UI가 바뀌었을 때
```

통과하면 브랜치를 push하고 PR을 연다. main에 직접 넣거나 릴리스를 돌리는 것은 사용자가 요청할 때만 한다.
