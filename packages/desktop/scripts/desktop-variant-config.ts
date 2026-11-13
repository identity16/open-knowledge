import { parse as parseYaml } from 'yaml';
import {
  DESKTOP_VARIANTS,
  type DesktopVariantName,
  IDENTITY16_UPDATE_FEED_URL,
} from '../src/shared/desktop-variant.ts';

interface ResourceEntry {
  from: string;
  to: string;
  filter?: string[];
}

interface BuilderConfig {
  appId: string;
  productName: string;
  extraMetadata?: Record<string, unknown>;
  protocols: Array<{ name: string; schemes: string[]; role?: string }>;
  publish: Array<{
    provider: string;
    owner?: string;
    repo?: string;
    url?: string;
    channel: string;
    private?: boolean;
  }>;
  mac: {
    icon: string;
    signIgnore?: string[];
    artifactName?: string;
    entitlements: string;
    provisioningProfile?: string;
    extraResources: ResourceEntry[];
    extraFiles: ResourceEntry[];
    extendInfo?: Record<string, unknown>;
  };
  dmg: { artifactName: string };
  npmRebuild?: boolean;
}

export interface VariantConfigPaths {
  readonly localEntitlementsPath: string;
  readonly helperInfoPath: string;
  readonly profileAvailable: boolean;
}

function replaceRequired(
  source: string,
  search: string | RegExp,
  replacement: string,
  label: string,
): string {
  const found = typeof search === 'string' ? source.includes(search) : search.test(source);
  if (!found) throw new Error(`Desktop packaging template is missing ${label}.`);
  return source.replace(search, replacement);
}

function replaceAllRequired(
  source: string,
  search: string,
  replacement: string,
  label: string,
): string {
  if (!source.includes(search)) throw new Error(`Desktop packaging template is missing ${label}.`);
  return source.replaceAll(search, replacement);
}

export function parseBuilderConfig(text: string): BuilderConfig {
  return parseYaml(text) as BuilderConfig;
}

export function createVariantBuilderConfig(
  base: BuilderConfig,
  variantName: DesktopVariantName,
  paths: VariantConfigPaths,
  sourceVersion: string,
): BuilderConfig {
  const variant = DESKTOP_VARIANTS[variantName];
  const config = structuredClone(base);
  config.appId = variant.appId;
  config.productName = variant.productName;
  config.extraMetadata = {
    ...config.extraMetadata,
    okDesktopVariant: variantName,
    productName: variant.productName,
    ...(variant.name === 'stable' ? {} : { name: variant.packageName }),
    ...(variant.updateChannel === 'beta' ? { version: betaBuildVersion(sourceVersion) } : {}),
  };
  config.protocols = [
    { name: `${variant.productName} URL`, schemes: [variant.protocolScheme], role: 'Editor' },
  ];
  config.publish = config.publish.map((entry) => ({
    ...entry,
    channel: variant.feedChannel,
  }));
  if (variantName === 'identity16') {
    config.publish = [{ provider: 'generic', url: IDENTITY16_UPDATE_FEED_URL, channel: 'latest' }];
    config.mac.signIgnore = [
      ...(config.mac.signIgnore ?? []),
      '/Contents/Resources/app/.*\\.(?:woff2?|ttf|otf)$',
      '/Electron Framework\\.framework/(?:Versions/[^/]+/)?Resources/[^/]+\\.lproj/(?:locale\\.pak|MainMenu\\.nib(?:/.*)?)$',
    ];
  }
  config.mac.icon = variant.name === 'stable' ? config.mac.icon : variant.iconPath;
  config.mac.artifactName = `${variant.artifactName}-\${version}-\${arch}-mac.\${ext}`;
  config.dmg.artifactName = `${variant.artifactName}-\${arch}.\${ext}`;
  config.mac.extendInfo = {
    ...config.mac.extendInfo,
    NSMicrophoneUsageDescription: `A program running in ${variant.productName}'s terminal wants to use the microphone.`,
  };
  config.mac.extraFiles = [
    {
      from: paths.helperInfoPath,
      to: `Frameworks/${variant.productName} Server.app/Contents/Info.plist`,
    },
  ];
  if (variantName !== 'identity16' && (variant.name === 'stable' || paths.profileAvailable)) {
    config.mac.provisioningProfile =
      variant.name === 'stable'
        ? 'build/embedded.provisionprofile'
        : `build/embedded.${variant.name}.provisionprofile`;
  } else {
    delete config.mac.provisioningProfile;
    config.mac.entitlements = paths.localEntitlementsPath;
  }
  return config;
}

export function betaBuildVersion(sourceVersion: string): string {
  const base = /^\d+\.\d+\.\d+/.exec(sourceVersion)?.[0];
  if (!base)
    throw new Error(`Desktop package version ${JSON.stringify(sourceVersion)} is invalid.`);
  return /-beta\.\d+(?:\+.*)?$/.test(sourceVersion) ? sourceVersion : `${base}-beta.0`;
}

export function createLocalEntitlements(source: string): string {
  return replaceRequired(
    source,
    /\n\s*<key>com\.apple\.developer\.associated-domains<\/key>\s*<array>[\s\S]*?<\/array>/,
    '',
    'the associated-domains entitlement in build/entitlements.mac.plist',
  );
}

export function createVariantHelperInfo(source: string, variantName: DesktopVariantName): string {
  const variant = DESKTOP_VARIANTS[variantName];
  const withAppId = replaceAllRequired(
    source,
    'com.inkeep.open-knowledge.server',
    `${variant.appId}.server`,
    'the helper bundle identifier in build/helper-bundle/Info.plist',
  );
  const withServerName = replaceAllRequired(
    withAppId,
    'OpenKnowledge Server',
    `${variant.productName} Server`,
    'the helper bundle name in build/helper-bundle/Info.plist',
  );
  return replaceAllRequired(
    withServerName,
    'OpenKnowledge Helper',
    `${variant.productName} Helper`,
    'the helper executable name in build/helper-bundle/Info.plist',
  );
}
