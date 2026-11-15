import { dirname, join } from 'node:path';

export function wrapperPathInBundle(
  executablePath: string,
  platform: 'darwin' | 'linux' | string = process.platform,
): string {
  if (platform === 'linux') {
    return join(dirname(executablePath), 'resources', 'cli', 'bin', 'ok.sh');
  }
  const bundleRoot = executablePath.replace(/\/Contents\/MacOS\/.*$/, '');
  return join(bundleRoot, 'Contents', 'Resources', 'cli', 'bin', 'ok.sh');
}

export function appBundleRootFromExecutable(
  executablePath: string,
  platform: 'darwin' | 'linux' | string = process.platform,
): string {
  if (platform === 'darwin') {
    const bundleRoot = executablePath.replace(/\/Contents\/MacOS\/[^/]+$/, '');
    if (bundleRoot !== executablePath) return bundleRoot;
  }
  return dirname(executablePath);
}
