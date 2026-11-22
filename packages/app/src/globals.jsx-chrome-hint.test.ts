import { describe, expect, test } from 'vitest';
import { collectBlocks, readGlobalsCssWithoutComments } from './globals-css.test-helper';

const hintRules = collectBlocks(readGlobalsCssWithoutComments()).filter(
  (block) =>
    block.prelude.includes('[data-needs-config="true"]') &&
    /display\s*:\s*none/.test(block.declarations),
);

describe('globals.css — unconfigured JSX chrome hint', () => {
  test('the rule that hides the non-gear buttons exists (guard is not vacuous)', () => {
    expect(hintRules).toHaveLength(1);
  });

  test('keeps the gear by a locale-independent attribute, so it stays the popover anchor in every locale', () => {
    const [rule] = hintRules;
    expect(rule?.prelude).toContain('button:not([data-jsx-gear])');
    expect(rule?.prelude).not.toMatch(/aria-label/);
  });
});
