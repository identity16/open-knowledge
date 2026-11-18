const INLINE_MARKS: ReadonlyArray<readonly [RegExp, string]> = [
  [/<(?:b|strong)>([\s\S]*?)<\/(?:b|strong)>/g, '**$1**'],
  [/<(?:i|em)>([\s\S]*?)<\/(?:i|em)>/g, '*$1*'],
  [/<(?:s|del|strike)>([\s\S]*?)<\/(?:s|del|strike)>/g, '~~$1~~'],
];

const FENCE = /^(\s*)(`{3,}|~{3,})/;

function inlineCode(text: string): string {
  return text.replace(/<code>([\s\S]*?)<\/code>/g, (_match, inner: string) => {
    const decoded = inner.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
    const longest = Math.max(0, ...[...decoded.matchAll(/`+/g)].map((m) => m[0].length));
    const ticks = '`'.repeat(longest + 1);
    const pad = decoded.startsWith('`') || decoded.endsWith('`') ? ' ' : '';
    return `${ticks}${pad}${decoded}${pad}${ticks}`;
  });
}

function convertLine(line: string): string {
  let out = inlineCode(line);
  for (let pass = 0; pass < 3; pass++) {
    const before = out;
    for (const [pattern, replacement] of INLINE_MARKS) out = out.replace(pattern, replacement);
    if (out === before) break;
  }
  return out;
}

export function notionInlineHtmlToMarkdown(markdown: string): string {
  const lines = markdown.split('\n');
  let fence: string | null = null;
  return lines
    .map((line) => {
      const match = FENCE.exec(line);
      if (match) {
        const marker = match[2] ?? '';
        if (fence === null) fence = marker[0] ?? null;
        else if (marker[0] === fence) fence = null;
        return line;
      }
      return fence === null ? convertLine(line) : line;
    })
    .join('\n');
}
