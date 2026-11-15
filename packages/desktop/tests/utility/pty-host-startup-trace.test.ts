import { execFileSync } from 'node:child_process';
import { afterEach, expect, test, vi } from 'vitest';
import {
  type PtyHostIncomingMessage,
  type PtyProcessLike,
  type PtyStartupSpawnContext,
  type PtyStartupTraceOptions,
  setupPtyHost,
} from '../../src/utility/pty-host.ts';
import {
  createHarnessBudget,
  createPtyHostProbe,
  HARNESS_REPORT_RESERVE_MS,
  HarnessBudgetRefusal,
  harnessTimeouts,
} from '../support/pty-readiness.test-helper.ts';
import { createHarnessScenarioRunner } from '../support/pty-startup-trace.test-helper.ts';

vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  execFileSync: vi.fn(),
}));

const SHELL = '/bin/zsh';
const OUTPUT = 'terminal output';

function fixture(traceEnabled: boolean) {
  const events: Record<string, unknown>[] = [];
  let onData = (_data: string) => {};
  const pty: PtyProcessLike = {
    pid: process.pid,
    onData: (callback) => {
      onData = callback;
    },
    onExit: vi.fn(),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
  };
  const options = {
    spawn: vi.fn(() => pty),
    env: { SHELL },
    platform: 'darwin' as const,
    shellExists: (path: string) => path === SHELL,
    logger: {
      info: (entry: Record<string, unknown>) => events.push(entry),
      warn: (entry: Record<string, unknown>) => events.push(entry),
    },
    ...(traceEnabled ? { startupTrace: {} } : {}),
  };
  const host = createPtyHostProbe(options);
  host.send({ type: 'create', ptyId: 'private-session', cwd: 'C:\\private', cols: 80, rows: 24 });
  return { host, pty, events, output: (data: string) => onData(data) };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test('does not capture startup diagnostics unless the caller enables them', () => {
  vi.mocked(execFileSync).mockReturnValue(`${SHELL}\r\n`);
  const { host, events, output } = fixture(false);
  output('private terminal output');
  host.killActive();
  expect(events.filter((entry) => entry.event === 'pty-host-startup')).toEqual([]);
});

function lifecycleFixture(
  options: { trace?: boolean; aroundSpawn?: PtyStartupTraceOptions['aroundSpawn'] } = {},
) {
  const events: Record<string, unknown>[] = [];
  const sessions: Array<{
    pty: PtyProcessLike;
    output(data: string): void;
    exit(): void;
  }> = [];
  const controlObservations: Array<{ stage: unknown; reason: unknown }> = [];
  let messageHandler = (_event: { data: unknown }) => {};
  const spawn = vi.fn((_file: string, _args: string | string[]) => {
    let onData = (_data: string) => {};
    let onExit = (_event: { exitCode: number }) => {};
    const pty: PtyProcessLike = {
      pid: process.pid + sessions.length,
      onData(callback) {
        onData = callback;
      },
      onExit(callback) {
        onExit = callback;
      },
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(() => {
        controlObservations.push({ stage: events.at(-1)?.stage, reason: events.at(-1)?.reason });
      }),
      pause: vi.fn(),
      resume: vi.fn(),
    };
    sessions.push({ pty, output: (data) => onData(data), exit: () => onExit({ exitCode: 0 }) });
    return pty;
  });
  const deps = {
    parentPort: {
      on(_event: 'message', callback: (event: { data: unknown }) => void) {
        messageHandler = callback;
      },
      postMessage: vi.fn(),
    },
    spawn,
    env: { SHELL },
    platform: 'darwin' as const,
    shellExists: (path: string) => path === SHELL,
    logger: {
      warn: (entry: Record<string, unknown>) => events.push(entry),
      info: (entry: Record<string, unknown>) => events.push(entry),
    },
    ...(options.trace === false ? {} : { startupTrace: { aroundSpawn: options.aroundSpawn } }),
  };
  const handle = setupPtyHost(deps);
  const send = (data: PtyHostIncomingMessage) => messageHandler({ data });
  const create = (ptyId: string, shell?: string) =>
    send({
      type: 'create',
      ptyId,
      cwd: 'C:\\private',
      cols: 80,
      rows: 24,
      ...(shell ? { shell } : {}),
    });
  const trace = () => events.filter((entry) => entry.event === 'pty-host-startup');
  return { handle, sessions, create, send, trace, spawn, controlObservations };
}

test('startup traces distinguish platform resolution, overrides, and creates across host instances', () => {
  vi.mocked(execFileSync).mockReset().mockReturnValue(`${SHELL}\r\n`);
  const first = lifecycleFixture();
  const second = lifecycleFixture();
  try {
    first.create('first');
    first.create('cached');
    second.create('override', SHELL);
    const resolutions = [...first.trace(), ...second.trace()].filter(
      (entry) => entry.stage === 'lookup-complete',
    );
    expect(resolutions.map((entry) => entry.lookup)).toEqual(['platform', 'platform', 'override']);
    expect(new Set(resolutions.map((entry) => entry.traceId)).size).toBe(resolutions.length);
    expect(vi.mocked(execFileSync)).not.toHaveBeenCalled();
  } finally {
    first.handle.killActive();
    second.handle.killActive();
  }
});

test('startup traces keep stale output attached to the replaced session', () => {
  vi.mocked(execFileSync).mockReturnValue(`${SHELL}\r\n`);
  const host = lifecycleFixture();
  try {
    host.create('reused');
    const first = host.sessions.at(-1);
    host.create('reused');
    const second = host.sessions.at(-1);
    first?.output('old terminal contents');
    second?.output('new terminal contents');
    const starts = host.trace().filter((entry) => entry.stage === 'lookup-start');
    const receives = host.trace().filter((entry) => entry.stage === 'first-output');
    const forwards = host.trace().filter((entry) => entry.stage === 'first-forward');
    expect(receives.map((entry) => [entry.traceId, entry.currentSession])).toEqual([
      [starts.at(0)?.traceId, false],
      [starts.at(-1)?.traceId, true],
    ]);
    expect(forwards.map((entry) => entry.traceId)).toEqual([starts.at(-1)?.traceId]);
    expect(host.controlObservations).toContainEqual({
      stage: 'snapshot',
      reason: 'before-replacement',
    });
  } finally {
    host.handle.killActive();
  }
});

test.each([
  ['kill', 'before-kill'],
  ['shutdown', 'before-shutdown'],
] as const)('startup traces snapshot before %s can change owned state', (type, reason) => {
  vi.useFakeTimers();
  vi.mocked(execFileSync).mockReturnValue(`${SHELL}\r\n`);
  const host = lifecycleFixture();
  host.create('controlled');
  host.send(type === 'kill' ? { type, ptyId: 'controlled' } : { type });
  expect(host.controlObservations).toEqual([{ stage: 'snapshot', reason }]);
  host.handle.killActive();
});

test('startup traces distinguish an observed terminal exit from no exit notification', () => {
  vi.mocked(execFileSync).mockReturnValue(`${SHELL}\r\n`);
  const host = lifecycleFixture();
  host.create('exiting');
  host.sessions.at(-1)?.exit();
  expect(host.trace()).toContainEqual(
    expect.objectContaining({ stage: 'terminal-exit', exitCode: 0 }),
  );
  expect(host.trace()).toContainEqual(
    expect.objectContaining({ stage: 'snapshot', reason: 'exit', terminalExitObserved: true }),
  );
  host.handle.killActive();
});

test('startup diagnostics sample no clocks when disabled', () => {
  vi.mocked(execFileSync).mockReturnValue(`${SHELL}\r\n`);
  const now = vi.spyOn(performance, 'now');
  const host = lifecycleFixture({ trace: false });
  host.create('ordinary');
  host.sessions.at(-1)?.output('ordinary data');
  host.handle.killActive();
  expect(now).not.toHaveBeenCalled();
});

test('failure reporting can snapshot an owned session without controlling it', () => {
  vi.mocked(execFileSync).mockReturnValue(`${SHELL}\r\n`);
  const { host, pty, events, output } = fixture(true);
  output(OUTPUT);
  host.snapshotStartup();
  expect(events.at(-1)).toEqual(
    expect.objectContaining({
      stage: 'snapshot',
      reason: 'failure',
      receivedBytes: Buffer.byteLength(OUTPUT),
      forwardedBytes: Buffer.byteLength(OUTPUT),
    }),
  );
  expect(pty.kill).not.toHaveBeenCalled();
  expect(pty.write).not.toHaveBeenCalled();
  host.killActive();
});

test('late observations keep the identity of its spawn attempt', () => {
  vi.mocked(execFileSync).mockReturnValue(`${SHELL}\r\n`);
  const contexts: PtyStartupSpawnContext[] = [];
  const host = lifecycleFixture({
    aroundSpawn(next, context) {
      contexts.push(context);
      return { pty: next() };
    },
  });
  try {
    host.create('late');
    for (const context of contexts) context.emit({ stage: 'worker-error' });
    const attempts = host.trace().filter((entry) => entry.stage === 'spawn-start');
    const late = host.trace().filter((entry) => entry.stage === 'worker-error');
    expect(late.map((entry) => entry.attempt)).toEqual(attempts.map((entry) => entry.attempt));
    expect(host.spawn.mock.calls.length).toBe(contexts.length);
    const sequence = host.trace().map((entry) => entry.sequence);
    expect(new Set(sequence).size).toBe(sequence.length);
  } finally {
    host.handle.killActive();
  }
});

function harnessScenario(title: string) {
  const lines: string[] = [];
  const sessions: Array<ReturnType<typeof fixture>> = [];
  const budget = createHarnessBudget(harnessTimeouts('win32').budgetMs, HARNESS_REPORT_RESERVE_MS);
  const runner = createHarnessScenarioRunner({
    titles: [title],
    grantMs: (before) => budget.grantMs(before),
    isRefusal: (error) => error instanceof HarnessBudgetRefusal,
    print: (line) => lines.push(line),
  });
  return {
    runner,
    lines,
    openSession() {
      const session = fixture(true);
      runner.own({
        snapshot: () => session.host.snapshotStartup(),
        release: () => session.host.killActive(),
      });
      sessions.push(session);
      return session;
    },
    snapshotReasons: () =>
      sessions.map((session) =>
        session.events
          .filter((entry) => entry.event === 'pty-host-startup' && entry.stage === 'snapshot')
          .map((entry) => entry.reason),
      ),
    releases: () => sessions.map((session) => vi.mocked(session.pty.kill).mock.calls.length),
  };
}

test('a failing harness scenario snapshots its live session before releasing it', async () => {
  vi.mocked(execFileSync).mockReturnValue(`${SHELL}\r\n`);
  const scenario = harnessScenario('shell stays silent');
  await scenario.runner.run('shell stays silent', async () => {
    scenario.openSession().output(OUTPUT);
    throw new Error('shell never produced output');
  });
  expect(scenario.snapshotReasons()).toEqual([['failure', 'before-cleanup']]);
  expect(scenario.releases()).toEqual([1]);
  expect(scenario.lines).toEqual(['FAIL shell stays silent :: shell never produced output']);
});

test('a hard timeout snapshots the live session of the scenario still in flight', async () => {
  vi.mocked(execFileSync).mockReturnValue(`${SHELL}\r\n`);
  const scenario = harnessScenario('shell still starting');
  const { promise: blocked, resolve: proceed } = Promise.withResolvers<void>();
  const { promise: inFlight, resolve: started } = Promise.withResolvers<void>();
  const running = scenario.runner.run('shell still starting', async () => {
    scenario.openSession().output(OUTPUT);
    started();
    await blocked;
  });
  await inFlight;
  const verdict = scenario.runner.hardTimeoutVerdict();
  const atTimeout = scenario.snapshotReasons();
  proceed();
  await running;
  expect(verdict).toBe(
    'HARNESS_RESULT ok=0 fail=1 refused=0 :: hard timeout during shell still starting',
  );
  expect(atTimeout).toEqual([['failure']]);
  expect(scenario.snapshotReasons()).toEqual([['failure', 'before-cleanup']]);
});

test('a passing harness scenario releases its session without a failure snapshot', async () => {
  vi.mocked(execFileSync).mockReturnValue(`${SHELL}\r\n`);
  const scenario = harnessScenario('shell answers');
  await scenario.runner.run('shell answers', async () => {
    scenario.openSession().output(OUTPUT);
  });
  expect(scenario.snapshotReasons()).toEqual([['before-cleanup']]);
  expect(scenario.releases()).toEqual([1]);
  expect(scenario.lines).toEqual(['PASS shell answers']);
});
