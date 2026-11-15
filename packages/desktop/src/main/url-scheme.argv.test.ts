import { EventEmitter } from 'node:events';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import { registerProtocolHandler } from './url-scheme.ts';

const executable = resolve(tmpdir(), 'OpenKnowledge.exe');
const documentPath = (name: string) => resolve(tmpdir(), 'open-knowledge-argv', name);

function makeHandler(
  argv: readonly string[] = [executable],
  options: { platform?: NodeJS.Platform; isPackaged?: boolean } = {},
) {
  const events = new EventEmitter();
  const ready = Promise.withResolvers<void>();
  const openEphemeralFile = vi.fn(async (_filePath: string) => {});
  const openProject = vi.fn(async (_projectPath: string) => null);
  const sendDeepLink = vi.fn();
  const infoLog = vi.fn();
  const onRelaunchWithoutTarget = vi.fn();
  const scheduled: Array<() => void> = [];
  const control = registerProtocolHandler({
    app: {
      on: events.on.bind(events),
      whenReady: () => ready.promise,
      isPackaged: options.isPackaged ?? true,
      setAsDefaultProtocolClient: () => true,
      removeAsDefaultProtocolClient: () => true,
    },
    focusWindowForProject: () => null,
    openProject,
    openEphemeralFile,
    sendDeepLink,
    getAnyReadyWindow: () => null,
    getInitialArgv: () => argv,
    onRelaunchWithoutTarget,
    platform: options.platform ?? 'win32',
    log: { info: infoLog, warn: vi.fn(), error: vi.fn() },
    setTimeout: (cb) => scheduled.push(cb),
  });
  return {
    control,
    openEphemeralFile,
    openProject,
    sendDeepLink,
    infoLog,
    onRelaunchWithoutTarget,
    ready: ready.resolve,
    secondInstance: (args: readonly string[]) => events.emit('second-instance', {}, args),
    runScheduled: () => {
      while (scheduled.length > 0) scheduled.shift()?.();
    },
  };
}

const _names = [
  'notes.md',
  'notes.mdx',
  'notes.MD',
  'notes.MDX',
  'My notes.md',
  '日本語 café.md',
  '100% complete.md',
  'literal%20name.md',
  'literal%00name.md',
  'Q4 #1 & follow-up.md',
];

describe('relaunch without a target', () => {
  test.each<NodeJS.Platform>(['linux', 'darwin'])(
    'asks for an existing window when a second launch on %s names nothing to open',
    (platform) => {
      const h = makeHandler(undefined, { platform });
      h.control.drainQueuedUrls();
      h.secondInstance(['--original-process-start-time=123', executable, '--inspect=9229']);
      expect(h.onRelaunchWithoutTarget).toHaveBeenCalledOnce();
      expect(h.openProject).not.toHaveBeenCalled();
      expect(h.openEphemeralFile).not.toHaveBeenCalled();
    },
  );

  test('routes a second launch that carries a link without asking for a window', () => {
    const file = documentPath('url-note.md');
    const h = makeHandler();
    h.control.drainQueuedUrls();
    h.secondInstance([executable, `openknowledge://open?file=${encodeURIComponent(file)}`]);
    expect(h.openEphemeralFile).toHaveBeenCalledExactlyOnceWith(file);
    expect(h.onRelaunchWithoutTarget).not.toHaveBeenCalled();
  });

  test('leaves the first launch to boot restore', () => {
    const h = makeHandler([executable, '--inspect=9229']);
    h.control.drainQueuedUrls();
    expect(h.onRelaunchWithoutTarget).not.toHaveBeenCalled();
  });
});
