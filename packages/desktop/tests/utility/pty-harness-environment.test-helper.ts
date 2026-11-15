import { readFileSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';
import { vi } from 'vitest';
import type { PtyProcessLike, SpawnPty } from '../../src/utility/pty-host.ts';

export interface ControlledHarnessOptions {
  firstScenario: 'fast';
  platform?: 'darwin' | 'linux';
  phase?: 'posix-late-quiet' | 'posix-unstable-quiet';
  budgetOverride?: string;
}

export interface ControlledHarnessResult {
  exitCode: Parameters<typeof process.exit>[0];
  lines: string[];
  events: Array<{ shell: number; event: string; at: number; trace?: Record<string, unknown> }>;
  traceEvents: Record<string, unknown>[];
}

export async function runControlledHarness(
  options: ControlledHarnessOptions,
): Promise<ControlledHarnessResult> {
  const result: ControlledHarnessResult = {
    exitCode: undefined,
    lines: [],
    events: [],
    traceEvents: [],
  };
  const dirs: string[] = [];
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');
  if (platformDescriptor === undefined) throw new Error('process.platform is unavailable');
  const platform = options.platform ?? 'linux';
  let shellCount = 0;
  const record = (shell: number, event: string, trace?: Record<string, unknown>): void => {
    result.events.push({ shell, event, at: performance.now(), ...(trace ? { trace } : {}) });
  };
  const spawn: SpawnPty = (file, _args, spawnOptions): PtyProcessLike => {
    if (file.includes('no-such-shell-xyz')) throw new Error('file not found');
    const shell = ++shellCount;
    const spawnedAt = performance.now();
    let dataListener: (data: string) => void = () => undefined;
    let exitListener: Parameters<PtyProcessLike['onExit']>[0] = () => undefined;
    let closed = false;
    const ownedTimers = new Set<ReturnType<typeof setTimeout>>();
    const later = (delay: number, action: () => void): void => {
      const timer = setTimeout(() => {
        timers.delete(timer);
        ownedTimers.delete(timer);
        if (!closed) action();
      }, delay);
      timers.add(timer);
      ownedTimers.add(timer);
    };
    const emit = (data: string): void => {
      record(shell, 'output');
      dataListener(data);
    };
    const at = (target: number, action: () => void): void => {
      later(Math.max(1, target - (performance.now() - spawnedAt)), action);
    };
    const progressingUntil = (last: number, cadence: number, message: string): void => {
      for (let when = cadence; when <= last; when += cadence) at(when, () => emit(message));
    };
    record(shell, 'spawn');
    if (shell === 1 && options.phase === 'posix-late-quiet') {
      progressingUntil(14_400, 800, 'starting shell\r\n');
      at(15_200, () => emit('$ '));
    } else if (shell === 1 && options.phase === 'posix-unstable-quiet') {
      at(1_000, () => emit('$ '));
      progressingUntil(29_000, 800, 'working\r\n');
    } else {
      later(1_000, () => emit('$ '));
    }
    return {
      pid: 4_000 + shell,
      onData(listener) {
        dataListener = listener;
      },
      onExit(listener) {
        exitListener = listener;
      },
      write(data) {
        record(shell, 'input');
        const command = data.trim();
        const arithmetic = /^echo (.*)_\$\(\((\d+)\*(\d+)\)\)_(.*)$/u.exec(command);
        if (arithmetic !== null) {
          const output = `${arithmetic[1]}_${Number(arithmetic[2]) * Number(arithmetic[3])}_${arithmetic[4]}\r\n`;
          later(1, () => emit(output));
          return;
        }
        const environment = /^echo "([^=]+)=\[\$([A-Z_]+)\]"$/u.exec(command);
        if (environment !== null) {
          const name = environment[2];
          if (name === undefined) throw new Error('environment command has no variable');
          later(1, () => emit(`${environment[1]}=[${spawnOptions.env[name] ?? ''}]\r\n`));
          return;
        }
        if (command.startsWith("printf 'CWD_PROOF=%s\\n'")) {
          const proof = readFileSync(join(spawnOptions.cwd, '.ok-pty-cwd-proof'), 'utf8');
          later(1, () => emit(`CWD_PROOF=${proof}\r\n`));
          return;
        }
        throw new Error(`unsupported controlled shell input: ${command}`);
      },
      resize() {},
      kill() {
        closed = true;
        for (const timer of ownedTimers) {
          clearTimeout(timer);
          timers.delete(timer);
        }
        ownedTimers.clear();
        record(shell, 'kill-request');
        exitListener({ exitCode: 1 });
      },
      pause() {},
      resume() {},
    };
  };

  vi.resetModules();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  if (platform === 'linux') vi.stubEnv('SHELL', '/bin/sh');
  vi.stubEnv('OK_PTY_HARNESS_BUDGET_MS', options.budgetOverride);
  vi.doMock('node:module', async (importOriginal) => {
    const original = await importOriginal<typeof import('node:module')>();
    return {
      ...original,
      createRequire: (url: string | URL) => {
        const realRequire = original.createRequire(url);
        return Object.assign(
          (name: string) => {
            if (name !== 'node-pty') {
              throw new Error(`unsupported controlled module: ${name}`);
            }
            return { spawn };
          },
          { resolve: realRequire.resolve },
        );
      },
    };
  });
  vi.doMock('node:fs', async (importOriginal) => {
    const original = await importOriginal<typeof import('node:fs')>();
    return {
      ...original,
      chmodSync: (path: Parameters<typeof original.chmodSync>[0]) => {
        if (basename(String(path)) !== 'spawn-helper') {
          throw new Error('controlled harness cannot chmod a native file');
        }
        record(0, 'helper-chmod-doubled');
      },
      existsSync: (path: Parameters<typeof original.existsSync>[0]) =>
        path === '/bin/sh' || original.existsSync(path),
      mkdtempSync: (prefix: string) => {
        const dir = original.mkdtempSync(prefix);
        dirs.push(dir);
        return dir;
      },
    };
  });
  const log = vi.spyOn(console, 'log').mockImplementation((line: string) => {
    result.lines.push(line);
    if (line.startsWith('PTY_HOST ')) {
      const start = line.indexOf('{');
      if (start >= 0) {
        const trace = JSON.parse(line.slice(start)) as Record<string, unknown>;
        result.traceEvents.push(trace);
        record(0, `trace:${String(trace.stage)}`, trace);
      }
    }
  });
  const exit = vi.spyOn(process, 'exit').mockImplementation((code) => {
    result.exitCode = code;
    vi.clearAllTimers();
    return undefined as never;
  });
  const signal = vi.spyOn(process, 'kill').mockImplementation(() => {
    throw new Error('controlled harness cannot send a native signal');
  });
  try {
    Object.defineProperty(process, 'platform', { ...platformDescriptor, value: platform });
    await import('./pty-host.real-io-harness.ts');
    await vi.runAllTimersAsync();
    return result;
  } finally {
    Object.defineProperty(process, 'platform', platformDescriptor);
    for (const timer of timers) clearTimeout(timer);
    vi.clearAllTimers();
    vi.useRealTimers();
    log.mockRestore();
    exit.mockRestore();
    signal.mockRestore();
    vi.unstubAllEnvs();
    vi.doUnmock('node:module');
    vi.doUnmock('node:fs');
    vi.resetModules();
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  }
}
