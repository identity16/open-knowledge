import { type ProcessStart, readProcessStart } from '@inkeep/open-knowledge-server';

export interface HolderProcessStartOptions {
  platform?: NodeJS.Platform;
}

export function readHolderProcessStart(
  pid: number,
  options: HolderProcessStartOptions = {},
): ProcessStart | null {
  return readProcessStart(pid, { platform: options.platform });
}

export function describeHolderStartReadFailure(args: {
  platform: NodeJS.Platform;
  pid: number;
}): string {
  const { platform, pid } = args;
  return platform === 'linux'
    ? `Linux reads the process start from /proc/${pid}/stat and /proc/stat; restore read access to /proc and retry. `
    : platform === 'darwin'
      ? 'macOS reads the process start with ps, and that read failed, as it does inside some sandboxes; retry from a shell where ps can run. '
      : '';
}
