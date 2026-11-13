import { lingui } from '@lingui/vite-plugin';
import react, { type ReactCompilerOptions } from '@vitejs/plugin-react';

export const REACT_COMPILER_OPTIONS: ReactCompilerOptions = {
  panicThreshold: 'all_errors',
  environment: {
    validateNoDerivedComputationsInEffects: true,
    validateNoImpureFunctionsInRender: true,
  },
};

export function rendererPlugins({
  linguiConfigPath,
  compilerExclude,
}: {
  linguiConfigPath: string;
  compilerExclude?: readonly RegExp[];
}) {
  return [
    ...lingui({ macroTransform: true, configPath: linguiConfigPath }),
    react({
      compiler: REACT_COMPILER_OPTIONS,
      ...(compilerExclude ? { exclude: [...compilerExclude] } : {}),
    }),
  ];
}
