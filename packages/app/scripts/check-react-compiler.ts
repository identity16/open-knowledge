import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { transform } from 'oxc-transform-react';
import { REACT_COMPILER_OPTIONS } from '../vite.renderer-plugins.ts';

const appRoot = resolve(import.meta.dirname, '..');

export function compilerTargets(files: readonly string[]): string[] {
  return files.filter((file) => {
    const path = relative(appRoot, resolve(file));
    return (
      path.startsWith('src/') &&
      /\.tsx?$/.test(path) &&
      !/\.(?:test|test-helper|reads|d)\.tsx?$/.test(path) &&
      !/\.(?:dom|browser|node)\.test\.tsx?$/.test(path)
    );
  });
}

export async function compileErrors(path: string, code: string): Promise<string[]> {
  const result = await transform(path, code, {
    jsx: { runtime: 'automatic', development: false },
    reactCompiler: REACT_COMPILER_OPTIONS,
    sourcemap: false,
  });
  if (!result.fatal) return [];
  return result.errors.map(
    (error) => `${error.message}${error.codeframe ? `\n${error.codeframe}` : ''}`,
  );
}

async function main() {
  const targets = compilerTargets(process.argv.slice(2));
  let failed = 0;
  for (const file of targets) {
    const errors = await compileErrors(resolve(file), readFileSync(file, 'utf8'));
    if (errors.length === 0) continue;
    failed += 1;
    console.error(`✗ ${relative(appRoot, resolve(file))}\n${errors.join('\n\n')}\n`);
  }
  console.log(`React Compiler: ${targets.length - failed}/${targets.length} files compiled.`);
  if (failed > 0) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) await main();
