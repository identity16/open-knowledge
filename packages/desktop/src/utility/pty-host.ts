import { existsSync } from 'node:fs';
import { userInfo } from 'node:os';
import { basename } from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  isTerminalLaunchEnvName,
  OK_DESKTOP_TERMINAL_ENV,
  shellSingleQuote,
  type TerminalLaunchCommand,
  terminalLaunchEnvSlots,
} from '@inkeep/open-knowledge-core';
import { isTerminalShellNoticeReason } from '@inkeep/open-knowledge-core/desktop-bridge';
import type { TerminalShellNoticeReason } from '../shared/bridge-contract.ts';
import {
  composeOkChildEnv,
  hasNoResolvableOkHome,
  okChildEnvOptions,
  okManagedBinDirs,
  okPackagedCliBinDir,
} from '../shared/ok-child-env.ts';
import { type PtyPhaseTrace, takeUtilityPtyPhaseTrace } from '../shared/pty-phase-trace.ts';
import {
  commandWithManagedPath,
  interactiveShellArgs,
  quoteShellArg,
  shellCommandFamily,
} from '../shared/terminal-shell.ts';

const utilityPhaseTrace = takeUtilityPtyPhaseTrace();
utilityPhaseTrace?.mark('module-entry', 'point', {
  processUptimeMs: Math.round(process.uptime() * 1000),
  nodeStartMs: performance.nodeTiming.nodeStart,
});

const DARWIN_FALLBACK_SHELL = '/bin/zsh';
const KILL_ESCALATE_MS = 250;

export interface PtyCreateMessage {
  type: 'create';
  ptyId: string;
  cwd: string;
  cols: number;
  rows: number;
  shell?: string;
  shellInvalidReason?: TerminalShellNoticeReason;
  launchCommand?: string | TerminalLaunchCommand;
}
interface PtyInputMessage {
  type: 'input';
  ptyId: string;
  data: string;
}
interface PtyResizeMessage {
  type: 'resize';
  ptyId: string;
  cols: number;
  rows: number;
}
interface PtyKillMessage {
  type: 'kill';
  ptyId: string;
}
interface PtyPauseMessage {
  type: 'pause';
  ptyId: string;
}
interface PtyResumeMessage {
  type: 'resume';
  ptyId: string;
}
interface PtyShutdownMessage {
  type: 'shutdown';
}
export type PtyHostIncomingMessage =
  | PtyCreateMessage
  | PtyInputMessage
  | PtyResizeMessage
  | PtyKillMessage
  | PtyPauseMessage
  | PtyResumeMessage
  | PtyShutdownMessage;

interface PtyDataMessage {
  type: 'data';
  ptyId: string;
  data: string;
}
interface PtyExitMessage {
  type: 'exit';
  ptyId: string;
  exitCode: number | undefined;
  signal: number | null;
}
type PtySpawnErrorMessage =
  | {
      type: 'spawn-error';
      ptyId: string;
      message: string;
      shellNeverAttached?: undefined;
    }
  | {
      type: 'spawn-error';
      ptyId: string;
      message?: undefined;
      shellNeverAttached: true;
      exitCode: number | undefined;
    };
type PtyShellNoticeMessage = {
  type: 'shell-notice';
  ptyId: string;
  notice: 'invalid-shell-override';
  reason: TerminalShellNoticeReason;
};
export type PtyHostOutgoingMessage =
  | PtyDataMessage
  | PtyExitMessage
  | PtySpawnErrorMessage
  | PtyShellNoticeMessage;

export interface PtyProcessLike {
  readonly pid: number;
  onData(listener: (data: string) => void): void;
  onExit(listener: (event: { exitCode: number | undefined; signal?: number }) => void): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
  pause(): void;
  resume(): void;
}

export interface PtySpawnOptions {
  name: string;
  cols: number;
  rows: number;
  cwd: string;
  env: Record<string, string>;
  encoding: 'utf8';
}
export type SpawnPty = (
  file: string,
  args: string[] | string,
  options: PtySpawnOptions,
) => PtyProcessLike;

interface PtyHostParentPort {
  on(event: 'message', handler: (event: { data: unknown }) => void): void;
  postMessage(value: PtyHostOutgoingMessage): void;
}

export function installPtyImportFailureReply(
  parentPort: PtyHostParentPort,
  error: unknown,
  logger?: { warn(data: Record<string, unknown>, message: string): void },
): void {
  const message = error instanceof Error ? error.message : String(error);
  logger?.warn({ event: 'pty-host-import-failed', error: message }, 'node-pty import failed');
  parentPort.on('message', (event) => {
    const msg = asIncomingMessage(event.data);
    if (msg?.type === 'create') {
      parentPort.postMessage({ type: 'spawn-error', ptyId: msg.ptyId, message });
    }
  });
}

