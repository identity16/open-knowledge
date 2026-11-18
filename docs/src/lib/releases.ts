import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { marked } from 'marked';

const REPO_URL = 'https://github.com/identity16/open-knowledge';

const CHANGELOG_PATH = join(process.cwd(), '..', 'CHANGELOG.md');

export interface ReleaseNote {
  tag: string;
  title: string;
  publishedAt: string | null;
  bodyHtml: string;
  htmlUrl: string;
}

const SECTION_HEADING = /^## (\d+\.\d+\.\d+)(?: \((\d{4}-\d{2}-\d{2})\))?\s*$/;

function renderNotes(markdown: string): string {
  const body = markdown.trim();
  if (!body) return '';
  return marked.parse(body, { gfm: true, async: false });
}

export function parseChangelog(markdown: string): ReleaseNote[] {
  const releases: ReleaseNote[] = [];
  let current: { version: string; date: string | null } | null = null;
  let body: string[] = [];

  const flush = () => {
    if (current === null) return;
    const tag = `v${current.version}`;
    releases.push({
      tag,
      title: tag,
      publishedAt: current.date === null ? null : `${current.date}T00:00:00.000Z`,
      bodyHtml: renderNotes(body.join('\n')),
      htmlUrl: `${REPO_URL}/releases/tag/${tag}`,
    });
  };

  for (const line of markdown.split('\n')) {
    const heading = SECTION_HEADING.exec(line);
    if (heading) {
      flush();
      current = { version: heading[1] ?? '', date: heading[2] ?? null };
      body = [];
    } else if (current !== null) {
      if (line.startsWith('## ')) {
        flush();
        current = null;
      } else body.push(line);
    }
  }
  flush();
  return releases;
}

type BuildEnv = Readonly<Record<string, string | undefined>>;

function readChangelog(path: string, env: BuildEnv): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch (err) {
    if ((err as { code?: string } | null)?.code !== 'ENOENT') throw err;
    const message =
      `[changelog] CHANGELOG.md not found at ${path}. The docs build reads the repository root; ` +
      "on Vercel, enable 'Include files outside the Root Directory'.";
    if (env.VERCEL_ENV === 'production') throw new Error(message);
    console.warn(`${message} Building an empty changelog.`);
    return null;
  }
}

export async function loadStableReleases(
  limit = Number.POSITIVE_INFINITY,
  deps: { path?: string; env?: BuildEnv } = {},
): Promise<ReleaseNote[]> {
  const path = deps.path ?? CHANGELOG_PATH;
  const markdown = readChangelog(path, deps.env ?? process.env);
  if (markdown === null) return [];
  const releases = parseChangelog(markdown);
  if (releases.length === 0) {
    throw new Error(`[changelog] CHANGELOG.md at ${path} has no \`## X.Y.Z\` sections.`);
  }
  return Number.isFinite(limit) ? releases.slice(0, limit) : releases;
}
