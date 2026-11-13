import { lingui } from '@lingui/vite-plugin';
import type { RolldownBabelPreset } from '@rolldown/plugin-babel';
import { reactCompilerPreset } from '@vitejs/plugin-react';
import type { PluginOptions } from 'babel-plugin-react-compiler';

/**
 * Shared renderer Babel-pass options — single source of truth for both
 * `packages/app/vite.config.ts` and `packages/desktop/electron.vite.config.ts`.
 *
 * Keeping this here means a React Compiler tweak or a Lingui-plugin change
 * propagates to both builds without a manual mirror — same rationale as the
 * `RENDERER_DEDUPE` list in `vite.dedupe.ts`.
 */

const reactCompilerConfig: PluginOptions = {
  // Fail the build on any compiler diagnostic.
  panicThreshold: 'all_errors',
  environment: {
    validateNoDerivedComputationsInEffects: true,
    validateNoImpureFunctionsInRender: true,
  },
};

export const RENDERER_BABEL_OPTIONS: { presets: RolldownBabelPreset[] } = {
  presets: [reactCompilerPreset(reactCompilerConfig)],
};

export function rendererLinguiPlugins(configPath: string) {
  return lingui({ macroTransform: true, configPath });
}
