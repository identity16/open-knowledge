import { describe, expect, test } from 'vitest';
import {
  isTerminalAvailable,
  TERMINAL_AVAILABLE_ARG,
  withTerminalCapabilityArg,
} from './terminal-capability.ts';

describe('desktop terminal capability', () => {
  test('enables the supported POSIX desktop platforms', () => {
    expect(isTerminalAvailable('darwin')).toBe(true);
    expect(isTerminalAvailable('linux')).toBe(true);
  });

  test('refuses unsupported desktop platforms', () => {
    expect(isTerminalAvailable('win32')).toBe(false);
    expect(isTerminalAvailable('freebsd')).toBe(false);
  });

  test('feeds only a positive capability verdict into renderer-window argv', () => {
    expect(withTerminalCapabilityArg(['--ok-mode=editor'], false)).toEqual(['--ok-mode=editor']);
    expect(withTerminalCapabilityArg(['--ok-mode=editor'], true)).toEqual([
      '--ok-mode=editor',
      TERMINAL_AVAILABLE_ARG,
    ]);
  });
});
