import type {
  BuildSpellcheckMenuTemplateParams,
  SpellcheckMenuActions,
  SpellcheckMenuParams,
} from './spellcheck-menu.ts';

export interface ContextMenuHandlerParams extends SpellcheckMenuParams {
  readonly isEditable: boolean;
  readonly mediaType: string;
  readonly hasImageContents: boolean;
  readonly x: number;
  readonly y: number;
}

export interface SpellcheckWebContents {
  on(
    event: 'context-menu',
    listener: (event: unknown, params: ContextMenuHandlerParams) => void,
  ): void;
  replaceMisspelling(text: string): void;
  showDefinitionForSelection(): void;
  copyImageAt(x: number, y: number): void;
}

export interface SpellcheckContextMenuDeps {
  readonly isSpellCheckEnabled: () => boolean;
  readonly canViewInSource: () => boolean;
  readonly setSpellCheckEnabled: (enabled: boolean) => void;
  readonly addToDictionary: (word: string) => void;
  readonly openExternal: (url: string) => void;
  readonly viewInSource: () => void;
  readonly popMenu: (input: BuildSpellcheckMenuTemplateParams) => void;
  readonly popImageMenu: (copyImage: () => void) => void;
}

function googleSearchUrl(query: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

export function attachSpellcheckContextMenu(
  webContents: SpellcheckWebContents,
  deps: SpellcheckContextMenuDeps,
): void {
  webContents.on('context-menu', (_event, params) => {
    const copyImage =
      params.mediaType === 'image' && params.hasImageContents
        ? () => {
            webContents.copyImageAt(params.x, params.y);
          }
        : undefined;
    if (!params.isEditable) {
      if (copyImage !== undefined) deps.popImageMenu(copyImage);
      return;
    }
    const actions: SpellcheckMenuActions = {
      copyImage,
      replaceMisspelling: (suggestion) => {
        webContents.replaceMisspelling(suggestion);
      },
      addToDictionary: (word) => {
        deps.addToDictionary(word);
      },
      setSpellCheckEnabled: (enabled) => {
        deps.setSpellCheckEnabled(enabled);
      },
      lookUp: () => {
        webContents.showDefinitionForSelection();
      },
      search: (query) => {
        deps.openExternal(googleSearchUrl(query));
      },
      viewInSource: () => {
        deps.viewInSource();
      },
    };
    deps.popMenu({
      params,
      spellCheckEnabled: deps.isSpellCheckEnabled(),
      canViewInSource: deps.canViewInSource(),
      actions,
    });
  });
}
