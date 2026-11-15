import { homedir } from 'node:os';

import {
  OK_DESKTOP_TERMINAL_ENV,
  OK_HOSTED_AGENT_ENV,
  posixOkManagedBinDir,
  shellSingleQuote,
} from '@inkeep/open-knowledge-core';
import { describe, expect, test, vi } from 'vitest';

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, homedir: vi.fn(actual.homedir) };
});

import { isTerminalPlatform } from '../../src/shared/terminal-platform.ts';
import {
  buildLaunchEnv,
  buildShellArgs,
  buildShellEnv,
  type HostReapProcess,
  installHostReaping,
  installPtyImportFailureReply,
  type PtyCreateMessage,
  type PtyHostHandle,
  type PtyHostIncomingMessage,
  type PtyHostOutgoingMessage,
  type PtyProcessLike,
  type PtySpawnOptions,
  resolveShell,
  type SpawnPty,
  setupPtyHost,
} from '../../src/utility/pty-host.ts';

interface FakePty extends PtyProcessLike {
  writes: string[];
  resizes: Array<[number, number]>;
  killCount: number;
  killSignals: Array<string | undefined>;
  killThrows: boolean;
  pauseCount: number;
  resumeCount: number;
  emitData(data: string): void;
  emitExit(event: { exitCode: number | undefined; signal?: number }): void;
}

function makeFakePty(): FakePty {
  let onData: ((data: string) => void) | null = null;
  let onExit: ((event: { exitCode: number | undefined; signal?: number }) => void) | null = null;
  return {
    pid: 4242,
    writes: [],
    resizes: [],
    killCount: 0,
    killThrows: false,
    pauseCount: 0,
    resumeCount: 0,
    onData(listener) {
      onData = listener;
    },
    onExit(listener) {
      onExit = listener;
    },
    write(data) {
      this.writes.push(data);
    },
    resize(cols, rows) {
      this.resizes.push([cols, rows]);
    },
    killSignals: [] as Array<string | undefined>,
    kill(signal?: string) {
      this.killCount += 1;
      this.killSignals.push(signal);
      if (this.killThrows) throw Object.assign(new Error('kill ESRCH'), { code: 'ESRCH' });
    },
    pause() {
      this.pauseCount += 1;
    },
    resume() {
      this.resumeCount += 1;
    },
    emitData(data) {
      onData?.(data);
    },
    emitExit(event) {
      onExit?.(event);
    },
  };
}

interface Harness {
  fire(message: PtyHostIncomingMessage): void;
  fireRaw(data: unknown): void;
  posted: PtyHostOutgoingMessage[];
  spawnCalls: Array<{ file: string; args: string[] | string; options: PtySpawnOptions }>;
  handle: ReturnType<typeof setupPtyHost>;
}

function makeHarness(opts?: {
  pty?: FakePty;
  spawn?: SpawnPty;
  env?: Record<string, string | undefined>;
  platform?: NodeJS.Platform;
  userInfoShell?: () => string | null;
  shellExists?: (path: string) => boolean;
  cliBinDir?: string;
  logger?: {
    warn: (o: Record<string, unknown>) => void;
    info?: (o: Record<string, unknown>) => void;
  };
  exitHost?: (code: number) => void;
  flushLogger?: () => void;
  shutdownMs?: number;
}): Harness {
  let handler: ((event: { data: unknown }) => void) | null = null;
  const posted: PtyHostOutgoingMessage[] = [];
  const spawnCalls: Array<{ file: string; args: string[] | string; options: PtySpawnOptions }> = [];
  const pty = opts?.pty ?? makeFakePty();
  const spawn: SpawnPty =
    opts?.spawn ??
    ((file, args, options) => {
      spawnCalls.push({ file, args, options });
      return pty;
    });
  const handle = setupPtyHost({
    parentPort: {
      on(_event, h) {
        handler = h;
      },
      postMessage(value) {
        posted.push(value);
      },
    },
    spawn,
    exitHost: opts?.exitHost,
    flushLogger: opts?.flushLogger,
    shutdownMs: opts?.shutdownMs,
    env: opts?.env ?? { SHELL: '/bin/zsh', PATH: '/usr/bin' },
    platform: opts?.platform ?? 'darwin',
    userInfoShell: opts?.userInfoShell,
    shellExists: opts?.shellExists,
    cliBinDir: opts?.cliBinDir,
    logger: opts?.logger,
  });
  return {
    fire: (message) => handler?.({ data: message }),
    fireRaw: (data) => handler?.({ data }),
    posted,
    spawnCalls,
    handle,
  };
}

const CREATE = (over?: Partial<PtyCreateMessage>): PtyCreateMessage => ({
  type: 'create',
  ptyId: 'p1',
  cwd: '/project/root',
  cols: 80,
  rows: 24,
  ...over,
});

