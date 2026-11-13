import { DESKTOP_VARIANT, OPENKNOWLEDGE16_RELEASES_URL } from './desktop-variant.ts';

export const PUBLIC_RELEASES_URL =
  DESKTOP_VARIANT.name === 'openknowledge16'
    ? OPENKNOWLEDGE16_RELEASES_URL
    : 'https://github.com/inkeep/open-knowledge/releases';

export function releasesPageUrl(variant: { readonly name: string }): string {
  return variant.name === 'openknowledge16' ? OPENKNOWLEDGE16_RELEASES_URL : PUBLIC_RELEASES_URL;
}

export function releaseUrlFor(version: string, releasesUrl = PUBLIC_RELEASES_URL): string {
  const prefix =
    releasesUrl === OPENKNOWLEDGE16_RELEASES_URL && version.includes('-identity16.')
      ? 'identity16-v'
      : 'v';
  return `${releasesUrl}/tag/${prefix}${encodeURIComponent(version)}`;
}
