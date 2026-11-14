import { describe, expect, test } from 'vitest';
import { compileErrors, compilerTargets } from './check-react-compiler.ts';

describe('React Compiler check', () => {
  test('rejects a ref read handed to a function during render', async () => {
    const code = `
      import { useRef, useState } from 'react';
      function makeComparator(read: () => number) { return () => read(); }
      export function Tree() {
        const ref = useRef(1);
        const [compare] = useState(() => makeComparator(() => ref.current));
        return <div>{String(compare)}</div>;
      }
    `;
    const errors = await compileErrors('/virtual/Tree.tsx', code);
    expect(errors.join('\\n')).toMatch(/refs during render/i);
  });

  test('accepts a ref read inside an event-time callback', async () => {
    const code = `
      import { useRef } from 'react';
      export function Tree() {
        const ref = useRef(1);
        return <button type="button" onClick={() => console.log(ref.current)}>x</button>;
      }
    `;
    expect(await compileErrors('/virtual/Tree.tsx', code)).toEqual([]);
  });

  test('checks app source files and skips tests and declarations', () => {
    expect(
      compilerTargets([
        'src/components/FileTree.tsx',
        'src/lib/file-tree-sort.ts',
        'src/components/FileTree.dom.test.tsx',
        'src/lib/file-tree-sort.test.ts',
        'src/env.d.ts',
        'scripts/check-react-compiler.ts',
      ]),
    ).toEqual(['src/components/FileTree.tsx', 'src/lib/file-tree-sort.ts']);
  });
});