describe('setupPtyHost — create', () => {
  test('spawns the login interactive shell at the project root', () => {
    const h = makeHarness({ env: { SHELL: '/bin/bash', PATH: '/usr/bin' } });
    h.fire(CREATE());
    expect(h.spawnCalls).toHaveLength(1);
    expect(h.spawnCalls[0]?.file).toBe('/bin/bash');
    expect(h.spawnCalls[0]?.args).toEqual(['-l', '-i']);
    expect(h.spawnCalls[0]?.options.cwd).toBe('/project/root');
    expect(h.spawnCalls[0]?.options.cols).toBe(80);
    expect(h.spawnCalls[0]?.options.rows).toBe(24);
  });

  test('Linux creates the PTY with interactive non-login argv', () => {
    const h = makeHarness({
      platform: 'linux',
      env: { SHELL: '/bin/bash', PATH: '/usr/bin' },
      shellExists: (path) => path === '/bin/bash',
    });
    h.fire(CREATE());

    expect(h.spawnCalls[0]?.file).toBe('/bin/bash');
    expect(h.spawnCalls[0]?.args).toEqual(['-i']);
    expect(h.spawnCalls[0]?.args).not.toContain('-l');
  });

  test('bakes a launch command into a non-history `-c` spawn with an interactive exec tail', () => {
    const env = { SHELL: '/bin/zsh', PATH: '/usr/bin' };
    const h = makeHarness({ env });
    h.fire(CREATE({ launchCommand: "claude 'do the thing'" }));
    const [managedBinDir] = buildShellEnv(env, { platform: 'darwin' }).managedBinDirs;
    expect(managedBinDir).toBeDefined();
    expect(h.spawnCalls[0]?.file).toBe('/bin/zsh');
    expect(h.spawnCalls[0]?.args).toEqual([
      '-l',
      '-i',
      '-c',
      `case ":$PATH:" in *:'${managedBinDir}':*) ;; *) PATH='${managedBinDir}'"\${PATH:+:$PATH}" ;; esac; export PATH; claude 'do the thing'; exec '/bin/zsh' -l -i`,
    ]);
  });

  test('handleCreate threads the logger, so a POSIX terminal with no home leaves a trace', () => {
    vi.mocked(homedir).mockReturnValueOnce('');
    const warnings: Record<string, unknown>[] = [];
    const h = makeHarness({
      platform: 'linux',
      env: { SHELL: '/bin/bash', PATH: '/usr/bin' },
      shellExists: (path) => path === '/bin/bash',
      logger: { warn: (entry) => warnings.push(entry) },
    });
    h.fire(CREATE());
    expect(
      warnings,
      'buildShellEnv warns through an injected logger, so dropping `logger: deps.logger` at the handleCreate call site would silently lose the terminal-side missing-home diagnostic',
    ).toContainEqual({ event: 'pty-host-no-ok-managed-home', platform: 'linux' });
  });

  test('records the resolved shell command family on POSIX, the platform where the question has an answer', () => {
    const entries: Record<string, unknown>[] = [];
    const h = makeHarness({
      platform: 'linux',
      env: { SHELL: '/usr/bin/fish', PATH: '/usr/bin' },
      shellExists: (path) => path === '/usr/bin/fish',
      logger: { warn: () => {}, info: (entry) => entries.push(entry) },
    });

    h.fire(CREATE());

    expect(entries).toContainEqual({
      event: 'pty-host-shell-resolved',
      platform: 'linux',
      rung: 'env-shell',
      shellCommandFamily: 'fish',
    });
  });

  test('falls back to /bin/zsh when SHELL is unset', () => {
    const h = makeHarness({ env: { PATH: '/usr/bin' } });
    h.fire(CREATE());
    expect(h.spawnCalls[0]?.file).toBe('/bin/zsh');
  });

  test('honors an explicit shell override', () => {
    const h = makeHarness({ env: { SHELL: '/bin/bash' } });
    h.fire(CREATE({ cwd: '/x', cols: 10, rows: 10, shell: '/usr/bin/fish' }));
    expect(h.spawnCalls[0]?.file).toBe('/usr/bin/fish');
  });

  test('strips desktop-only env markers from the child shell env', () => {
    const h = makeHarness({
      env: {
        SHELL: '/bin/zsh',
        PATH: '/usr/bin',
        HOME: '/Users/alice',
        OK_ELECTRON_PROTOCOL_HOST: '1',
        OK_LOCK_KIND: 'interactive',
        [OK_HOSTED_AGENT_ENV]: '1',
      },
    });
    h.fire(CREATE());
    const env = h.spawnCalls[0]?.options.env ?? {};
    expect(env.OK_ELECTRON_PROTOCOL_HOST).toBeUndefined();
    expect(env.OK_LOCK_KIND).toBeUndefined();
    expect(env[OK_HOSTED_AGENT_ENV]).toBeUndefined();
    expect(env.PATH).toBe('/Users/alice/.ok/bin:/usr/bin');
  });

  test('marks the shell as the OK Desktop terminal (OK_DESKTOP_TERMINAL=1)', () => {
    const h = makeHarness({ env: { SHELL: '/bin/zsh', [OK_DESKTOP_TERMINAL_ENV]: '' } });
    h.fire(CREATE());
    const env = h.spawnCalls[0]?.options.env ?? {};
    expect(env[OK_DESKTOP_TERMINAL_ENV]).toBe('1');
  });

  test('prepends ~/.ok/bin to the child PATH so `ok` resolves regardless of rc consent', () => {
    const h = makeHarness({
      env: { SHELL: '/bin/zsh', PATH: '/usr/bin:/bin', HOME: '/Users/alice' },
    });
    h.fire(CREATE());
    const env = h.spawnCalls[0]?.options.env ?? {};
    expect(env.PATH).toBe('/Users/alice/.ok/bin:/usr/bin:/bin');
  });

  test('does not duplicate ~/.ok/bin when the parent PATH already carries it', () => {
    const h = makeHarness({
      env: {
        SHELL: '/bin/zsh',
        PATH: '/opt/x:/Users/alice/.ok/bin:/usr/bin',
        HOME: '/Users/alice',
      },
    });
    h.fire(CREATE());
    const env = h.spawnCalls[0]?.options.env ?? {};
    expect(env.PATH).toBe('/opt/x:/Users/alice/.ok/bin:/usr/bin');
  });

  test('falls back to the home the CLI installer used when the env carries no HOME', () => {
    const h = makeHarness({ env: { SHELL: '/bin/zsh', PATH: '/usr/bin' } });
    h.fire(CREATE());
    const env = h.spawnCalls[0]?.options.env ?? {};
    expect(
      env.PATH,
      'index.ts installs the CLI under osHomedir(), not process.env.HOME, so a terminal that skipped the grant here would omit a directory that exists on disk, and would disagree with the probe children that do resolve it',
    ).toBe(`${posixOkManagedBinDir(homedir())}:/usr/bin`);
  });
});