export type PtyStartupBackend = 'bundled' | 'inbox' | 'posix';
export type PtyStartupSnapshotReason =
  | 'failure'
  | 'before-cleanup'
  | 'before-replacement'
  | 'before-kill'
  | 'before-shutdown'
  | 'exit';

export type PtyOsUnavailableReason =
  | 'deadline'
  | 'no-budget'
  | 'unsupported-platform'
  | 'query-start-failed'
  | 'query-exited'
  | 'invalid-json'
  | 'invalid-shape'
  | 'output-limit'
  | 'owner-loss'
  | 'process-absent'
  | 'access-unavailable'
  | 'identity-changed'
  | 'worker-request-deadline'
  | 'worker-unavailable'
  | 'console-identity-unavailable';

export type PtyOsSection<T> =
  | { status: 'captured'; value: T }
  | { status: 'unavailable'; reason: PtyOsUnavailableReason };

export interface PtyOsThreadSample {
  id: number;
  state:
    | 'initialized'
    | 'ready'
    | 'running'
    | 'standby'
    | 'terminated'
    | 'wait'
    | 'transition'
    | 'unknown';
  waitReason:
    | 'executive'
    | 'free-page'
    | 'page-in'
    | 'pool-allocation'
    | 'execution-delay'
    | 'suspended'
    | 'user-request'
    | 'event-pair-high'
    | 'event-pair-low'
    | 'lpc-receive'
    | 'lpc-reply'
    | 'virtual-memory'
    | 'page-out'
    | 'unknown'
    | 'not-applicable';
}

export interface PtyOsProcessSample {
  pid: number;
  parentPid: number | null;
  createdAtMs: number;
  first: { userMs: number; kernelMs: number; threadCount: number };
  second: { userMs: number; kernelMs: number; threadCount: number };
  threads: PtyOsThreadSample[];
  omittedThreads: number;
}

export interface PtyOsMachineSample {
  atMs: number;
  logicalCpus: number;
  userMs: number;
  systemMs: number;
  idleMs: number;
  irqMs: number;
  niceMs: number;
}

export interface PtyOsObservation {
  version: 1;
  status: 'captured' | 'partial' | 'unavailable';
  reason: PtyOsUnavailableReason | null;
  requestedPid: number | null;
  targets: Array<{ requestedPid: number; shell: PtyOsSection<PtyOsProcessSample> }>;
  startedAtMs: number | null;
  completedAtMs: number | null;
  shell: PtyOsSection<PtyOsProcessSample>;
  machine: PtyOsSection<{ first: PtyOsMachineSample; second: PtyOsMachineSample }>;
  console: PtyOsSection<{
    association: 'candidate-parent-relation';
    candidateCount: number;
    candidates: PtyOsProcessSample[];
    unavailableCandidates: Array<{
      reason: 'process-absent' | 'access-unavailable' | 'identity-changed';
      count: number;
    }>;
    omittedCandidates: number;
  }>;
  worker: PtyOsSection<{
    nodeThreadId: number;
    requestedAtMs: number;
    repliedAtMs: number;
    userMs: number;
    systemMs: number;
  }>;
  helper: {
    requested: boolean;
    reason: 'deadline' | 'output-limit' | 'owner-loss' | null;
    delivery: 'not-attempted' | 'no-pid' | 'already-exited' | 'accepted' | 'rejected' | 'threw';
    exit:
      | 'not-observed'
      | 'observed-before-request'
      | 'observed-after-request'
      | 'cooperative-deadline'
      | 'cooperative-owner-loss';
    exitCode: number | null;
  };
}

export interface PtyStartupNativeSnapshot {
  shell: {
    pid: number | null;
    nativeExitObserved: boolean;
    exitCode: number | null;
    osState: 'unobserved' | PtyOsObservation['shell'];
  };
  console: {
    backend: PtyStartupBackend;
    connection: 'pending' | 'entered' | 'returned' | 'failed';
    outputConnectionDisposed: boolean;
    osState: 'unobserved' | PtyOsObservation['console'];
  };
  worker: {
    threadId: number;
    online: boolean;
    readyReceived: boolean;
    errorObserved: boolean;
    writerError: boolean;
    exitCode: number | null;
    osState: 'unobserved' | PtyOsObservation['worker'];
  };
  transport: {
    capture: 'installed' | 'missing';
    nativeBytes: number;
    workerSubmittedBytes: number;
    mainBytes: number;
    nativeConnected: boolean;
    forwardingConnected: boolean;
    nativeClosed: boolean;
    forwardingClosed: boolean;
    nativeError: boolean;
    forwardingError: boolean;
    mainDestroyed: boolean;
    mainConnecting: boolean;
    mainReadableLength: number;
    inputWritableLength: number;
  };
}

