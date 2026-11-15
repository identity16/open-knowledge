import { isPathWithinDir } from '@inkeep/open-knowledge-server';
import { describe, expect, test } from 'vitest';
import { isPathWithinProject, validateSpawnPath } from './path-containment.ts';

describe('validateSpawnPath — posix', () => {
  test('accepts absolute paths and rejects relative, empty, and NUL-carrying input', () => {
    expect(validateSpawnPath('/proj/file.zip', 'darwin')).toBe(true);
    expect(validateSpawnPath('proj/file.zip', 'darwin')).toBe(false);
    expect(validateSpawnPath('./file.zip', 'linux')).toBe(false);
    expect(validateSpawnPath('', 'darwin')).toBe(false);
    expect(validateSpawnPath('/proj/fi\0le.zip', 'darwin')).toBe(false);
  });
});

describe('isPathWithinProject — posix', () => {
  test('admits the root itself and nested children', () => {
    expect(isPathWithinProject('/proj', '/proj', 'darwin')).toBe(true);
    expect(isPathWithinProject('/proj/file.zip', '/proj', 'darwin')).toBe(true);
    expect(isPathWithinProject('/proj/a/b/file.zip', '/proj', 'darwin')).toBe(true);
  });

  test('rejects dot-dot escapes, even when lexically prefixed by the root', () => {
    expect(isPathWithinProject('/proj/../etc/passwd', '/proj', 'darwin')).toBe(false);
    expect(isPathWithinProject('/proj/a/../../etc', '/proj', 'linux')).toBe(false);
  });

  test('rejects the sibling-prefix collision', () => {
    expect(isPathWithinProject('/proj-evil/file.zip', '/proj', 'darwin')).toBe(false);
  });

  test('rejects relative input on either side', () => {
    expect(isPathWithinProject('file.zip', '/proj', 'darwin')).toBe(false);
    expect(isPathWithinProject('/proj/file.zip', 'proj', 'darwin')).toBe(false);
  });
});

describe('isPathWithinProject — parity with the server isPathWithinDir', () => {
  const PARITY_VECTORS: Array<[userPath: string, root: string, platform: NodeJS.Platform]> = [
    ['/proj', '/proj', 'darwin'],
    ['/proj/file.zip', '/proj', 'darwin'],
    ['/proj/a/b/file.zip', '/proj', 'linux'],
    ['/proj/../etc/passwd', '/proj', 'darwin'],
    ['/proj/a/../../etc', '/proj', 'linux'],
    ['/proj-evil/file.zip', '/proj', 'darwin'],
    ['file.zip', '/proj', 'darwin'],
    ['/proj/file.zip', 'proj', 'darwin'],
    ['', '/proj', 'darwin'],
    ['/proj/fi\0le.zip', '/proj', 'darwin'],
    ['C:\\proj', 'C:\\proj'],
    ['C:\\proj\\file.zip', 'C:\\proj'],
    ['C:/proj/sub/file.zip', 'C:\\proj'],
    ['c:\\proj\\file.zip', 'C:\\proj'],
    ['C:\\proj\\..\\windows\\evil.zip', 'C:\\proj'],
    ['C:\\proj-evil\\file.zip', 'C:\\proj'],
    ['D:\\proj\\file.zip', 'C:\\proj'],
    ['\\\\server\\share\\dir\\file.zip', '\\\\server\\share\\dir'],
    ['\\\\server\\share2\\file.zip', '\\\\server\\share\\dir'],
    ['\\\\server2\\share\\file.zip', '\\\\server\\share\\dir'],
    ['\\\\server\\share\\file.zip', 'C:\\proj'],
    ['\\\\?\\C:\\proj\\file.zip', 'C:\\proj'],
    ['\\\\.\\pipe\\ok-pipe', 'C:\\proj'],
    ['/proj/file.zip', 'C:\\proj'],
  ];

  for (const [userPath, root, platform] of PARITY_VECTORS) {
    test(`${platform}: ${JSON.stringify(userPath)} vs ${JSON.stringify(root)}`, () => {
      expect(isPathWithinProject(userPath, root, platform)).toBe(
        isPathWithinDir(userPath, root, platform),
      );
    });
  }
});