describe('setupPtyHost — streaming', () => {
  test('forwards shell output as data messages tagged with the ptyId', () => {
    const pty = makeFakePty();
    const h = makeHarness({ pty });
    h.fire(CREATE({ ptyId: 'abc' }));
    pty.emitData('hello ');
    pty.emitData('world');
    expect(h.posted).toEqual([
      { type: 'data', ptyId: 'abc', data: 'hello ' },
      { type: 'data', ptyId: 'abc', data: 'world' },
    ]);
  });

  test('writes renderer input to the pty', () => {
    const pty = makeFakePty();
    const h = makeHarness({ pty });
    h.fire(CREATE());
    h.fire({ type: 'input', ptyId: 'p1', data: 'ls -la\r' });
    expect(pty.writes).toEqual(['ls -la\r']);
  });

  test('resizes the pty', () => {
    const pty = makeFakePty();
    const h = makeHarness({ pty });
    h.fire(CREATE());
    h.fire({ type: 'resize', ptyId: 'p1', cols: 120, rows: 40 });
    expect(pty.resizes).toEqual([[120, 40]]);
  });

  test('kills the pty on a kill message', () => {
    const pty = makeFakePty();
    const h = makeHarness({ pty });
    h.fire(CREATE());
    h.fire({ type: 'kill', ptyId: 'p1' });
    expect(pty.killCount).toBe(1);
  });

  test('escalates a hung kill to SIGKILL when onExit never fires', async () => {
    const pty = makeFakePty();
    const h = makeHarness({ pty });
    h.fire(CREATE());
    h.fire({ type: 'kill', ptyId: 'p1' });
    expect(pty.killCount).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(pty.killCount).toBe(2);
    expect(pty.killSignals).toEqual([undefined, 'SIGKILL']);
  });

  test('cancels SIGKILL escalate after onExit', async () => {
    const pty = makeFakePty();
    const h = makeHarness({ pty });
    h.fire(CREATE());
    h.fire({ type: 'kill', ptyId: 'p1' });
    pty.emitExit({ exitCode: 0 });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(pty.killCount).toBe(1);
  });

  test('does not escalate SIGKILL after killActiveSessions', async () => {
    const pty = makeFakePty();
    const h = makeHarness({ pty });
    h.fire(CREATE());
    h.handle.killActive();
    expect(pty.killCount).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(pty.killCount).toBe(1);
  });

  test('logs a reap-failed warning when kill throws a non-ESRCH error', () => {
    const pty = makeFakePty();
    pty.kill = () => {
      throw Object.assign(new Error('kill EPERM'), { code: 'EPERM' });
    };
    const warnings: Record<string, unknown>[] = [];
    const h = makeHarness({ pty, logger: { warn: (o) => warnings.push(o) } });
    h.fire(CREATE());
    expect(() => h.fire({ type: 'kill', ptyId: 'p1' })).not.toThrow();
    expect(warnings).toContainEqual(
      expect.objectContaining({ event: 'pty-host-reap-failed', code: 'EPERM' }),
    );
  });

  test('routes pause/resume backpressure to the active pty', () => {
    const pty = makeFakePty();
    const h = makeHarness({ pty });
    h.fire(CREATE());
    h.fire({ type: 'pause', ptyId: 'p1' });
    h.fire({ type: 'resume', ptyId: 'p1' });
    expect(pty.pauseCount).toBe(1);
    expect(pty.resumeCount).toBe(1);
  });
});

describe('setupPtyHost — exit', () => {
  test('emits an exit message with exitCode and a null signal when none', () => {
    const pty = makeFakePty();
    const h = makeHarness({ pty });
    h.fire(CREATE({ ptyId: 'e1' }));
    pty.emitExit({ exitCode: 0, signal: undefined });
    expect(h.posted.at(-1)).toEqual({ type: 'exit', ptyId: 'e1', exitCode: 0, signal: null });
  });

  test('passes the signal through on a signal-killed exit (crash)', () => {
    const pty = makeFakePty();
    const h = makeHarness({ pty });
    h.fire(CREATE({ ptyId: 'e2' }));
    pty.emitExit({ exitCode: 0, signal: 9 });
    expect(h.posted.at(-1)).toEqual({ type: 'exit', ptyId: 'e2', exitCode: 0, signal: 9 });
  });

  test('forwards an undefined native exitCode for main-side normalization', () => {
    const pty = makeFakePty();
    const h = makeHarness({ pty });
    h.fire(CREATE({ ptyId: 'race' }));
    pty.emitExit({ exitCode: undefined });

    expect(h.posted.at(-1)).toEqual({
      type: 'exit',
      ptyId: 'race',
      exitCode: undefined,
      signal: null,
    });
  });

  test('a dead pty does not forward late data (active-id guard)', () => {
    const pty = makeFakePty();
    const h = makeHarness({ pty });
    h.fire(CREATE({ ptyId: 'g1' }));
    pty.emitExit({ exitCode: 0 });
    const before = h.posted.length;
    pty.emitData('straggler bytes');
    expect(h.posted.length).toBe(before);
  });
});

describe('setupPtyHost — session that ends before its shell attached', () => {
  const WINDOWS_HOST = {
    platform: 'darwin',
    env: { SHELL: '/bin/zsh' },
    shellExists: () => false,
  } as const;
  const endings = (posted: PtyHostOutgoingMessage[]) =>
    posted.filter((message) => message.type === 'exit' || message.type === 'spawn-error');

  test('a pty that exits while still reporting pid 0 is reported as never started', () => {
    const pty = Object.assign(makeFakePty(), { pid: 0 });
    const h = makeHarness({ pty, ...WINDOWS_HOST });
    h.fire(CREATE({ ptyId: 'unattached', cwd: 'C:\\project' }));
    pty.emitExit({ exitCode: -1, signal: undefined });

    expect(endings(h.posted)).toEqual([
      { type: 'spawn-error', ptyId: 'unattached', shellNeverAttached: true, exitCode: -1 },
    ]);
  });

  test('a pty whose shell attached and then exited -1 without output is still a shell exit', () => {
    const pty = makeFakePty();
    const h = makeHarness({ pty, ...WINDOWS_HOST });
    h.fire(CREATE({ ptyId: 'attached', cwd: 'C:\\project' }));
    pty.emitExit({ exitCode: -1, signal: undefined });

    expect(endings(h.posted)).toEqual([
      { type: 'exit', ptyId: 'attached', exitCode: -1, signal: null },
    ]);
  });

  test('a never-attached pty that ends during shutdown still lets the host exit', () => {
    const pty = Object.assign(makeFakePty(), { pid: 0 });
    const exitHost = vi.fn();
    const h = makeHarness({ pty, exitHost, ...WINDOWS_HOST });
    h.fire(CREATE({ ptyId: 'unattached', cwd: 'C:\\project' }));
    h.fire({ type: 'shutdown' });
    expect(exitHost).not.toHaveBeenCalled();

    pty.emitExit({ exitCode: -1, signal: undefined });

    expect(exitHost).toHaveBeenCalledTimes(1);
    expect(exitHost).toHaveBeenCalledWith(0);
  });
});

describe('setupPtyHost — containment (AC5: host survives a PTY failure)', () => {
  test('a synchronous spawn throw surfaces as spawn-error, not a crash', () => {
    const spawn: SpawnPty = () => {
      throw Object.assign(new Error('EMFILE: too many open files'), { code: 'EMFILE' });
    };
    const h = makeHarness({ spawn });
    expect(() => h.fire(CREATE())).not.toThrow();
    expect(h.posted).toEqual([
      { type: 'spawn-error', ptyId: 'p1', message: 'EMFILE: too many open files' },
    ]);
  });

  test('a non-Error spawn throw still surfaces a string spawn-error message', () => {
    const spawn: SpawnPty = () => {
      throw 'EMFILE: too many open files';
    };
    const h = makeHarness({ spawn });
    h.fire(CREATE());
    expect(h.posted).toEqual([
      { type: 'spawn-error', ptyId: 'p1', message: 'EMFILE: too many open files' },
    ]);
  });

  test('the host keeps routing after a spawn failure', () => {
    const goodPty = makeFakePty();
    let calls = 0;
    const spawn: SpawnPty = () => {
      calls += 1;
      if (calls === 1) throw new Error('spawn blew up');
      return goodPty;
    };
    const h = makeHarness({ spawn });
    h.fire(CREATE({ ptyId: 'bad' }));
    h.fire(CREATE({ ptyId: 'good' }));
    goodPty.emitData('alive');
    expect(h.posted).toContainEqual({ type: 'data', ptyId: 'good', data: 'alive' });
  });

  test('swallows an ESRCH from killing an already-exited pty', () => {
    const pty = makeFakePty();
    pty.killThrows = true;
    const h = makeHarness({ pty });
    h.fire(CREATE());
    expect(() => h.fire({ type: 'kill', ptyId: 'p1' })).not.toThrow();
    expect(pty.killCount).toBe(1);
  });
});

