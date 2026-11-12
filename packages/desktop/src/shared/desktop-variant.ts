import { DESKTOP_PRODUCTS, type PackagedDesktopProductName } from '@inkeep/open-knowledge-core';

const DESKTOP_VARIANT_NAMES = ['stable', 'beta', 'legacy-beta', 'identity16'] as const;

export const IDENTITY16_RELEASES_URL = 'https://github.com/identity16/open-knowledge/releases';
export const IDENTITY16_UPDATE_FEED_URL = `${IDENTITY16_RELEASES_URL}/latest/download`;

export type DesktopVariantName = (typeof DESKTOP_VARIANT_NAMES)[number];

interface DesktopVariantIdentity {
  readonly name: PackagedDesktopProductName;
  readonly appId: string;
  readonly productName: string;
  readonly artifactName: string;
  readonly packageName: string;
  readonly protocolScheme: string;
  readonly updateChannel: 'latest' | 'beta';
  readonly feedChannel: 'latest' | 'beta' | 'beta-product';
  readonly instanceLabel: string | null;
  readonly iconPath: string;
  readonly windowsIconPath: string;
  readonly linuxExecutableName: string;
  readonly linuxPackageNames: {
    readonly deb: string;
    readonly rpm: string;
  };
  readonly retiredLinuxPackageNames: {
    readonly deb: readonly string[];
    readonly rpm: readonly string[];
  };
  readonly cliCommandNames: readonly [string, string];
  readonly cliHomeSegment: string | null;
}

const DESKTOP_PRODUCT_VARIANTS = {
  stable: {
    name: 'stable',
    appId: DESKTOP_PRODUCTS.stable.appId,
    productName: DESKTOP_PRODUCTS.stable.productName,
    artifactName: 'OpenKnowledge',
    packageName: DESKTOP_PRODUCTS.stable.packageName,
    protocolScheme: DESKTOP_PRODUCTS.stable.protocolScheme,
    updateChannel: 'latest',
    feedChannel: 'latest',
    instanceLabel: null,
    iconPath: 'build/icon.png',
    windowsIconPath: 'build/icon.ico',
    linuxExecutableName: DESKTOP_PRODUCTS.stable.linuxExecutableName,
    linuxPackageNames: DESKTOP_PRODUCTS.stable.linuxPackageNames,
    retiredLinuxPackageNames: DESKTOP_PRODUCTS.stable.retiredLinuxPackageNames,
    cliCommandNames: DESKTOP_PRODUCTS.stable.cliCommandNames,
    cliHomeSegment: null,
  },
  identity16: {
    name: 'identity16',
    appId: DESKTOP_PRODUCTS.identity16.appId,
    productName: DESKTOP_PRODUCTS.identity16.productName,
    artifactName: 'OpenKnowledge16',
    packageName: DESKTOP_PRODUCTS.identity16.packageName,
    protocolScheme: DESKTOP_PRODUCTS.identity16.protocolScheme,
    updateChannel: 'latest',
    feedChannel: 'latest',
    instanceLabel: null,
    iconPath: 'build/icon.png',
    windowsIconPath: 'build/icon.ico',
    linuxExecutableName: DESKTOP_PRODUCTS.identity16.linuxExecutableName,
    linuxPackageNames: DESKTOP_PRODUCTS.identity16.linuxPackageNames,
    retiredLinuxPackageNames: DESKTOP_PRODUCTS.identity16.retiredLinuxPackageNames,
    cliCommandNames: DESKTOP_PRODUCTS.identity16.cliCommandNames,
    cliHomeSegment: null,
  },
  beta: {
    name: 'beta',
    appId: DESKTOP_PRODUCTS.beta.appId,
    productName: DESKTOP_PRODUCTS.beta.productName,
    artifactName: 'OpenKnowledge-Beta',
    packageName: DESKTOP_PRODUCTS.beta.packageName,
    protocolScheme: DESKTOP_PRODUCTS.beta.protocolScheme,
    updateChannel: 'beta',
    feedChannel: 'beta-product',
    instanceLabel: 'Beta',
    iconPath: 'build/icon-beta.png',
    windowsIconPath: 'build/icon-beta.ico',
    linuxExecutableName: DESKTOP_PRODUCTS.beta.linuxExecutableName,
    linuxPackageNames: DESKTOP_PRODUCTS.beta.linuxPackageNames,
    retiredLinuxPackageNames: DESKTOP_PRODUCTS.beta.retiredLinuxPackageNames,
    cliCommandNames: DESKTOP_PRODUCTS.beta.cliCommandNames,
    cliHomeSegment: 'beta',
  },
} as const satisfies Record<PackagedDesktopProductName, DesktopVariantIdentity>;

export const DESKTOP_VARIANTS = {
  ...DESKTOP_PRODUCT_VARIANTS,
  'legacy-beta': {
    ...DESKTOP_PRODUCT_VARIANTS.stable,
    updateChannel: 'beta',
    feedChannel: 'beta',
  },
} as const satisfies Record<DesktopVariantName, DesktopVariantIdentity>;

export function parseDesktopVariantName(raw: string | undefined): DesktopVariantName {
  const normalized = raw?.trim().toLowerCase() || 'stable';
  if ((DESKTOP_VARIANT_NAMES as readonly string[]).includes(normalized)) {
    return normalized as DesktopVariantName;
  }
  throw new Error(
    `Unsupported OK_DESKTOP_VARIANT=${JSON.stringify(raw)}. Expected stable or beta or legacy-beta or identity16.`,
  );
}

declare const __OK_DESKTOP_VARIANT__: string | undefined;

export const DESKTOP_VARIANT =
  DESKTOP_VARIANTS[
    parseDesktopVariantName(
      typeof __OK_DESKTOP_VARIANT__ === 'string' ? __OK_DESKTOP_VARIANT__ : undefined,
    )
  ];
