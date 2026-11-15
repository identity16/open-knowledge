import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface DetectClaudeDesktopOptions {
  home?: string;
  platformName?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
}

export function detectClaudeDesktopPresence(opts: DetectClaudeDesktopOptions = {}): boolean {
  const home = opts.home ?? homedir();
  const platformName = opts.platformName ?? process.platform;

  if (platformName === 'darwin') {
    return existsSync(join(home, 'Library', 'Application Support', 'Claude'));
  }

  return false;
}