describe('setupPtyHost — addressing', () => {
  test('ignores input/resize/kill/pause/resume for an unknown ptyId', () => {
    const pty = makeFakePty();
    const h = makeHarness({ pty });
    h.fire(CREATE({ ptyId: 'real' }));
    h.fire({ type: 'input', ptyId: 'ghost', data: 'x' });
    h.fire({ type: 'resize', ptyId: 'ghost', cols: 1, rows: 1 });
    h.fire({ type: 'kill', ptyId: 'ghost' });
    h.fire({ type: 'pause', ptyId: 'ghost' });
    h.fire({ type: 'resume', ptyId: 'ghost' });
    expect(pty.writes).toEqual([]);
    expect(pty.resizes).toEqual([]);
    expect(pty.killCount).toBe(0);
    expect(pty.pauseCount).toBe(0);
    expect(pty.resumeCount).toBe(0);
  });

  test('killActive reaps the live pty (window-close / quit)', () => {
    const pty = makeFakePty();
    const h = makeHarness({ pty });
    h.fire(CREATE());
    h.handle.killActive();
    expect(pty.killCount).toBe(1);
    h.handle.killActive();
    expect(pty.killCount).toBe(1);
  });

  test('a create reusing a live ptyId reaps the stale shell before replacing it (no orphan)', () => {
    const first = makeFakePty();
    const second = makeFakePty();
    const ptys = [first, second];
    let n = 0;
    const spawn: SpawnPty = () => ptys[n++] ?? makeFakePty();
    const h = makeHarness({ spawn });

    h.fire(CREATE({ ptyId: 'dup' }));
    expect(first.killCount).toBe(0);
    h.fire(CREATE({ ptyId: 'dup' }));
    expect(first.killCount).toBe(1);

    second.emitData('alive');
    expect(h.posted).toContainEqual({ type: 'data', ptyId: 'dup', data: 'alive' });
    const before = h.posted.length;
    first.emitData('orphan');
    expect(h.posted.length).toBe(before);
  });
});

describe('setupPtyHost — concurrent sessions', () => {
  function makeMultiHarness(ptys: FakePty[]): Harness {
    let n = 0;
    const spawn: SpawnPty = () => ptys[n++] ?? makeFakePty();
    return makeHarness({ spawn });
  }

  test('a second create with a new id adds a session and leaves the first running', () => {
    const a = makeFakePty();
    const b = makeFakePty();
    const h = makeMultiHarness([a, b]);
    h.fire(CREATE({ ptyId: 'a' }));
    h.fire(CREATE({ ptyId: 'b' }));
    expect(a.killCount).toBe(0);
    expect(b.killCount).toBe(0);
    a.emitData('a-still-here');
    expect(h.posted).toContainEqual({ type: 'data', ptyId: 'a', data: 'a-still-here' });
  });

  test('both sessions stream concurrently, each tagged with its own ptyId', () => {
    const a = makeFakePty();
    const b = makeFakePty();
    const h = makeMultiHarness([a, b]);
    h.fire(CREATE({ ptyId: 'a' }));
    h.fire(CREATE({ ptyId: 'b' }));
    a.emitData('from-a');
    b.emitData('from-b');
    expect(h.posted).toContainEqual({ type: 'data', ptyId: 'a', data: 'from-a' });
    expect(h.posted).toContainEqual({ type: 'data', ptyId: 'b', data: 'from-b' });
  });

  test('input/resize/kill/pause/resume each act only on the addressed session', () => {
    const a = makeFakePty();
    const b = makeFakePty();
    const h = makeMultiHarness([a, b]);
    h.fire(CREATE({ ptyId: 'a' }));
    h.fire(CREATE({ ptyId: 'b' }));

    h.fire({ type: 'input', ptyId: 'a', data: 'ls\r' });
    h.fire({ type: 'resize', ptyId: 'b', cols: 100, rows: 30 });
    h.fire({ type: 'pause', ptyId: 'a' });
    h.fire({ type: 'resume', ptyId: 'b' });
    h.fire({ type: 'kill', ptyId: 'a' });

    expect(a.writes).toEqual(['ls\r']);
    expect(b.writes).toEqual([]);
    expect(b.resizes).toEqual([[100, 30]]);
    expect(a.resizes).toEqual([]);
    expect(a.pauseCount).toBe(1);
    expect(b.pauseCount).toBe(0);
    expect(b.resumeCount).toBe(1);
    expect(a.resumeCount).toBe(0);
    expect(a.killCount).toBe(1);
    expect(b.killCount).toBe(0);
  });

  test('one session exiting removes only its entry and leaves the other running', () => {
    const a = makeFakePty();
    const b = makeFakePty();
    const h = makeMultiHarness([a, b]);
    h.fire(CREATE({ ptyId: 'a' }));
    h.fire(CREATE({ ptyId: 'b' }));

    a.emitExit({ exitCode: 0 });
    expect(h.posted).toContainEqual({ type: 'exit', ptyId: 'a', exitCode: 0, signal: null });

    const before = h.posted.length;
    a.emitData('straggler');
    expect(h.posted.length).toBe(before);
    b.emitData('still-alive');
    expect(h.posted).toContainEqual({ type: 'data', ptyId: 'b', data: 'still-alive' });

    h.fire({ type: 'input', ptyId: 'b', data: 'x' });
    expect(b.writes).toEqual(['x']);
  });

  test('killActive reaps every session in the map (window/quit reap)', () => {
    const a = makeFakePty();
    const b = makeFakePty();
    const c = makeFakePty();
    const h = makeMultiHarness([a, b, c]);
    h.fire(CREATE({ ptyId: 'a' }));
    h.fire(CREATE({ ptyId: 'b' }));
    h.fire(CREATE({ ptyId: 'c' }));

    h.handle.killActive();
    expect(a.killCount).toBe(1);
    expect(b.killCount).toBe(1);
    expect(c.killCount).toBe(1);

    h.handle.killActive();
    expect(a.killCount).toBe(1);
    expect(b.killCount).toBe(1);
    expect(c.killCount).toBe(1);
  });

  test('killActive keeps reaping after one session throws ESRCH (already exited)', () => {
    const a = makeFakePty();
    a.killThrows = true;
    const b = makeFakePty();
    const h = makeMultiHarness([a, b]);
    h.fire(CREATE({ ptyId: 'a' }));
    h.fire(CREATE({ ptyId: 'b' }));
    expect(() => h.handle.killActive()).not.toThrow();
    expect(a.killCount).toBe(1);
    expect(b.killCount).toBe(1);
  });

  test('an internal shutdown message reaps every session and exits once', () => {
    const a = makeFakePty();
    const b = makeFakePty();
    const ptys = [a, b];
    const exitCodes: number[] = [];
    let flushCount = 0;
    let n = 0;
    const h = makeHarness({
      spawn: () => ptys[n++] ?? makeFakePty(),
      exitHost: (code) => exitCodes.push(code),
      flushLogger: () => {
        flushCount += 1;
      },
    });
    h.fire(CREATE({ ptyId: 'a' }));
    h.fire(CREATE({ ptyId: 'b' }));

    h.fireRaw({ type: 'shutdown' });
    expect(a.killCount).toBe(1);
    expect(b.killCount).toBe(1);
    expect(exitCodes).toEqual([]);

    a.emitExit({ exitCode: 0 });
    expect(exitCodes).toEqual([]);
    b.emitExit({ exitCode: 0 });
    expect(exitCodes).toEqual([0]);
    expect(flushCount).toBe(1);

    h.fireRaw({ type: 'shutdown' });
    expect(a.killCount).toBe(1);
    expect(b.killCount).toBe(1);
    expect(exitCodes).toEqual([0]);
    expect(flushCount).toBe(1);
  });

  test('shutdown exits on the host-local deadline when a deferred kill never exits', async () => {
    const pty = makeFakePty();
    const exitCodes: number[] = [];
    const warnings: Record<string, unknown>[] = [];
    const h = makeHarness({
      pty,
      shutdownMs: 1,
      exitHost: (code) => exitCodes.push(code),
      logger: { warn: (event) => warnings.push(event) },
    });
    h.fire(CREATE());

    h.fireRaw({ type: 'shutdown' });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(pty.killCount).toBe(1);
    expect(exitCodes).toEqual([0]);
    expect(warnings).toContainEqual({ event: 'pty-host-shutdown-deadline', remaining: 1 });
  });
});

