import { NATIVE_MENU_LABELS } from '@inkeep/open-knowledge-core';
import type { BrowserWindow, Menu, MenuItemConstructorOptions } from 'electron';
import { type MenuTranslator, translateEnglish } from './menu-translator.ts';

export function buildImageMenuSection(
  copyImage: () => void,
  translate: MenuTranslator = translateEnglish,
): MenuItemConstructorOptions[] {
  return [{ label: translate(NATIVE_MENU_LABELS.copyImage), click: copyImage }];
}

interface PopImageMenuDeps {
  readonly Menu: Pick<typeof Menu, 'buildFromTemplate'>;
  readonly window: BrowserWindow;
}

export function popImageMenu(
  deps: PopImageMenuDeps,
  copyImage: () => void,
  translate?: MenuTranslator,
): void {
  if (deps.window.isDestroyed()) return;
  deps.Menu.buildFromTemplate(buildImageMenuSection(copyImage, translate)).popup({
    window: deps.window,
  });
}
