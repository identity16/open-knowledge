---
name: upstream-sync
description: Bring selected changes from upstream inkeep/open-knowledge into this repository. Use when the user asks to sync, pull, port or check upstream ("upstream 싱크", "원본 변경 가져와", "inkeep 쪽 바뀐 거 있어?"). Nothing tracks upstream on a schedule.
---

# Upstream sync

This repository is the product's source of truth. It started from inkeep/open-knowledge and has developed independently since 2026-11-13, so upstream changes arrive only when the user picks them.

## 1. Report what upstream added

```bash
git fetch --no-tags upstream main
git log --oneline --no-merges main..upstream/main | head -100
git diff --stat main...upstream/main | tail -1
```

Group the commits by concern (fixes, security, features, CI/release, docs) and mark groups that touch files this repository already changed (`git diff --name-only $(git merge-base main upstream/main) main`) as conflict risks.

Fetch and push without tags: this product's `vX.Y.Z` tags are its own line, and the 1,445 upstream tags were removed on 2026-11-13 to end the collisions.

## 2. Agree the scope with the user

- **Pick (default):** move the chosen commits onto a new branch with `git cherry-pick -x <sha>`, keeping the upstream commit in each message.
- **Full merge, only when asked:** `node scripts/release/sync-upstream.mjs` opens or updates an `inkeep:main → main` PR. Merge it with a merge commit so the same commits are not offered again.

Leave out upstream CI, release and mirror changes (`.github/`, their release workflows, the mirror allowlist); this repository does not use them.

## 3. Resolve conflicts in this repository's favour

Keep this repository's decisions (mobile UI, `scripts/release/`, `release.yml`, the channel, the cache policy). When a conflict needs judgement, stop and ask with one line per side's intent.

## 4. Verify and hand over

```bash
pnpm verify:changed
pnpm preview   # when the UI changed
```

Push the branch and open a PR once it passes. Merge to main or cut a release only when the user asks.