export type PtyStartupObservation =
  | { stage: 'worker-online' | 'worker-ready-received' | 'data-pipe-connected' | 'worker-error' }
  | { stage: 'native-connect-enter'; boundary: 'agent-complete-connection' }
  | { stage: 'native-connect-return'; shellPid: number | null }
  | { stage: 'native-connect-failed' }
  | { stage: 'native-shell-exit'; shellPid: number | null; exitCode: number }
  | { stage: 'worker-exit'; exitCode: number }
  | { stage: 'observer-unavailable'; reason: 'unsupported-node-pty-shape' }
  | {
      stage: 'os-snapshot';
      observation: PtyOsObservation;
      transport: PtyStartupNativeSnapshot['transport'] | null;
    };

type PtyStartupHostObservation =
  | PtyStartupObservation
  | { stage: 'lookup-start' }
  | {
      stage: 'lookup-complete';
      lookup: 'override' | 'platform';
      rung: ShellResolutionRung;
    }
  | { stage: 'spawn-start' | 'spawn-return'; backend: PtyStartupBackend }
  | {
      stage: 'spawn-failed';
      backend: PtyStartupBackend;
      reason: 'spawn-error';
    }
  | { stage: 'first-output'; currentSession: boolean }
  | { stage: 'first-forward' }
  | { stage: 'terminal-exit'; exitCode: number | undefined }
  | {
      stage: 'snapshot';
      reason: PtyStartupSnapshotReason;
      receivedBytes: number;
      forwardedBytes: number;
      publicPid: number | null;
      terminalExitObserved: boolean;
      native: PtyStartupNativeSnapshot | null;
    };

export interface PtyStartupSpawnContext {
  traceId: number;
  attempt: number;
  startedAt: number;
  backend: PtyStartupBackend;
  emit(observation: PtyStartupObservation): void;
}

export interface PtyStartupObservedProcess {
  pty: PtyProcessLike;
  snapshot?(): PtyStartupNativeSnapshot;
  dispose?(): void;
}

export interface PtyStartupTraceOptions {
  aroundSpawn?(
    next: () => PtyProcessLike,
    context: PtyStartupSpawnContext,
  ): PtyStartupObservedProcess;
}

let nextStartupTraceId = 0;

export interface SetupPtyHostDeps {
  phaseTrace?: PtyPhaseTrace;
  startupTrace?: PtyStartupTraceOptions;
  parentPort: PtyHostParentPort | null;
  spawn: SpawnPty;
  exitHost?: (code: number) => void;
  flushLogger?: () => void;
  shutdownMs?: number;
  setTimer?: (cb: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (token: ReturnType<typeof setTimeout>) => void;
  env?: Record<string, string | undefined>;
  platform?: NodeJS.Platform;
  userInfoShell?: () => string | null;
  shellExists?: (path: string) => boolean;
  cliBinDir?: string;
  logger?: {
    warn: (o: Record<string, unknown>) => void;
    info?: (o: Record<string, unknown>) => void;
  };
}

function asIncomingMessage(raw: unknown): PtyHostIncomingMessage | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const m = raw as Record<string, unknown>;
  if (typeof m.type !== 'string') return null;
  if (m.type === 'shutdown') return raw as PtyShutdownMessage;
  if (typeof m.ptyId !== 'string' || m.ptyId.length === 0) return null;
  switch (m.type) {
    case 'create': {
      const launch = m.launchCommand;
      const launchEnv =
        typeof launch === 'object' && launch !== null
          ? (launch as Record<string, unknown>).env
          : undefined;
      const launchEnvValid =
        launchEnv === undefined ||
        (typeof launchEnv === 'object' &&
          launchEnv !== null &&
          !Array.isArray(launchEnv) &&
          Object.entries(launchEnv as Record<string, unknown>).every(
            ([key, value]) =>
              isTerminalLaunchEnvName(key) &&
              typeof value === 'string' &&
              !value.includes(String.fromCharCode(0)),
          ));
      const launchPathPrepend =
        typeof launch === 'object' && launch !== null
          ? (launch as Record<string, unknown>).pathPrepend
          : undefined;
      const launchPathPrependValid =
        launchPathPrepend === undefined ||
        (Array.isArray(launchPathPrepend) &&
          launchPathPrepend.every((dir) => typeof dir === 'string' && dir.length > 0));
      const launchValid =
        launch === undefined ||
        typeof launch === 'string' ||
        (typeof launch === 'object' &&
          launch !== null &&
          typeof (launch as Record<string, unknown>).executable === 'string' &&
          Array.isArray((launch as Record<string, unknown>).args) &&
          ((launch as Record<string, unknown>).args as unknown[]).every(
            (arg) => typeof arg === 'string',
          ) &&
          launchEnvValid &&
          launchPathPrependValid);
      return typeof m.cwd === 'string' &&
        typeof m.cols === 'number' &&
        typeof m.rows === 'number' &&
        (m.shell === undefined || typeof m.shell === 'string') &&
        (m.shellInvalidReason === undefined || isTerminalShellNoticeReason(m.shellInvalidReason)) &&
        launchValid
        ? (raw as PtyHostIncomingMessage)
        : null;
    }
    case 'input':
      return typeof m.data === 'string' ? (raw as PtyHostIncomingMessage) : null;
    case 'resize':
      return typeof m.cols === 'number' && typeof m.rows === 'number'
        ? (raw as PtyHostIncomingMessage)
        : null;
    case 'kill':
    case 'pause':
    case 'resume':
      return raw as PtyHostIncomingMessage;
    default:
      return null;
  }
}

