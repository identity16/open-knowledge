import { accessSync, constants, statSync } from 'node:fs';

export function isExecutableFileSync(
  absPath: string,
  _platform: NodeJS.Platform = process.platform,
): boolean {
  try {
    if (!statSync(absPath).isFile()) return false;

    accessSync(absPath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
