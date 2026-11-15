import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const POSIX_SYSTEM_PATH = '/usr/bin:/bin:/usr/sbin:/sbin';
function quotePosix(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function validateEnvironmentName(name: string): void {
  if (!/^[A-Z_][A-Z0-9_]*$/i.test(name)) {
    throw new Error(`invalid terminal smoke environment name: ${name}`);
  }
}

export interface TerminalSmokeShellCommands {
  readonly cwd: string;
  arithmetic(prefix: string, left: number, right: number, suffix: string): string;
  columns(marker: string): string;
  oscTitle(title: string, marker: string): string;
  output(value: string): string;
  processId(marker: string): string;
  readEnvironment(name: string, label: string): string;
  scroll(sentinel: string, start: string, prefix: string, count: number): string;
  setEnvironment(name: string, value: string): string;
  waitForFileThenOutput(
    releasePath: string,
    waitingPath: string,
    acknowledgementPath: string,
    waitingMarker: string,
  ): string;
  workingDirectory(marker: string): string;
}

export function terminalSmokeShellCommands(
  _platform: NodeJS.Platform = process.platform,
): TerminalSmokeShellCommands {
  return {
    cwd: 'pwd',
    arithmetic: (prefix, left, right, suffix) => `echo ${prefix}_$((${left}*${right}))_${suffix}`,
    columns: (marker) => `echo ${marker}=$(tput cols)`,
    oscTitle: (title, marker) =>
      `printf '\\033]0;${title}\\007'; printf '%s\\n' ${quotePosix(marker)}`,
    output: (value) => `printf '%s\\n' ${quotePosix(value)}`,
    processId: (marker) => `printf '${marker}=%s;\\n' "$$"`,
    readEnvironment: (name, label) => {
      validateEnvironmentName(name);
      return `echo "${label}=[$${name}]"`;
    },
    scroll: (sentinel, start, prefix, count) =>
      `printf '%s\\n' ${quotePosix(sentinel)} ${quotePosix(start)}; i=1; while [ "$i" -le ${count} ]; do printf '${prefix}%03d\\n' "$i"; i=$((i+1)); done`,
    setEnvironment: (name, value) => {
      validateEnvironmentName(name);
      return `export ${name}=${quotePosix(value)}`;
    },
    waitForFileThenOutput: (releasePath, waitingPath, acknowledgementPath, waitingMarker) =>
      `printf '%s\\n' ${quotePosix(waitingMarker)}; printf '%s\\n' ${quotePosix(waitingMarker)} > ${quotePosix(waitingPath)}; ok_wait=0; while [ ! -f ${quotePosix(releasePath)} ] && [ "$ok_wait" -lt 300 ]; do sleep 0.1; ok_wait=$((ok_wait+1)); done; if [ -f ${quotePosix(releasePath)} ]; then cat ${quotePosix(releasePath)}; cp ${quotePosix(releasePath)} ${quotePosix(acknowledgementPath)}; fi`,
    workingDirectory: (marker) => `printf '%s=[%s]\\n' ${quotePosix(marker)} "$PWD"`,
  };
}

export interface InputReadyProbe {
  marker: string;
  command: string;
}

export function buildInputReadyProbe(
  platform: NodeJS.Platform = process.platform,
): InputReadyProbe {
  const token = `OK_INPUT_READY_${randomUUID().replaceAll('-', '')}`;
  return {
    marker: `${token}_42_READY`,
    command: terminalSmokeShellCommands(platform).arithmetic(token, 6, 7, 'READY'),
  };
}

export interface ProcessIdProbe {
  marker: string;
  command: string;
}

export function buildProcessIdProbe(
  marker: string,
  platform: NodeJS.Platform = process.platform,
): ProcessIdProbe {
  const probeMarker = `${marker}_${randomUUID().replaceAll('-', '')}`;
  return {
    marker: probeMarker,
    command: terminalSmokeShellCommands(platform).processId(probeMarker),
  };
}

export function reportedWorkingDirectory(marker: string, text: string): string | null {
  const opening = `${marker}=[`;
  const start = text.lastIndexOf(opening);
  if (start === -1) return null;
  const match = /^([^\]\n]*)\]/u.exec(text.slice(start + opening.length));
  if (!match) return null;
  return match[1];
}

export function readTerminalProcessId(marker: string, text: string): number {
  const opening = `${marker}=`;
  const start = text.lastIndexOf(opening);
  if (start === -1) return 0;
  const match = /^(\d+);/u.exec(text.slice(start + opening.length));
  return match ? Number(match[1]) : 0;
}

interface TerminalSmokeEnvironmentOptions {
  env?: Record<string, string | undefined>;
  pathPrefix?: string;
  pinPosixZsh?: boolean;
  platform?: NodeJS.Platform;
  restrictPath?: boolean;
}

export function terminalSmokeEnvironment(
  tmpHome: string,
  options: TerminalSmokeEnvironmentOptions = {},
): Record<string, string> {
  const _platform = options.platform ?? process.platform;
  const env = options.env ?? (process.env as Record<string, string | undefined>);
  const pathKey = 'PATH';
  let basePath: string;
  if (!options.restrictPath) {
    basePath = env.PATH ?? '';
  } else {
    basePath = POSIX_SYSTEM_PATH;
  }

  const separator = ':';
  const path = options.pathPrefix
    ? [options.pathPrefix, basePath].filter(Boolean).join(separator)
    : basePath;
  return {
    HOME: tmpHome,
    [pathKey]: path,
    ...(options.pinPosixZsh && true ? { SHELL: '/bin/zsh' } : {}),
  };
}

interface TerminalShellProfileOptions {
  posixPathPrefix?: string;
  posixRestrictPath?: boolean;
}

export function seedTerminalShellProfiles(
  tmpHome: string,
  options: TerminalShellProfileOptions,
  platform: NodeJS.Platform = process.platform,
): void {
  if (!options.posixPathPrefix && !options.posixRestrictPath) return;
  const path = terminalSmokeEnvironment(tmpHome, {
    env: { PATH: process.env.PATH },
    pathPrefix: options.posixPathPrefix,
    platform,
    restrictPath: options.posixRestrictPath,
  }).PATH;
  const escapedPath = path.replace(/["\\$`]/g, '\\$&');
  const profile = `export PATH="${escapedPath}"\n`;
  writeFileSync(join(tmpHome, '.zprofile'), profile);
  writeFileSync(join(tmpHome, '.zshrc'), profile);
}

export type FakeClaudeMode = 'interactive' | 'version';

export function writeFakeClaudeShim(
  binDir: string,
  mode: FakeClaudeMode,
  _platform: NodeJS.Platform = process.platform,
): string {
  mkdirSync(binDir, { recursive: true });

  const shim = join(binDir, 'claude');
  const contents =
    mode === 'interactive'
      ? '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "claude 0.0.0-fake"; exit 0; fi\necho FAKE_CLAUDE_TUI_READY\nexec cat\n'
      : '#!/bin/sh\necho "claude 0.0.0-fake"\n';
  writeFileSync(shim, contents, { mode: 0o755 });
  return shim;
}
