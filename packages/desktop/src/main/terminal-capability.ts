import { isTerminalPlatform } from '../shared/terminal-platform.ts';
export const TERMINAL_AVAILABLE_ARG = '--ok-pty-available=1';

export function isTerminalAvailable(platform: NodeJS.Platform = process.platform): boolean {
  if (!isTerminalPlatform(platform)) return false;
  return true;
}

export function withTerminalCapabilityArg(args: readonly string[], available: boolean): string[] {
  return available ? [...args, TERMINAL_AVAILABLE_ARG] : [...args];
}
