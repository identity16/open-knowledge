import { describe, expect, test } from 'vitest';
import { isTerminalPlatform } from './terminal-platform.ts';

describe('isTerminalPlatform', () => {
  test('enables PTY-backed terminal surfaces on supported POSIX desktop platforms', () => {
    expect(isTerminalPlatform('darwin')).toBe(true);
    expect(isTerminalPlatform('linux')).toBe(true);
    expect(isTerminalPlatform('win32')).toBe(false);
  });
});