describe('setupPtyHost — incoming message validation (asIncomingMessage guard)', () => {
  function makeLogger() {
    const warnings: Array<Record<string, unknown>> = [];
    return { warn: (o: Record<string, unknown>) => warnings.push(o), warnings };
  }

  test('drops a message with a missing ptyId (no spawn, warns) so it cannot defeat the active-id guard', () => {
    const logger = makeLogger();
    const h = makeHarness({ logger });
    h.fireRaw({ type: 'create', cwd: '/x', cols: 80, rows: 24 });
    expect(h.spawnCalls).toHaveLength(0);
    expect(logger.warnings.length).toBeGreaterThan(0);
  });

  test('drops a message with an empty-string ptyId', () => {
    const logger = makeLogger();
    const h = makeHarness({ logger });
    h.fireRaw({ type: 'input', ptyId: '', data: 'x' });
    expect(logger.warnings.length).toBeGreaterThan(0);
  });

  test('a null or non-object message does not throw and is dropped', () => {
    const logger = makeLogger();
    const h = makeHarness({ logger });
    expect(() => h.fireRaw(null)).not.toThrow();
    expect(() => h.fireRaw('garbage')).not.toThrow();
    expect(h.spawnCalls).toHaveLength(0);
    expect(logger.warnings.length).toBeGreaterThan(0);
  });

  test('accepts a create with a string launchCommand and bakes it', () => {
    const h = makeHarness();
    h.fireRaw({
      type: 'create',
      ptyId: 'p1',
      cwd: '/x',
      cols: 80,
      rows: 24,
      launchCommand: "x 'y'",
    });
    expect(h.spawnCalls).toHaveLength(1);
    const [managedBinDir] = buildShellEnv({}, { platform: 'darwin' }).managedBinDirs;
    expect(managedBinDir).toBeDefined();
    expect(h.spawnCalls[0]?.args).toEqual([
      '-l',
      '-i',
      '-c',
      `case ":$PATH:" in *:'${managedBinDir}':*) ;; *) PATH='${managedBinDir}'"\${PATH:+:$PATH}" ;; esac; export PATH; x 'y'; exec '/bin/zsh' -l -i`,
    ]);
  });

  test('accepts a structured POSIX launch, quotes its argv and hands its env to the login alone', () => {
    const h = makeHarness();
    h.fireRaw({
      type: 'create',
      ptyId: 'p1',
      cwd: '/x',
      cols: 80,
      rows: 24,
      launchCommand: {
        executable: '/rt/bin/npx',
        args: ['-y', '@augmentcode/auggie@1.2.3', '--acp', 'login'],
        env: { AUGGIE_LOGIN_FLOW: 'terminal' },
        pathPrepend: ['/rt/bin'],
      },
    });
    expect(h.spawnCalls).toHaveLength(1);
    const [managedBinDir] = buildShellEnv({}, { platform: 'darwin' }).managedBinDirs;
    expect(h.spawnCalls[0]?.args).toEqual([
      '-l',
      '-i',
      '-c',
      `case ":$PATH:" in *:'${managedBinDir}':*) ;; *) PATH='${managedBinDir}'"\${PATH:+:$PATH}" ;; esac; case ":$PATH:" in *:'/rt/bin':*) ;; *) PATH='/rt/bin'"\${PATH:+:$PATH}" ;; esac; export PATH; (export AUGGIE_LOGIN_FLOW="$OK_TERMINAL_LAUNCH_ENV_0"; exec '/rt/bin/npx' '-y' '@augmentcode/auggie@1.2.3' '--acp' 'login'); unset OK_TERMINAL_LAUNCH_ENV_0; exec '/bin/zsh' -l -i`,
    ]);
    expect(h.spawnCalls[0]?.options.env?.OK_TERMINAL_LAUNCH_ENV_0).toBe('terminal');
    expect(h.spawnCalls[0]?.options.env).not.toHaveProperty('AUGGIE_LOGIN_FLOW');
    expect(h.spawnCalls[0]?.args).not.toContain('terminal');
    expect(h.spawnCalls[0]?.options.env?.PATH).not.toContain('/rt/bin');
  });

  test('drops a structured launch whose env names, values or PATH dirs are malformed', () => {
    const h = makeHarness();
    h.fireRaw({
      type: 'create',
      ptyId: 'p1',
      cwd: '/x',
      cols: 80,
      rows: 24,
      launchCommand: { executable: 'agent', args: ['login'], env: { A: 1 } },
    });
    h.fireRaw({
      type: 'create',
      ptyId: 'p3',
      cwd: '/x',
      cols: 80,
      rows: 24,
      launchCommand: { executable: 'agent', args: ['login'], env: { '--split-string': 'x' } },
    });
    h.fireRaw({
      type: 'create',
      ptyId: 'p5',
      cwd: '/x',
      cols: 80,
      rows: 24,
      launchCommand: {
        executable: 'agent',
        args: ['login'],
        env: { OK_TERMINAL_LAUNCH_ENV_0: 'the slot the launch itself uses' },
      },
    });
    h.fireRaw({
      type: 'create',
      ptyId: 'p4',
      cwd: '/x',
      cols: 80,
      rows: 24,
      launchCommand: {
        executable: 'agent',
        args: ['login'],
        env: { OK: `a${String.fromCharCode(0)}b` },
      },
    });
    h.fireRaw({
      type: 'create',
      ptyId: 'p2',
      cwd: '/x',
      cols: 80,
      rows: 24,
      launchCommand: { executable: 'agent', args: ['login'], pathPrepend: [''] },
    });
    expect(h.spawnCalls).toHaveLength(0);
  });

  test('drops a create whose launchCommand has neither supported shape', () => {
    const logger = makeLogger();
    const h = makeHarness({ logger });
    h.fireRaw({ type: 'create', ptyId: 'p1', cwd: '/x', cols: 80, rows: 24, launchCommand: 123 });
    expect(h.spawnCalls).toHaveLength(0);
    expect(logger.warnings.length).toBeGreaterThan(0);
  });

  test('an unknown message type lands in the default warn branch (forward-compat)', () => {
    const logger = makeLogger();
    const h = makeHarness({ logger });
    h.fireRaw({ type: 'bogus-future-type', ptyId: 'p1' });
    expect(h.spawnCalls).toHaveLength(0);
    expect(logger.warnings.length).toBeGreaterThan(0);
  });
});