export interface PtyHostHandle {
  snapshotStartup?(): void;
  killActive(): void;
}

export interface ResolveShellOptions {
  platform: NodeJS.Platform;
  override?: string;
  overrideInvalidReason?: TerminalShellNoticeReason;
  userInfoShell?: () => string | null;
  shellExists?: (path: string) => boolean;
  logger?: {
    warn: (o: Record<string, unknown>) => void;
    info?: (o: Record<string, unknown>) => void;
  };
}

export type ShellResolutionRung =
  | 'override'
  | 'env-shell'
  | 'platform-fallback'
  | 'passwd-shell'
  | 'bash'
  | 'sh';

export interface ShellResolution {
  shell: string;
  rung: ShellResolutionRung;
  invalidOverride: boolean;
  invalidOverrideReason?: TerminalShellNoticeReason;
}

function isFalseStyleShell(shell: string): boolean {
  const command = basename(shell);
  return command === 'false' || command === 'nologin';
}

function isUsableShell(
  shell: string | null | undefined,
  shellExists: (path: string) => boolean,
): shell is string {
  return (
    typeof shell === 'string' && shell.length > 0 && !isFalseStyleShell(shell) && shellExists(shell)
  );
}

export function resolveShellWithDetails(
  env: Record<string, string | undefined>,
  options: ResolveShellOptions,
): ShellResolution {
  if (options.override && options.override.length > 0) {
    return { shell: options.override, rung: 'override', invalidOverride: false };
  }

  const configuredShell = env.SHELL;
  if (options.platform === 'darwin') {
    return typeof configuredShell === 'string' && configuredShell.length > 0
      ? { shell: configuredShell, rung: 'env-shell', invalidOverride: false }
      : { shell: DARWIN_FALLBACK_SHELL, rung: 'platform-fallback', invalidOverride: false };
  }
  if (options.platform !== 'linux') {
    return typeof configuredShell === 'string' && configuredShell.length > 0
      ? { shell: configuredShell, rung: 'env-shell', invalidOverride: false }
      : { shell: '/bin/sh', rung: 'platform-fallback', invalidOverride: false };
  }

  const shellExists = options.shellExists ?? existsSync;
  if (isUsableShell(configuredShell, shellExists)) {
    return { shell: configuredShell, rung: 'env-shell', invalidOverride: false };
  }

  let passwdShell: string | null = null;
  try {
    passwdShell = (options.userInfoShell ?? (() => userInfo().shell))();
  } catch (err) {
    const code = (err as { code?: unknown } | null)?.code;
    options.logger?.warn({
      event: 'pty-host-user-info-shell-failed',
      code: typeof code === 'string' ? code : 'unknown',
    });
    passwdShell = null;
  }
  if (isUsableShell(passwdShell, shellExists)) {
    return { shell: passwdShell, rung: 'passwd-shell', invalidOverride: false };
  }
  return shellExists('/bin/bash')
    ? { shell: '/bin/bash', rung: 'bash', invalidOverride: false }
    : { shell: '/bin/sh', rung: 'sh', invalidOverride: false };
}

export function resolveShell(
  env: Record<string, string | undefined>,
  options: ResolveShellOptions,
): string {
  return resolveShellWithDetails(env, options).shell;
}

export function buildShellArgs(
  platform: NodeJS.Platform,
  shell: string,
  launchCommand: string | TerminalLaunchCommand | undefined,
  managedBinDirs: readonly string[],
): string[] {
  const interactiveArgs = [...interactiveShellArgs(platform)];
  const command =
    typeof launchCommand === 'object'
      ? composeStructuredLaunch(shell, launchCommand)
      : launchCommand;
  if (typeof command !== 'string' || command.length === 0) return interactiveArgs;
  const binDirs =
    typeof launchCommand === 'object'
      ? [...(launchCommand.pathPrepend ?? []), ...managedBinDirs]
      : managedBinDirs;
  const unsetStep =
    typeof launchCommand === 'object'
      ? unsetEnvStep(
          shell,
          terminalLaunchEnvSlots(launchCommand.env).map(({ slot }) => slot),
        )
      : '';
  const quotedShell = shellSingleQuote(shell);
  return [
    ...interactiveArgs,
    '-c',
    commandWithManagedPath(
      shell,
      `${command}; ${unsetStep}exec ${quotedShell} ${interactiveArgs.join(' ')}`,
      binDirs,
    ),
  ];
}

