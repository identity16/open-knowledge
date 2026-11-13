import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse, stringify } from 'yaml';
import { verifyFuses } from '../../packages/desktop/scripts/afterSign.mjs';
import { stampMacUpdateManifests } from '../../packages/desktop/scripts/mac-update-manifest.ts';
import { targetFuses } from '../../packages/desktop/scripts/target-fuses.mjs';
import { readCheckpoint, validateCandidate } from './release-checkpoint.mjs';
import { forkReleasePlan, stageDesktopRelease } from './release-plan.mjs';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} failed (${result.status ?? result.error?.code ?? result.signal}).`);
  }
}

function readCommand(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.error || result.status !== 0)
    throw new Error(`${command} could not read the signing configuration.`);
  return result.stdout;
}

function securityStep(label, args) {
  const result = spawnSync('security', args, { encoding: 'utf8' });
  if (result.error || result.status !== 0) throw new Error(`Signing setup failed: ${label}.`);
}

function keychains() {
  return readCommand('security', ['list-keychains', '-d', 'user'])
    .split('\n')
    .map((line) => line.trim().replace(/^"|"$/g, ''))
    .filter(Boolean);
}

export function requireNotarizationCredentials(env) {
  const names = ['APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER'];
  const missing = names.filter((name) => !env[name]);
  if (missing.length) throw new Error(`Missing notarization credentials: ${missing.join(', ')}.`);
  if (
    ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_KEYCHAIN_PROFILE'].some((name) => env[name])
  ) {
    throw new Error('Use only the dedicated App Store Connect API key for this release.');
  }
  requireSigningCredentials(env);
}

export function requireSigningCredentials(env) {
  if (!env.CSC_LINK && !env.CSC_KEYCHAIN)
    throw new Error('A Developer ID signing identity is required.');
  if (env.CSC_LINK && !env.CSC_KEY_PASSWORD)
    throw new Error('CSC_KEY_PASSWORD is required with CSC_LINK.');
}

function prepareSigning(temp, desktop, input, state, signOnly) {
  if (signOnly) requireSigningCredentials(input);
  else requireNotarizationCredentials(input);
  const env = { ...input };
  if (signOnly) {
    for (const name of Object.keys(env).filter((name) => name.startsWith('APPLE_')))
      delete env[name];
  } else {
    const key = input.APPLE_API_KEY.includes('-----BEGIN')
      ? input.APPLE_API_KEY
      : readFileSync(input.APPLE_API_KEY, 'utf8');
    if (!key.startsWith('-----BEGIN PRIVATE KEY-----'))
      throw new Error('APPLE_API_KEY must be a PEM private key or its file path.');
    const keyPath = join(temp, 'notarization.p8');
    writeFileSync(keyPath, key, { mode: 0o600 });
    env.APPLE_API_KEY = keyPath;
  }
  if (input.CSC_LINK) {
    const keychain = join(temp, 'release.keychain-db');
    const password = randomBytes(32).toString('base64url');
    const certificate = join(temp, 'developer-id.p12');
    writeFileSync(certificate, Buffer.from(input.CSC_LINK, 'base64'), { mode: 0o600 });
    securityStep('create keychain', ['create-keychain', '-p', password, keychain]);
    state.keychain = keychain;
    securityStep('keychain timeout', ['set-keychain-settings', '-lut', '21600', keychain]);
    securityStep('unlock keychain', ['unlock-keychain', '-p', password, keychain]);
    securityStep('import certificate', [
      'import',
      certificate,
      '-k',
      keychain,
      '-P',
      input.CSC_KEY_PASSWORD,
      '-T',
      '/usr/bin/codesign',
      '-T',
      '/usr/bin/productbuild',
    ]);
    securityStep('authorize codesign', [
      'set-key-partition-list',
      '-S',
      'apple-tool:,apple:,codesign:',
      '-s',
      '-k',
      password,
      keychain,
    ]);
    const require = createRequire(join(desktop, 'package.json'));
    const builder = dirname(require.resolve('electron-builder/package.json'));
    const library = dirname(require.resolve('app-builder-lib/package.json', { paths: [builder] }));
    const roots = join(library, 'certs/root_certs.keychain');
    if (!existsSync(roots))
      throw new Error('The electron-builder signing root certificates are missing.');
    const existing = keychains();
    state.addedKeychains = [keychain, ...(!existing.includes(roots) ? [roots] : [])];
    securityStep('set keychain search list', [
      'list-keychains',
      '-d',
      'user',
      '-s',
      ...new Set([keychain, roots, ...existing]),
    ]);
    env.CSC_KEYCHAIN = keychain;
  }
  delete env.CSC_LINK;
  delete env.CSC_KEY_PASSWORD;
  const identities = readCommand('security', [
    'find-identity',
    '-v',
    '-p',
    'codesigning',
    env.CSC_KEYCHAIN,
  ]);
  const identity = identities.match(/"(Developer ID Application: [^"]+)"/);
  if (!identity)
    throw new Error('The signing keychain has no valid Developer ID Application identity.');
  env.CSC_NAME = identity[1].slice('Developer ID Application: '.length);
  return env;
}

function cleanupSigning(temp, signing) {
  try {
    if (signing.keychain) {
      try {
        const current = keychains().filter((path) => !signing.addedKeychains.includes(path));
        securityStep('restore keychain search list', [
          'list-keychains',
          '-d',
          'user',
          '-s',
          ...current,
        ]);
      } finally {
        securityStep('remove build keychain', ['delete-keychain', signing.keychain]);
      }
    }
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

export async function verifyPackagedApp(app, version, env = process.env, notarized = true) {
  const plist = join(app, 'Contents/Info.plist');
  const values = {
    CFBundleIdentifier: 'com.identity16.openknowledge',
    CFBundleName: 'OpenKnowledge16',
    CFBundleShortVersionString: version,
  };
  for (const [key, expected] of Object.entries(values)) {
    if (
      readCommand('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, plist]).trim() !== expected
    ) {
      throw new Error(`The packaged application has an unexpected ${key}.`);
    }
  }
  const binary = join(app, 'Contents/MacOS/OpenKnowledge16');
  if (readCommand('lipo', ['-archs', binary]).trim() !== 'arm64')
    throw new Error('The app is not arm64-only.');
  run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app]);
  await verifyFuses(binary, targetFuses);
  if (notarized) {
    run('xcrun', ['stapler', 'validate', app]);
    run('spctl', ['--assess', '--type', 'execute', '--verbose=2', app]);
  }
  const probe = spawnSync(
    binary,
    [join(import.meta.dirname, 'native-probe.cjs'), join(app, 'Contents/Resources')],
    { stdio: 'inherit', env: { ...env, ELECTRON_RUN_AS_NODE: '1' }, timeout: 60_000 },
  );
  if (probe.status !== 0)
    throw new Error('A native module does not load in the packaged Electron runtime.');
  const wrapper = join(app, 'Contents/Resources/cli/bin/ok.sh');
  const cli = spawnSync(wrapper, ['--version'], { encoding: 'utf8', env });
  if (cli.status !== 0 || cli.stdout.split(/\r?\n/, 1)[0].trim() !== version)
    throw new Error('The bundled fork CLI did not report the release version.');
  console.log(
    `Verified ${notarized ? 'signed, notarized' : 'signed'} arm64 application and bundled CLI: ${version}`,
  );
}

export async function buildDesktop(
  version,
  output,
  input = process.env,
  { signOnly = false } = {},
) {
  const plan = forkReleasePlan(version);
  if (process.platform !== 'darwin' || process.arch !== 'arm64')
    throw new Error('Build OpenKnowledge16 on macOS arm64.');
  if (signOnly) requireSigningCredentials(input);
  else requireNotarizationCredentials(input);
  const root = resolve(import.meta.dirname, '../..');
  const desktop = join(root, 'packages/desktop');
  const releaseDir = resolve(output ?? join(root, '.fork-release'));
  const cliArchive = join(releaseDir, plan.cli);
  const packedManifest = JSON.parse(
    readCommand('tar', ['-xOf', cliArchive, 'package/package.json']),
  );
  if (packedManifest.version !== version)
    throw new Error('Build the matching web release before the desktop application.');
  const manifests = ['packages/cli/package.json', 'packages/desktop/package.json'].map((path) =>
    join(root, path),
  );
  const originals = new Map(manifests.map((path) => [path, readFileSync(path, 'utf8')]));
  const temp = mkdtempSync(join(tmpdir(), 'openknowledge16-signing-'));
  const scratchRoot = join(root, '.fork-release');
  mkdirSync(scratchRoot, { recursive: true });
  const signedOutput = signOnly ? mkdtempSync(join(scratchRoot, '.signed-')) : null;
  const signing = { keychain: null, addedKeychains: [] };
  try {
    const env = {
      ...prepareSigning(temp, desktop, input, signing, signOnly),
      OK_DESKTOP_VARIANT: 'identity16',
      TURBO_CACHE_DIR: join(root, '.turbo/cache'),
    };
    for (const [path, contents] of originals) {
      writeFileSync(path, `${JSON.stringify({ ...JSON.parse(contents), version }, null, 2)}\n`);
    }
    run('pnpm', ['run', 'build:desktop', '--config', 'electron.vite.release.config.ts'], {
      cwd: desktop,
      env,
    });
    run('pnpm', ['exec', 'node', 'scripts/prepare-universal.mjs'], { cwd: desktop, env });
    run('pnpm', ['exec', 'node', 'scripts/stage-parcel-watcher.mjs'], { cwd: desktop, env });
    run(
      'pnpm',
      [
        'exec',
        'node',
        join(root, '.github/scripts/package-desktop.mjs'),
        '--mac',
        '--arm64',
        ...(signOnly ? ['--dir', `-c.directories.output=${signedOutput}`] : []),
        '--publish',
        'never',
        '-c.forceCodeSigning=true',
        '-c.npmRebuild=false',
      ],
      { cwd: desktop, env },
    );
    const app = join(
      signOnly ? signedOutput : join(desktop, 'dist-desktop'),
      'mac-arm64/OpenKnowledge16.app',
    );
    await verifyPackagedApp(app, version, env, !signOnly);
    copyFileSync(join(root, 'scripts/fork/channel.mjs'), join(releaseDir, 'channel.mjs'));
    if (signOnly) {
      run('ditto', [
        '-c',
        '-k',
        '--sequesterRsrc',
        '--keepParent',
        app,
        join(releaseDir, 'signed-app.zip'),
      ]);
      copyFileSync(
        join(desktop, '.variant-build/electron-builder.yml'),
        join(releaseDir, 'builder-config.yml'),
      );
      run(
        'git',
        [
          'archive',
          '--format=tar',
          '--output',
          join(releaseDir, 'packaging-resources.tar'),
          readCommand('git', ['rev-parse', 'HEAD']).trim(),
          'packages/desktop/build',
        ],
        { cwd: root },
      );
      console.log(`Saved verified signed application before notarization in ${releaseDir}`);
      return;
    }
    const assets = stageDesktopRelease(join(desktop, 'dist-desktop'), releaseDir, version);
    writeFileSync(join(releaseDir, 'release-assets.json'), `${JSON.stringify(assets, null, 2)}\n`);
    console.log(`Staged ${assets.length} release assets in ${releaseDir}`);
  } finally {
    try {
      for (const [path, contents] of originals) writeFileSync(path, contents);
    } finally {
      try {
        cleanupSigning(temp, signing);
      } finally {
        if (signedOutput) rmSync(signedOutput, { recursive: true, force: true });
      }
    }
  }
}

export async function packageDesktop(version, candidateDir, releaseDir, input = process.env) {
  forkReleasePlan(version);
  requireSigningCredentials(input);
  validateCandidate(readCheckpoint(candidateDir, 'candidate'), candidateDir, version);
  if (resolve(candidateDir) === resolve(releaseDir))
    throw new Error('Keep the signed checkpoint separate from packaged assets.');
  if (process.platform !== 'darwin' || process.arch !== 'arm64')
    throw new Error('Package the fork on macOS arm64.');
  const root = resolve(import.meta.dirname, '../..');
  const desktop = join(root, 'packages/desktop');
  mkdirSync(join(root, '.fork-release'), { recursive: true });
  mkdirSync(releaseDir, { recursive: true });
  const temp = mkdtempSync(join(root, '.fork-release/.package-'));
  const signing = { keychain: null, addedKeychains: [] };
  try {
    const env = prepareSigning(temp, desktop, input, signing, true);
    run('ditto', ['-x', '-k', join(candidateDir, 'signed-app.zip'), temp]);
    const app = join(temp, 'OpenKnowledge16.app');
    run('xcrun', ['stapler', 'staple', app]);
    const resources = join(temp, 'resources');
    mkdirSync(resources);
    run('tar', ['-xf', join(candidateDir, 'packaging-resources.tar'), '-C', resources]);
    const buildResources = join(resources, 'packages/desktop/build');
    const saved = parse(readFileSync(join(candidateDir, 'builder-config.yml'), 'utf8'));
    const resourcePath = (value) => {
      if (
        typeof value !== 'string' ||
        !value.startsWith('build/') ||
        value.includes('..') ||
        value.includes('\\')
      )
        throw new Error('Unsupported packaging resource path in the signed checkpoint.');
      return join(buildResources, value.slice('build/'.length));
    };
    const configPath = join(temp, 'package.yml');
    writeFileSync(
      configPath,
      stringify({
        appId: saved.appId,
        productName: saved.productName,
        electronVersion: saved.electronVersion,
        copyright: saved.copyright,
        compression: saved.compression,
        directories: { buildResources },
        publish: saved.publish,
        extraMetadata: { ...saved.extraMetadata, version },
        mac: {
          target: saved.mac.target,
          artifactName: saved.mac.artifactName,
          icon: resourcePath(saved.mac.icon),
          notarize: false,
        },
        dmg: {
          ...saved.dmg,
          background: resourcePath(saved.dmg.background),
          ...(saved.dmg.icon ? { icon: resourcePath(saved.dmg.icon) } : {}),
        },
      }),
    );
    const artifacts = join(temp, 'artifacts');
    run(
      'pnpm',
      [
        'exec',
        'electron-builder',
        '--config',
        configPath,
        '--prepackaged',
        app,
        '--mac',
        '--arm64',
        '--publish',
        'never',
        '-c.mac.notarize=false',
        '-c.npmRebuild=false',
        `-c.extraMetadata.version=${version}`,
        `-c.directories.output=${artifacts}`,
      ],
      { cwd: desktop, env },
    );
    await verifyPackagedApp(app, version, env);
    stampMacUpdateManifests(artifacts);
    const plan = forkReleasePlan(version);
    run('codesign', ['--verify', '--verbose=2', join(artifacts, plan.dmg)]);
    copyFileSync(join(candidateDir, plan.cli), join(releaseDir, plan.cli));
    copyFileSync(join(candidateDir, 'channel.mjs'), join(releaseDir, 'channel.mjs'));
    const assets = stageDesktopRelease(artifacts, releaseDir, version);
    writeFileSync(join(releaseDir, 'release-assets.json'), `${JSON.stringify(assets, null, 2)}\n`);
    console.log(
      `Packaged ${assets.length} assets without rebuilding, resigning or resubmitting the application.`,
    );
  } finally {
    cleanupSigning(temp, signing);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === 'sign')
    await buildDesktop(process.argv[3], process.argv[4], process.env, { signOnly: true });
  else if (process.argv[2] === 'package')
    await packageDesktop(process.argv[3], resolve(process.argv[4]), resolve(process.argv[5]));
  else await buildDesktop(process.argv[2], process.argv[3]);
}