describe('buildShellArgs', () => {
  test('a plain tab follows the platform interactive-shell convention', () => {
    expect(buildShellArgs('darwin', '/bin/zsh', undefined, [])).toEqual(['-l', '-i']);
    expect(buildShellArgs('darwin', '/bin/zsh', '', [])).toEqual(['-l', '-i']);
    expect(buildShellArgs('linux', '/bin/bash', undefined, [])).toEqual(['-i']);
    expect(buildShellArgs('linux', '/bin/bash', '', [])).toEqual(['-i']);
  });

  test('a macOS launch keeps login flags in the launcher and exec tail', () => {
    expect(buildShellArgs('darwin', '/bin/zsh', "codex 'hi'", [])).toEqual([
      '-l',
      '-i',
      '-c',
      "codex 'hi'; exec '/bin/zsh' -l -i",
    ]);
  });

  test('a Linux launch is interactive without forcing login semantics', () => {
    expect(buildShellArgs('linux', '/bin/bash', "codex 'hi'", [])).toEqual([
      '-i',
      '-c',
      "codex 'hi'; exec '/bin/bash' -i",
    ]);
  });

  test('reasserts the managed bin dir in the launched CLI command on macOS', () => {
    expect(buildShellArgs('darwin', '/bin/zsh', "codex 'hi'", ['/managed/bin'])).toEqual([
      '-l',
      '-i',
      '-c',
      // biome-ignore lint/suspicious/noTemplateCurlyInString: shell parameter expansion in an expected command string, not a JS template placeholder
      "case \":$PATH:\" in *:'/managed/bin':*) ;; *) PATH='/managed/bin'\"${PATH:+:$PATH}\" ;; esac; export PATH; codex 'hi'; exec '/bin/zsh' -l -i",
    ]);
  });

  test('reasserts the managed bin dir in the launched CLI command on Linux', () => {
    expect(buildShellArgs('linux', '/bin/bash', 'claude', ['/managed/bin'])).toEqual([
      '-i',
      '-c',
      // biome-ignore lint/suspicious/noTemplateCurlyInString: shell parameter expansion in an expected command string, not a JS template placeholder
      "case \":$PATH:\" in *:'/managed/bin':*) ;; *) PATH='/managed/bin'\"${PATH:+:$PATH}\" ;; esac; export PATH; claude; exec '/bin/bash' -i",
    ]);
  });

  test('a structured POSIX launch reasserts its own dirs ahead of the managed ones', () => {
    expect(
      buildShellArgs(
        'linux',
        '/bin/bash',
        { executable: '/rt/bin/npx', args: ['-y', 'pkg@1', 'login'], pathPrepend: ['/rt/bin'] },
        ['/managed/bin'],
      ),
    ).toEqual([
      '-i',
      '-c',
      // biome-ignore lint/suspicious/noTemplateCurlyInString: shell parameter expansion in an expected command string, not a JS template placeholder
      "case \":$PATH:\" in *:'/managed/bin':*) ;; *) PATH='/managed/bin'\"${PATH:+:$PATH}\" ;; esac; case \":$PATH:\" in *:'/rt/bin':*) ;; *) PATH='/rt/bin'\"${PATH:+:$PATH}\" ;; esac; export PATH; '/rt/bin/npx' '-y' 'pkg@1' 'login'; exec '/bin/bash' -i",
    ]);
  });

  test('several env values map each slot onto the same name in the script and in the spawn env', () => {
    const h = makeHarness();
    const env = { ZDOTDIR: '/agent/zdot', AUGGIE_HOME: '/agent/home' };
    h.fireRaw({
      type: 'create',
      ptyId: 'p1',
      cwd: '/x',
      cols: 80,
      rows: 24,
      launchCommand: { executable: 'agent', args: ['login'], env },
    });
    const call = h.spawnCalls[0];
    if (!call) throw new Error('no spawn');
    const script = call.args[3] ?? '';
    expect(script).toContain(
      `(export ZDOTDIR="$OK_TERMINAL_LAUNCH_ENV_0" AUGGIE_HOME="$OK_TERMINAL_LAUNCH_ENV_1"; exec agent 'login'); unset OK_TERMINAL_LAUNCH_ENV_0 OK_TERMINAL_LAUNCH_ENV_1; exec`,
    );
    const pairs = [...script.matchAll(/(\w+)="\$(OK_TERMINAL_LAUNCH_ENV_\d+)"/g)].map((match) => [
      match[1] ?? '',
      match[2] ?? '',
    ]);
    expect(pairs).toEqual([
      ['ZDOTDIR', 'OK_TERMINAL_LAUNCH_ENV_0'],
      ['AUGGIE_HOME', 'OK_TERMINAL_LAUNCH_ENV_1'],
    ]);
    for (const [name, slot] of pairs) {
      expect(call.options.env?.[slot]).toBe(env[name as keyof typeof env]);
      expect(call.options.env).not.toHaveProperty(name);
    }
  });

  test('a structured launch under fish uses fish quoting for every argument', () => {
    expect(
      buildShellArgs(
        'linux',
        '/usr/bin/fish',
        { executable: 'agent', args: ["it\\'s", 'trailing\\'], env: { A: "x'y" } },
        [],
      ),
    ).toEqual([
      '-i',
      '-c',
      `begin; set -lx A "$OK_TERMINAL_LAUNCH_ENV_0"; agent 'it\\\\\\'s' 'trailing\\\\'; end; set -e OK_TERMINAL_LAUNCH_ENV_0; exec '/usr/bin/fish' -i`,
    ]);
  });

  test('a structured launch leaves a bare command name unquoted so shell aliases still resolve', () => {
    expect(
      buildShellArgs(
        'darwin',
        '/bin/zsh',
        { executable: 'claude', args: ['--settings', '{}'] },
        [],
      ),
    ).toEqual(['-l', '-i', '-c', "claude '--settings' '{}'; exec '/bin/zsh' -l -i"]);
  });

  test('a structured launch quotes an executable that is a path or carries shell syntax', () => {
    for (const executable of ['/opt/my tools/claude', '$(touch pwned)', '-claude', 'a;b']) {
      const script = buildShellArgs('darwin', '/bin/zsh', { executable, args: [] }, [])[3];
      expect(script).toBe(`${shellSingleQuote(executable)}; exec '/bin/zsh' -l -i`);
    }
    expect(buildShellArgs('linux', '/usr/bin/fish', { executable: "o'k\\", args: [] }, [])[2]).toBe(
      "'o\\'k\\\\'; exec '/usr/bin/fish' -i",
    );
  });

  test('uses fish list syntax for the reassert when the terminal shell is fish', () => {
    expect(buildShellArgs('linux', '/usr/bin/fish', 'claude', ['/managed/bin'])).toEqual([
      '-i',
      '-c',
      "if not contains '/managed/bin' $PATH; set -gx PATH '/managed/bin' $PATH; end; claude; exec '/usr/bin/fish' -i",
    ]);
  });

  test('a host with no grantable managed dir composes exactly the pre-reassert argv', () => {
    expect(buildShellArgs('darwin', '/bin/zsh', "codex 'hi'", [])).toEqual([
      '-l',
      '-i',
      '-c',
      "codex 'hi'; exec '/bin/zsh' -l -i",
    ]);
  });

  test('a plain interactive tab is never reasserted, so typed commands keep the user PATH order', () => {
    expect(buildShellArgs('darwin', '/bin/zsh', undefined, ['/managed/bin'])).toEqual(['-l', '-i']);
    expect(buildShellArgs('linux', '/bin/bash', undefined, ['/managed/bin'])).toEqual(['-i']);
  });

  test('single-quotes the shell path in the exec tail (space/quote-safe)', () => {
    expect(buildShellArgs('linux', "/odd path/o'sh", "claude 'x'", [])).toEqual([
      '-i',
      '-c',
      "claude 'x'; exec '/odd path/o'\\''sh' -i",
    ]);
    expect(buildShellArgs('darwin', "/odd path/o'sh", "claude 'x'", [])).toEqual([
      '-l',
      '-i',
      '-c',
      "claude 'x'; exec '/odd path/o'\\''sh' -l -i",
    ]);
  });
});

