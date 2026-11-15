import { PRODUCT_NAME } from '@inkeep/open-knowledge-core/constants/product';
import { t } from '@lingui/core/macro';

export function revealInFileManagerLabel(platform: string | null | undefined): string {
  if (platform === 'linux') return t`Open containing folder`;
  return t`Reveal in Finder`;
}

export function moveToTrashLabel(_platform: string | null | undefined): string {
  return t`Move to Trash`;
}

export function trashNounLabel(_platform: string | null | undefined): string {
  return t`Trash`;
}

export function aboutAppLabel(platform: string | null | undefined): string {
  if (platform === 'linux') return t`About`;
  const appName = PRODUCT_NAME;
  return t`About ${appName}`;
}
