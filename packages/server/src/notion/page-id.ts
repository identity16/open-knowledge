const HEX32 = /([0-9a-f]{32})(?![0-9a-f])/i;
const DASHED = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

function dashed(hex: string): string {
  const h = hex.toLowerCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function parseNotionPageId(input: string): string | null {
  const text = input.trim();
  if (text === '') return null;
  let candidate = text;
  try {
    const url = new URL(text);
    if (!/(^|\.)notion\.(so|site|com)$/i.test(url.hostname)) return null;
    candidate = url.pathname;
  } catch {}
  const dashedMatch = DASHED.exec(candidate);
  if (dashedMatch?.[1]) return dashedMatch[1].toLowerCase();
  const hexMatch = HEX32.exec(candidate.replaceAll('-', ''));
  const lastSegment = candidate.split('/').filter(Boolean).at(-1) ?? candidate;
  const tail = HEX32.exec(lastSegment.slice(-32));
  const hex = tail?.[1] ?? hexMatch?.[1];
  return hex ? dashed(hex) : null;
}
