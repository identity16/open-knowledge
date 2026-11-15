import { describe, expect, test } from 'vitest';
import { appBundleRootFromExecutable, wrapperPathInBundle } from './bundle-paths.ts';

describe('wrapperPathInBundle', () => {
  test('maps packaged executable path to bundled ok.sh wrapper', () => {
    expect(
      wrapperPathInBundle('/Applications/OpenKnowledge.app/Contents/MacOS/OpenKnowledge', 'darwin'),
    ).toBe('/Applications/OpenKnowledge.app/Contents/Resources/cli/bin/ok.sh');
  });
});

describe('appBundleRootFromExecutable', () => {
  test('darwin reduces the main binary to the .app root that also holds the helpers', () => {
    const root = appBundleRootFromExecutable(
      '/Applications/OpenKnowledge.app/Contents/MacOS/OpenKnowledge',
      'darwin',
    );

    expect(root).toBe('/Applications/OpenKnowledge.app');
    expect(
      '/Applications/OpenKnowledge.app/Contents/Frameworks/OpenKnowledge Helper.app/Contents/MacOS/OpenKnowledge Helper'.startsWith(
        `${root}/`,
      ),
    ).toBe(true);
  });

  test('a darwin binary run outside a bundle degrades to its own directory', () => {
    expect(appBundleRootFromExecutable('/opt/local/bin/openknowledge', 'darwin')).toBe(
      '/opt/local/bin',
    );
  });
});
