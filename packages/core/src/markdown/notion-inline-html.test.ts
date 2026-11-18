import { describe, expect, test } from 'vitest';
import { notionInlineHtmlToMarkdown } from './notion-inline-html.ts';

describe('notionInlineHtmlToMarkdown', () => {
  test.each([
    ['Ship <b>now</b>.', 'Ship **now**.'],
    ['<strong>a</strong> and <em>b</em>', '**a** and *b*'],
    ['<i>tilt</i>, <s>gone</s>, <del>old</del>', '*tilt*, ~~gone~~, ~~old~~'],
    ['run <code>pnpm i</code>', 'run `pnpm i`'],
    ['<code>a`b</code>', '``a`b``'],
    ['<code>&lt;div&gt;</code>', '`<div>`'],
    ['<b>bold <i>both</i></b>', '**bold *both***'],
    ['plain text stays', 'plain text stays'],
  ])('%s', (input, expected) => {
    expect(notionInlineHtmlToMarkdown(input)).toBe(expected);
  });

  test('leaves fenced code untouched', () => {
    const input = 'before <b>x</b>\n```html\n<b>keep</b>\n```\nafter <i>y</i>';
    expect(notionInlineHtmlToMarkdown(input)).toBe(
      'before **x**\n```html\n<b>keep</b>\n```\nafter *y*',
    );
  });

  test('keeps underline, which markdown cannot express', () => {
    expect(notionInlineHtmlToMarkdown('<u>under</u>')).toBe('<u>under</u>');
  });

  test('is idempotent on markdown that has no inline HTML', () => {
    const md = '# Title\n\n- **one**\n- *two*\n\n| a | b |\n| --- | --- |\n| 1 | 2 |';
    expect(notionInlineHtmlToMarkdown(md)).toBe(md);
  });
});
