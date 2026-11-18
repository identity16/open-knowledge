import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '../..');
export const FRAGMENT_DIR = join(ROOT, 'changes');
export const CHANGELOG_PATH = join(ROOT, 'CHANGELOG.md');

export const FRAGMENT_TYPES = ['feature', 'fix', 'change'];
const TYPE_HEADINGS = { feature: 'Features', fix: 'Fixes', change: 'Changes' };

const CHANGELOG_PREAMBLE =
  '# Changelog\n\nUser-facing changes in each OpenKnowledge16 release, newest first.\n';

const VERSION = /^\d+\.\d+\.\d+$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SECTION_HEADING = /^## (\d+\.\d+\.\d+)(?: \((\d{4}-\d{2}-\d{2})\))?\s*$/;

export function changelogPath(env = process.env) {
  return env.OK_CHANGELOG_PATH || CHANGELOG_PATH;
}

export function parseFragment(text, name) {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text.replace(/\r\n/g, '\n'));
  if (!match) throw new Error(`${name}: expected a frontmatter block with a type, then the note.`);
  const type = /^type:\s*(\S+)\s*$/m.exec(match[1])?.[1];
  if (!FRAGMENT_TYPES.includes(type))
    throw new Error(`${name}: type must be one of ${FRAGMENT_TYPES.join(', ')}.`);
  const note = match[2]
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ');
  if (note === '') throw new Error(`${name}: the note is empty.`);
  return { type, note };
}

export function renderSection(version, date, fragments) {
  if (!VERSION.test(version)) throw new Error(`Not a release version: ${version}`);
  if (!DATE.test(date)) throw new Error(`Not a YYYY-MM-DD date: ${date}`);
  if (fragments.length === 0) throw new Error('There are no change notes to release.');
  const parts = [`## ${version} (${date})`];
  for (const type of FRAGMENT_TYPES) {
    const notes = fragments.filter((fragment) => fragment.type === type);
    if (notes.length === 0) continue;
    parts.push(`### ${TYPE_HEADINGS[type]}`, notes.map((f) => `- ${f.note}`).join('\n'));
  }
  return `${parts.join('\n\n')}\n`;
}

export function sectionVersions(changelog) {
  return changelog.split('\n').flatMap((line) => {
    const heading = SECTION_HEADING.exec(line);
    return heading ? [heading[1]] : [];
  });
}

export function prependSection(changelog, section) {
  const version = SECTION_HEADING.exec(section.split('\n')[0])?.[1];
  if (!version) throw new Error('The section does not start with a version heading.');
  if (sectionVersions(changelog).includes(version))
    throw new Error(`CHANGELOG.md already has a section for ${version}.`);
  const body = changelog.trim() === '' ? CHANGELOG_PREAMBLE : changelog;
  const first = body.search(/^## /m);
  if (first === -1) return `${body.trimEnd()}\n\n${section}`;
  return `${body.slice(0, first)}${section}\n${body.slice(first)}`;
}

export function releaseNotes(changelog, version) {
  const lines = changelog.split('\n');
  const start = lines.findIndex((line) => SECTION_HEADING.exec(line)?.[1] === version);
  if (start === -1) return null;
  const end = lines.findIndex((line, i) => i > start && line.startsWith('## '));
  const body = lines
    .slice(start + 1, end === -1 ? undefined : end)
    .join('\n')
    .trim();
  return body === '' ? null : body;
}

export function requireReleaseNotes(version, env = process.env) {
  const path = changelogPath(env);
  let changelog;
  try {
    changelog = readFileSync(path, 'utf8');
  } catch {
    throw new Error(`No CHANGELOG.md at ${path}; run \`pnpm changelog:release ${version}\` first.`);
  }
  const notes = releaseNotes(changelog, version);
  if (notes === null)
    throw new Error(
      `CHANGELOG.md has no notes for ${version}; run \`pnpm changelog:release ${version}\` and merge it before releasing.`,
    );
  return notes;
}

export function readFragments(directory = FRAGMENT_DIR) {
  let names;
  try {
    names = readdirSync(directory);
  } catch {
    return [];
  }
  return names
    .filter((name) => name.endsWith('.md') && name !== 'README.md')
    .sort()
    .map((name) => ({
      path: join(directory, name),
      ...parseFragment(readFileSync(join(directory, name), 'utf8'), name),
    }));
}

export function cutRelease(
  version,
  { date, directory = FRAGMENT_DIR, path = CHANGELOG_PATH } = {},
) {
  const fragments = readFragments(directory);
  const section = renderSection(version, date, fragments);
  const changelog = existsSync(path) ? readFileSync(path, 'utf8') : '';
  writeFileSync(path, prependSection(changelog, section));
  for (const fragment of fragments) rmSync(fragment.path);
  return { section, consumed: fragments.length };
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [command, version, ...rest] = process.argv.slice(2);
  const dateFlag = rest.indexOf('--date');
  const date = dateFlag === -1 ? today() : rest[dateFlag + 1];
  try {
    if (command === 'release') {
      const { section, consumed } = cutRelease(version, { date });
      process.stdout.write(
        `${section}\nWrote ${version} to CHANGELOG.md from ${consumed} note(s).\n`,
      );
    } else if (command === 'notes') {
      process.stdout.write(`${requireReleaseNotes(version)}\n`);
    } else {
      throw new Error(
        'Usage: changelog.mjs release <version> [--date YYYY-MM-DD] | notes <version>',
      );
    }
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