function unsetEnvStep(shell: string, names: readonly string[]): string {
  if (names.length === 0) return '';
  return shellCommandFamily(shell) === 'fish'
    ? `set -e ${names.join(' ')}; `
    : `unset ${names.join(' ')}; `;
}

const BARE_COMMAND_NAME_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/u;

function composeStructuredLaunch(shell: string, launch: TerminalLaunchCommand): string {
  const executable = BARE_COMMAND_NAME_RE.test(launch.executable)
    ? launch.executable
    : quoteShellArg(shell, launch.executable);
  const command = [executable, ...launch.args.map((token) => quoteShellArg(shell, token))].join(
    ' ',
  );
  const slots = terminalLaunchEnvSlots(launch.env);
  if (slots.length === 0) return command;
  if (shellCommandFamily(shell) === 'fish') {
    const assigns = slots.map(({ name, slot }) => `set -lx ${name} "$${slot}"; `).join('');
    return `begin; ${assigns}${command}; end`;
  }
  const assigns = slots.map(({ name, slot }) => `${name}="$${slot}"`).join(' ');
  return `(export ${assigns}; exec ${command})`;
}

export function buildLaunchEnv(
  shellEnv: Record<string, string>,
  launchCommand: string | TerminalLaunchCommand | undefined,
): Record<string, string> {
  if (typeof launchCommand !== 'object') return shellEnv;
  const env = { ...shellEnv };
  for (const { slot, value } of terminalLaunchEnvSlots(launchCommand.env)) env[slot] = value;
  return env;
}

export function buildShellEnv(
  parentEnv: Record<string, string | undefined>,
  options: {
    platform?: NodeJS.Platform;
    cliBinDir?: string;
    logger?: { warn: (data: Record<string, unknown>) => void };
  } = {},
): { env: Record<string, string>; managedBinDirs: readonly string[] } {
  const childOptions = okChildEnvOptions(parentEnv, {
    platform: options.platform,
    cliBinDir: options.cliBinDir,
  });
  if (hasNoResolvableOkHome(childOptions)) {
    options.logger?.warn({ event: 'pty-host-no-ok-managed-home', platform: childOptions.platform });
  }
  const out = composeOkChildEnv(parentEnv, childOptions);
  out[OK_DESKTOP_TERMINAL_ENV] = '1';
  return { env: out, managedBinDirs: okManagedBinDirs(childOptions) };
}

function classifyNodePtyEnding(
  ptyId: string,
  pidAtExit: number,
  { exitCode, signal }: { exitCode: number | undefined; signal?: number },
): PtyExitMessage | Extract<PtySpawnErrorMessage, { shellNeverAttached: true }> {
  if (pidAtExit === 0) {
    return { type: 'spawn-error', ptyId, shellNeverAttached: true, exitCode };
  }
  return { type: 'exit', ptyId, exitCode, signal: signal ?? null };
}

function markStartupPhase(
  phaseTrace: PtyPhaseTrace,
  ptyId: string,
  attempt: number,
  observation: PtyStartupHostObservation,
): void {
  switch (observation.stage) {
    case 'lookup-start':
      phaseTrace.mark('shell-resolution', 'begin', { ptyId });
      return;
    case 'lookup-complete':
      phaseTrace.mark('shell-resolution', 'end', { ptyId, rung: observation.rung });
      return;
    case 'spawn-start':
      phaseTrace.mark('pty-spawn', 'begin', { ptyId, attempt, backend: observation.backend });
      return;
    case 'spawn-return':
      phaseTrace.mark('pty-spawn', 'end', { ptyId, attempt, backend: observation.backend });
      return;
    case 'spawn-failed':
      phaseTrace.mark('pty-spawn', 'error', { ptyId, attempt, backend: observation.backend });
      return;
    case 'first-output':
      phaseTrace.mark('pty-first-output', 'point', {
        ptyId,
        currentSession: observation.currentSession,
      });
      return;
    case 'first-forward':
      phaseTrace.mark('pty-first-forward', 'point', { ptyId });
      return;
    case 'terminal-exit':
      phaseTrace.mark('pty-exit', 'point', { ptyId, exitCode: observation.exitCode });
      return;
    case 'snapshot':
    case 'worker-online':
    case 'worker-ready-received':
    case 'data-pipe-connected':
    case 'worker-error':
    case 'native-connect-enter':
    case 'native-connect-return':
    case 'native-connect-failed':
    case 'native-shell-exit':
    case 'worker-exit':
    case 'observer-unavailable':
    case 'os-snapshot':
      return;
    default: {
      const _exhaustive: never = observation;
      void _exhaustive;
    }
  }
}

