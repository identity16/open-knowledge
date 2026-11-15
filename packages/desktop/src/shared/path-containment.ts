import { posix as pathPosix } from 'node:path';

function isContainablePath(path: string, _platform: NodeJS.Platform): boolean {
  if (!path || typeof path !== 'string' || path.includes('\0')) return false;

  return path.startsWith('/');
}

export function validateSpawnPath(path: string, platform: NodeJS.Platform): boolean {
  if (!isContainablePath(path, platform)) return false;
  return true;
}

export function isPathWithinProject(
  userPath: string,
  projectPath: string,
  platform: NodeJS.Platform,
): boolean {
  if (!isContainablePath(userPath, platform)) return false;
  if (!isContainablePath(projectPath, platform)) return false;
  const p = pathPosix;
  try {
    const canonicalUser = p.resolve(userPath);
    const canonicalProject = p.resolve(projectPath);

    if (canonicalUser === canonicalProject) return true;
    const rel = p.relative(canonicalProject, canonicalUser);
    if (rel === '' || rel === '.') return true;
    if (rel === '..' || rel.startsWith(`..${p.sep}`)) return false;

    if (rel.startsWith('/')) return false;
    return true;
  } catch (err) {
    console.warn('[path-containment] unexpected path-resolution error:', err);
    return false;
  }
}
