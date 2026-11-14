# OpenKnowledge16 Agent Guide

This repository is the source of truth for OpenKnowledge16, a macOS-only product that started from upstream [inkeep/open-knowledge](https://github.com/inkeep/open-knowledge) and now develops independently. Write everything you add to the repository in English.

## Toolchain

- pnpm 12; pnpm runs the Node.js version pinned by `devEngines.runtime` (equal to `.node-version`). Select `.node-version` yourself before running `node` directly.
- Rust 1.99 from `rust-toolchain.toml`, through the rustup proxies in `~/.cargo/bin`.

## Loop

| Step | Command | When |
|---|---|---|
| Verify | `pnpm verify:changed` | After every change: lint, typecheck and related tests for what changed since `origin/main` |
| One test | `pnpm test:file <path>` | Run specific test files; picks the config their suffix needs (`.dom.`, `.browser.`, `.node.`, `.uncached.`, `node:test`) |
| Look | `pnpm preview` | UI changes: phone and desktop screenshots in `/tmp/ok-preview/latest` |
| Ship locally | `pnpm deploy:local` | Run the change on this Mac's `ok` service at :8080 |
| Release | `.github/workflows/release.yml` (`build_only` measures without publishing); read a run with `node scripts/release/watch-release.mjs <run id> [--wait]` | Batched changes; versions are plain semver tagged `vX.Y.Z` |
| Full check | `pnpm run check` | Before a release only; it runs the integration tiers and takes tens of minutes |

A red is yours when it is in a test you added or edited or names a file you changed: fix its cause. For any other red, run the same test on the base commit and report it as "also red on the base".

## Layout

- `packages/app`: web app and editor UI
- `packages/server`: local server (HTTP API, Yjs collaboration, file watching, search index, git, MCP server, ACP agent sessions)
- `packages/cli`: `ok` CLI; bundles the server and the web app
- `packages/core`: logic shared by the browser and the server
- `packages/desktop`: Electron app (macOS arm64 only)
- `scripts/release`: release, local deploy, verify and preview tooling
- Upstream changes come in only through the `upstream-sync` skill.

## Comment policy

Write no comments: put explanation in names, types, tests, the commit message or a doc. `pnpm run lint` enforces this and its diagnostic names the allowed forms (tool directives, `@deprecated`, `STOP:`/`WARN:`/`UPSTREAM(...)` markers, precedent citations). The full policy is [`lint-plugins/no-comments/README.md`](./lint-plugins/no-comments/README.md).

## Process safety

Signal only a `ChildProcess` you spawned and still hold, never a pid read from a file, `ps` or output. The exception is the `server.lock` pid in `runStop` (CLI) and `terminateServerByPid` (desktop), and only after `assessLockHolder` confirms the holder wrote the lock.