describe('buildShellEnv', () => {
  test('strips markers, drops undefined, preserves the rest, marks the desktop terminal', () => {
    const { env } = buildShellEnv({
      PATH: '/usr/bin',
      HOME: '/Users/x',
      OK_ELECTRON_PROTOCOL_HOST: '1',
      OK_LOCK_KIND: 'interactive',
      ELECTRON_RUN_AS_NODE: '1',
      GDK_PIXBUF_MODULEDIR: '/app/lib/gdk-pixbuf',
      GDK_PIXBUF_MODULE_FILE: '/app/lib/loaders.cache',
      ELECTRON_TRASH: 'gio',
      GDK_THEME: 'Adwaita',
      MAYBE: undefined,
    });
    expect(env).toEqual({
      PATH: '/Users/x/.ok/bin:/usr/bin',
      HOME: '/Users/x',
      ELECTRON_TRASH: 'gio',
      GDK_THEME: 'Adwaita',
      [OK_DESKTOP_TERMINAL_ENV]: '1',
    });
  });
});

describe('resolveShell', () => {
  const shellExists = (paths: string[]) => (path: string) => paths.includes(path);

  test('macOS preserves override, $SHELL, and zsh fallback behavior', () => {
    expect(
      resolveShell({ SHELL: '/bin/bash' }, { platform: 'darwin', override: '/usr/bin/fish' }),
    ).toBe('/usr/bin/fish');
    expect(resolveShell({ SHELL: '/bin/bash' }, { platform: 'darwin' })).toBe('/bin/bash');
    expect(resolveShell({}, { platform: 'darwin' })).toBe('/bin/zsh');
    expect(resolveShell({ SHELL: '' }, { platform: 'darwin' })).toBe('/bin/zsh');
  });

  test('Linux prefers $SHELL, then the passwd shell', () => {
    expect(
      resolveShell(
        { SHELL: '/usr/bin/fish' },
        {
          platform: 'linux',
          userInfoShell: () => '/bin/zsh',
          shellExists: shellExists(['/usr/bin/fish', '/bin/zsh']),
        },
      ),
    ).toBe('/usr/bin/fish');
    expect(
      resolveShell(
        { SHELL: '' },
        {
          platform: 'linux',
          userInfoShell: () => '/bin/zsh',
          shellExists: shellExists(['/bin/zsh']),
        },
      ),
    ).toBe('/bin/zsh');
  });

  test('Linux treats false-style and nonexistent configured shells as unset', () => {
    for (const configuredShell of [
      '/bin/false',
      '/usr/bin/false',
      '/usr/sbin/nologin',
      '/missing',
    ]) {
      expect(
        resolveShell(
          { SHELL: configuredShell },
          {
            platform: 'linux',
            userInfoShell: () => '/bin/fish',
            shellExists: shellExists(['/bin/fish']),
          },
        ),
      ).toBe('/bin/fish');
    }
  });

  test('Linux falls back through bash to sh when passwd lookup is absent', () => {
    expect(
      resolveShell(
        {},
        {
          platform: 'linux',
          userInfoShell: () => null,
          shellExists: shellExists(['/bin/bash', '/bin/sh']),
        },
      ),
    ).toBe('/bin/bash');
    expect(
      resolveShell(
        {},
        {
          platform: 'linux',
          userInfoShell: () => null,
          shellExists: shellExists(['/bin/sh']),
        },
      ),
    ).toBe('/bin/sh');
  });

  test('Linux logs and falls back when passwd lookup throws', () => {
    const warnings: Record<string, unknown>[] = [];

    expect(
      resolveShell(
        {},
        {
          platform: 'linux',
          userInfoShell: () => {
            throw Object.assign(new Error('no passwd entry'), { code: 'ENOENT' });
          },
          shellExists: shellExists(['/bin/bash', '/bin/sh']),
          logger: { warn: (data) => warnings.push(data) },
        },
      ),
    ).toBe('/bin/bash');
    expect(warnings).toContainEqual({
      event: 'pty-host-user-info-shell-failed',
      code: 'ENOENT',
    });
  });

  test('Linux ignores a false-style passwd shell before falling back', () => {
    expect(
      resolveShell(
        {},
        {
          platform: 'linux',
          userInfoShell: () => '/bin/false',
          shellExists: shellExists(['/bin/false', '/bin/bash', '/bin/sh']),
        },
      ),
    ).toBe('/bin/bash');
  });
});