export function setupPtyHost(deps: SetupPtyHostDeps): PtyHostHandle {
  const env = deps.env ?? (process.env as Record<string, string | undefined>);
  const phaseTrace = deps.phaseTrace;
  const platform = deps.platform ?? process.platform;
  const sessions = new Map<string, PtyProcessLike>();
  const startupTraces =
    deps.startupTrace || phaseTrace
      ? new WeakMap<
          PtyProcessLike,
          {
            emit(
              observation:
                | PtyStartupObservation
                | { stage: 'terminal-exit'; exitCode: number | undefined },
            ): void;
            snapshot(reason: PtyStartupSnapshotReason): void;
            receive(data: string, currentSession: boolean): void;
            forward(data: string): void;
            exited(): void;
            dispose(): void;
          }
        >()
      : undefined;

  function snapshot(pty: PtyProcessLike, reason: PtyStartupSnapshotReason): void {
    startupTraces?.get(pty)?.snapshot(reason);
  }

  const shutdownMs = deps.shutdownMs ?? 1_500;
  const setHostTimer = deps.setTimer ?? setTimeout;
  const clearHostTimer = deps.clearTimer ?? clearTimeout;
  const killEscalateTokens = new Map<string, ReturnType<typeof setHostTimer>>();

  function clearKillEscalate(ptyId: string): void {
    const token = killEscalateTokens.get(ptyId);
    if (token === undefined) return;
    killEscalateTokens.delete(ptyId);
    clearHostTimer(token);
  }

  function clearAllKillEscalates(): void {
    for (const token of killEscalateTokens.values()) clearHostTimer(token);
    killEscalateTokens.clear();
  }

  function post(message: PtyHostOutgoingMessage): void {
    deps.parentPort?.postMessage(message);
  }

  function safeKill(pty: PtyProcessLike, signal?: string): void {
    try {
      if (signal === undefined) {
        pty.kill();
      } else {
        pty.kill(signal);
      }
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      if (code !== 'ESRCH') {
        deps.logger?.warn({ event: 'pty-host-reap-failed', code: code ?? 'unknown' });
      }
    }
  }

  function handleCreate(message: PtyCreateMessage): void {
    const { ptyId } = message;
    const stale = sessions.get(ptyId);
    if (stale) {
      snapshot(stale, 'before-replacement');
      startupTraces?.get(stale)?.dispose();
      safeKill(stale);
      sessions.delete(ptyId);
    }
    const traceId = deps.startupTrace ? ++nextStartupTraceId : undefined;
    const startedAt =
      traceId === undefined ? undefined : performance.timeOrigin + performance.now();
    let attempt = 0;
    let sequence = 0;
    const lookup: 'override' | 'platform' = message.shell ? 'override' : 'platform';
    const emit =
      startedAt === undefined
        ? undefined
        : (observation: PtyStartupHostObservation, observedAttempt = attempt): void => {
            deps.logger?.info?.({
              event: 'pty-host-startup',
              traceId,
              attempt: observedAttempt,
              sequence: ++sequence,
              elapsedMs: performance.timeOrigin + performance.now() - startedAt,
              producer: 'host',
              ...observation,
            });
          };
    const observe =
      emit === undefined && phaseTrace === undefined
        ? undefined
        : (observation: PtyStartupHostObservation, observedAttempt = attempt): void => {
            emit?.(observation, observedAttempt);
            if (phaseTrace) markStartupPhase(phaseTrace, ptyId, observedAttempt, observation);
          };
    observe?.({ stage: 'lookup-start' });
    let resolution: ShellResolution;
    try {
      resolution = resolveShellWithDetails(env, {
        platform,
        override: message.shell,
        overrideInvalidReason: message.shellInvalidReason,
        userInfoShell: deps.userInfoShell,
        shellExists: deps.shellExists,
        logger: deps.logger,
      });
    } catch (error) {
      phaseTrace?.mark('shell-resolution', 'error', { ptyId });
      throw error;
    }
    observe?.({ stage: 'lookup-complete', lookup, rung: resolution.rung });
    if (resolution.invalidOverride) {
      const reason = resolution.invalidOverrideReason ?? 'invalid-value';
      deps.logger?.warn({
        event: 'pty-host-shell-override-invalid',
        platform,
        reason,
      });
      post({
        type: 'shell-notice',
        ptyId,
        notice: 'invalid-shell-override',
        reason,
      });
    }
    deps.logger?.info?.({
      event: 'pty-host-shell-resolved',
      platform,
      rung: resolution.rung,
      shellCommandFamily: shellCommandFamily(resolution.shell),
    });
    const shell = resolution.shell;
    const { env: shellEnv, managedBinDirs } = buildShellEnv(env, {
      platform,
      cliBinDir: deps.cliBinDir,
      logger: deps.logger,
    });
    const launchCommand = message.launchCommand;
    let shellArgs: string[];
    try {
      shellArgs = buildShellArgs(platform, shell, launchCommand, managedBinDirs);
    } catch (error) {
      deps.logger?.warn({
        event: 'pty-host-launch-compose-failed',
        platform,
        rung: resolution.rung,
      });
      post({
        type: 'spawn-error',
        ptyId,
        message: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    const spawnOptions: PtySpawnOptions = {
      name: 'xterm-256color',
      cols: message.cols,
      rows: message.rows,
      cwd: message.cwd,
      env: buildLaunchEnv(shellEnv, launchCommand),
      encoding: 'utf8',
    };
    let observation: PtyStartupObservedProcess | undefined;
    const spawnAttempt = (options: PtySpawnOptions): PtyProcessLike => {
      if (observe === undefined) return deps.spawn(shell, shellArgs, options);
      attempt += 1;
      const backend: PtyStartupBackend = 'posix';
      observe({ stage: 'spawn-start', backend });
      try {
        const next = () => deps.spawn(shell, shellArgs, options);
        const observedAttempt = attempt;
        observation = (traceId === undefined || startedAt === undefined || emit === undefined
          ? undefined
          : deps.startupTrace?.aroundSpawn?.(next, {
              traceId,
              attempt,
              startedAt,
              backend,
              emit: (entry) => emit(entry, observedAttempt),
            })) ?? { pty: next() };
        observe({ stage: 'spawn-return', backend });
        return observation.pty;
      } catch (error) {
        observe({ stage: 'spawn-failed', backend, reason: 'spawn-error' });
        throw error;
      }
    };
    let pty: PtyProcessLike;
    try {
      pty = spawnAttempt(spawnOptions);
    } catch (err) {
      const spawnMessage = err instanceof Error ? err.message : String(err);
      post({ type: 'spawn-error', ptyId, message: spawnMessage });
      return;
    }
    if (observe !== undefined) {
      let receivedBytes = 0;
      let forwardedBytes = 0;
      let terminalExitObserved = false;
      let received = false;
      let forwarded = false;
      startupTraces?.set(pty, {
        emit: observe,
        snapshot(reason) {
          observe({
            stage: 'snapshot',
            reason,
            receivedBytes,
            forwardedBytes,
            publicPid: pty.pid > 0 ? pty.pid : null,
            terminalExitObserved,
            native: observation?.snapshot?.() ?? null,
          });
        },
        receive(data, currentSession) {
          receivedBytes += Buffer.byteLength(data);
          if (!received) {
            received = true;
            observe({ stage: 'first-output', currentSession });
          }
        },
        forward(data) {
          forwardedBytes += Buffer.byteLength(data);
          if (!forwarded) {
            forwarded = true;
            observe({ stage: 'first-forward' });
          }
        },
        exited() {
          terminalExitObserved = true;
        },
        dispose() {
          observation?.dispose?.();
        },
      });
    }
    sessions.set(ptyId, pty);
    pty.onData((data) => {
      startupTraces?.get(pty)?.receive(data, sessions.get(ptyId) === pty);
      if (sessions.get(ptyId) !== pty) return;
      post({ type: 'data', ptyId, data });
      startupTraces?.get(pty)?.forward(data);
    });
    pty.onExit((event) => {
      const trace = startupTraces?.get(pty);
      trace?.exited();
      trace?.emit({ stage: 'terminal-exit', exitCode: event.exitCode });
      trace?.snapshot('exit');
      trace?.dispose();
      clearKillEscalate(ptyId);
      if (sessions.get(ptyId) === pty) sessions.delete(ptyId);
      post(classifyNodePtyEnding(ptyId, pty.pid, event));
      if (shuttingDown && sessions.size === 0) finishShutdown();
    });
  }

  function handleInput(message: PtyInputMessage): void {
    const pty = sessions.get(message.ptyId);
    if (!pty) return;
    pty.write(message.data);
  }

  function handleResize(message: PtyResizeMessage): void {
    const pty = sessions.get(message.ptyId);
    if (!pty) return;
    pty.resize(message.cols, message.rows);
  }

  function handleKill(message: PtyKillMessage): void {
    const pty = sessions.get(message.ptyId);
    if (!pty) return;
    const ptyId = message.ptyId;
    snapshot(pty, 'before-kill');
    safeKill(pty);
    if (sessions.get(ptyId) !== pty) return;
    clearKillEscalate(ptyId);
    const token = setHostTimer(() => {
      killEscalateTokens.delete(ptyId);
      if (sessions.get(ptyId) !== pty) return;
      safeKill(pty, 'SIGKILL');
    }, KILL_ESCALATE_MS);
    if (typeof token.unref === 'function') token.unref();
    killEscalateTokens.set(ptyId, token);
  }

  function handlePause(message: PtyPauseMessage): void {
    sessions.get(message.ptyId)?.pause();
  }

  function handleResume(message: PtyResumeMessage): void {
    sessions.get(message.ptyId)?.resume();
  }

  function killActiveSessions(): void {
    clearAllKillEscalates();
    for (const pty of sessions.values()) {
      snapshot(pty, 'before-cleanup');
      startupTraces?.get(pty)?.dispose();
      safeKill(pty);
    }
    sessions.clear();
  }

  let shuttingDown = false;
  let shutdownToken: ReturnType<typeof setTimeout> | null = null;
  let hostExited = false;

  function finishShutdown(): void {
    if (hostExited) return;
    hostExited = true;
    clearAllKillEscalates();
    if (shutdownToken !== null) {
      clearHostTimer(shutdownToken);
      shutdownToken = null;
    }
    sessions.clear();
    deps.flushLogger?.();
    deps.exitHost?.(0);
  }

  function handleShutdown(): void {
    if (shuttingDown) return;
    shuttingDown = true;
    clearAllKillEscalates();
    for (const pty of sessions.values()) {
      snapshot(pty, 'before-shutdown');
      startupTraces?.get(pty)?.dispose();
      safeKill(pty);
    }
    if (sessions.size === 0) {
      finishShutdown();
      return;
    }
    shutdownToken = setHostTimer(() => {
      shutdownToken = null;
      deps.logger?.warn({ event: 'pty-host-shutdown-deadline', remaining: sessions.size });
      finishShutdown();
    }, shutdownMs);
  }

  deps.parentPort?.on('message', (event) => {
    const message = asIncomingMessage(event.data);
    if (!message) {
      deps.logger?.warn({ event: 'pty-host-unexpected-message' });
      return;
    }
    switch (message.type) {
      case 'create':
        phaseTrace?.mark('message-received', 'point', { ptyId: message.ptyId });
        handleCreate(message);
        break;
      case 'input':
        handleInput(message);
        break;
      case 'resize':
        handleResize(message);
        break;
      case 'kill':
        handleKill(message);
        break;
      case 'pause':
        handlePause(message);
        break;
      case 'resume':
        handleResume(message);
        break;
      case 'shutdown':
        handleShutdown();
        break;
      default:
        deps.logger?.warn({
          event: 'pty-host-unexpected-message',
          type: (message as unknown as { type: string }).type,
        });
        break;
    }
  });

  if (deps.parentPort) phaseTrace?.mark('listener-ready', 'point');

  return {
    snapshotStartup(): void {
      if (!startupTraces) return;
      for (const pty of sessions.values()) snapshot(pty, 'failure');
    },
    killActive(): void {
      killActiveSessions();
    },
  };
}

export interface HostReapProcess {
  on(event: 'exit', listener: () => void): void;
  on(event: NodeJS.Signals, listener: () => void): void;
  exit(code?: number): void;
}

const REAP_SIGNALS: readonly NodeJS.Signals[] = ['SIGTERM', 'SIGINT', 'SIGHUP'];

export function installHostReaping(handle: PtyHostHandle, proc: HostReapProcess): void {
  let reaped = false;
  const reap = (): void => {
    if (reaped) return;
    reaped = true;
    handle.killActive();
  };
  proc.on('exit', reap);
  for (const signal of REAP_SIGNALS) {
    proc.on(signal, () => {
      reap();
      proc.exit(0);
    });
  }
}

if ((process as NodeJS.Process & { parentPort?: unknown }).parentPort) {
  const parentPort = (process as NodeJS.Process & { parentPort: PtyHostParentPort }).parentPort;
  void (async () => {
    let log: {
      warn(data: Record<string, unknown>, message?: string): void;
      info(data: Record<string, unknown>, message?: string): void;
    } = {
      warn: (data, message) => console.warn(message ?? '[pty-host] warning', data),
      info: (data, message) => console.info(message ?? '[pty-host] info', data),
    };
    let flushLogger = () => {};
    utilityPhaseTrace?.mark('logger-import', 'begin');
    try {
      const { flushDesktopLogger, getLogger } = await import('../main/desktop-logger.ts');
      log = getLogger('pty-host');
      flushLogger = flushDesktopLogger;
      utilityPhaseTrace?.mark('logger-import', 'end');
    } catch (err) {
      utilityPhaseTrace?.mark('logger-import', 'error');
      const code = (err as { code?: unknown } | null)?.code;
      console.warn('[pty-host] logger unavailable; using console fallback', {
        code: typeof code === 'string' ? code : 'unknown',
      });
    }
    let spawn: SpawnPty;
    utilityPhaseTrace?.mark('native-import', 'begin');
    try {
      ({ spawn } = await import('node-pty'));
      utilityPhaseTrace?.mark('native-import', 'end');
    } catch (err) {
      utilityPhaseTrace?.mark('native-import', 'error');
      installPtyImportFailureReply(parentPort, err, log);
      return;
    }
    const handle = setupPtyHost({
      phaseTrace: utilityPhaseTrace,
      parentPort,
      spawn,
      exitHost: (code) => process.exit(code),
      flushLogger,
      env: process.env,
      cliBinDir: okPackagedCliBinDir(
        process.platform,
        (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath,
      ),
      logger: {
        warn: (o) => log.warn(o, 'pty-host warning'),
        info: (o) => log.info(o, 'pty-host shell resolution'),
      },
    });
    installHostReaping(handle, process);
  })();
}
