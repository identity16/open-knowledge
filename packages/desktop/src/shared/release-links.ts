import { DESKTOP_VARIANT, IDENTITY16_RELEASES_URL } from './desktop-variant.ts';

export const PUBLIC_RELEASES_URL =
  DESKTOP_VARIANT.name === 'identity16'
    ? IDENTITY16_RELEASES_URL
    : 'https://github.com/inkeep/open-knowledge/releases';

export function releasesPageUrl(variant: { readonly name: string }): string {
  return variant.name === 'identity16' ? IDENTITY16_RELEASES_URL : PUBLIC_RELEASES_URL;
}

export function releaseUrlFor(version: string, releasesUrl = PUBLIC_RELEASES_URL): string {
  const prefix = releasesUrl === IDENTITY16_RELEASES_URL ? 'identity16-v' : 'v';
  return `${releasesUrl}/tag/${prefix}${encodeURIComponent(version)}`;
}