describe('node-pty import failure', () => {
  test('a Linux-capable host replies to create with the existing spawn-error contract', () => {
    expect(isTerminalPlatform('linux')).toBe(true);

    let handler = null as ((event: { data: unknown }) => void) | null;
    const posted: PtyHostOutgoingMessage[] = [];
    const warnings: Array<{ data: Record<string, unknown>; message: string }> = [];
    installPtyImportFailureReply(
      {
        on(_event, nextHandler) {
          handler = nextHandler;
        },
        postMessage(message) {
          posted.push(message);
        },
      },
      new Error('node-pty Linux prebuild could not be loaded'),
      {
        warn(data, message) {
          warnings.push({ data, message });
        },
      },
    );

    handler?.({
      data: {
        type: 'create',
        ptyId: 'linux-pty',
        cwd: '/project',
        cols: 80,
        rows: 24,
      },
    });

    expect(posted).toEqual([
      {
        type: 'spawn-error',
        ptyId: 'linux-pty',
        message: 'node-pty Linux prebuild could not be loaded',
      },
    ]);
    expect(warnings).toEqual([
      {
        data: {
          event: 'pty-host-import-failed',
          error: 'node-pty Linux prebuild could not be loaded',
        },
        message: 'node-pty import failed',
      },
    ]);
  });
});

class FakeReapProcess implements HostReapProcess {
  exitCodes: number[] = [];
  private readonly listeners = new Map<string, Array<() => void>>();
  on(event: 'exit' | NodeJS.Signals, listener: () => void): void {
    const arr = this.listeners.get(event) ?? [];
    arr.push(listener);
    this.listeners.set(event, arr);
  }
  exit(code?: number): void {
    this.exitCodes.push(code ?? 0);
  }
  emit(event: 'exit' | NodeJS.Signals): void {
    for (const listener of this.listeners.get(event) ?? []) listener();
  }
}

function makeReapHandle(): { handle: PtyHostHandle; killCount: () => number } {
  let count = 0;
  return {
    handle: {
      killActive() {
        count += 1;
      },
    },
    killCount: () => count,
  };
}

describe('installHostReaping', () => {
  test('SIGTERM reaps the active pty and exits the host', () => {
    const { handle, killCount } = makeReapHandle();
    const proc = new FakeReapProcess();
    installHostReaping(handle, proc);
    proc.emit('SIGTERM');
    expect(killCount()).toBe(1);
    expect(proc.exitCodes).toEqual([0]);
  });

  test('SIGINT and SIGHUP also reap + exit', () => {
    for (const signal of ['SIGINT', 'SIGHUP'] as const) {
      const { handle, killCount } = makeReapHandle();
      const proc = new FakeReapProcess();
      installHostReaping(handle, proc);
      proc.emit(signal);
      expect(killCount()).toBe(1);
      expect(proc.exitCodes).toEqual([0]);
    }
  });

  test('a plain exit reaps without re-triggering exit (sync backstop)', () => {
    const { handle, killCount } = makeReapHandle();
    const proc = new FakeReapProcess();
    installHostReaping(handle, proc);
    proc.emit('exit');
    expect(killCount()).toBe(1);
    expect(proc.exitCodes).toEqual([]);
  });

  test('reaping is idempotent across multiple teardown events', () => {
    const { handle, killCount } = makeReapHandle();
    const proc = new FakeReapProcess();
    installHostReaping(handle, proc);
    proc.emit('SIGTERM');
    proc.emit('exit');
    proc.emit('SIGINT');
    expect(killCount()).toBe(1);
    expect(proc.exitCodes).toEqual([0, 0]);
  });
});

describe('buildLaunchEnv', () => {
  test('a string launch keeps the shell env as is', () => {
    const env = { PATH: '/usr/bin', A: '1' };
    expect(buildLaunchEnv(env, "codex 'hi'")).toBe(env);
  });

  test('a structured launch parks its env in slot variables and leaves PATH to the command on POSIX', () => {
    expect(
      buildLaunchEnv(
        { PATH: '/usr/bin', A: '1' },
        { executable: 'x', args: [], env: { B: '2' }, pathPrepend: ['/rt/bin'] },
      ),
    ).toEqual({ PATH: '/usr/bin', A: '1', OK_TERMINAL_LAUNCH_ENV_0: '2' });
  });

  test("a method env name never reaches the shell's startup environment", () => {
    const env = buildLaunchEnv(
      { PATH: '/usr/bin', HOME: '/Users/me' },
      {
        executable: 'agent',
        args: ['login'],
        env: { ZDOTDIR: '/tmp/agent-owned', HOME: '/tmp/agent-owned', BASH_ENV: '/tmp/x.sh' },
      },
    );
    expect(env).toEqual({
      PATH: '/usr/bin',
      HOME: '/Users/me',
      OK_TERMINAL_LAUNCH_ENV_0: '/tmp/agent-owned',
      OK_TERMINAL_LAUNCH_ENV_1: '/tmp/agent-owned',
      OK_TERMINAL_LAUNCH_ENV_2: '/tmp/x.sh',
    });
    expect(env).not.toHaveProperty('ZDOTDIR');
    expect(env).not.toHaveProperty('BASH_ENV');
  });
});
