import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { gitCleanEnv } from './git-clean-env.mjs';

const runners = new Map([
  ['test', 'test'],
  ['it', 'test'],
  ['describe', 'suite'],
  ['suite', 'suite'],
]);
const nonDeclarations = new Set([
  'step',
  'extend',
  'use',
  'configure',
  'setTimeout',
  'info',
  'slow',
]);
const testFile = /\.(?:test|spec|e2e)\.[cm]?[jt]sx?$/;
const printer = ts.createPrinter({ removeComments: true });

function runner(node, bindings, namespaces) {
  if (ts.isCallExpression(node) || ts.isTaggedTemplateExpression(node))
    return runner(ts.isCallExpression(node) ? node.expression : node.tag, bindings, namespaces);
  if (ts.isIdentifier(node)) return bindings.get(node.text) ?? null;
  if (!ts.isPropertyAccessExpression(node) || nonDeclarations.has(node.name.text)) return null;
  if (ts.isIdentifier(node.expression) && namespaces.has(node.expression.text))
    return runners.get(node.name.text) ?? null;
  const kind = runner(node.expression, bindings, namespaces);
  return node.name.text === 'describe' && kind ? 'suite' : kind;
}

export function testDefinitions(path, source) {
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  if (ast.parseDiagnostics.length) throw new Error(`Cannot inventory invalid syntax in ${path}`);
  const bindings = new Map(runners);
  const namespaces = new Set();
  for (const statement of ast.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause) continue;
    const module = statement.moduleSpecifier.text;
    if (!['vitest', 'bun:test', 'node:test', '@playwright/test'].includes(module)) continue;
    const clause = statement.importClause;
    if (clause.name && module === 'node:test') bindings.set(clause.name.text, 'test');
    const named = clause.namedBindings;
    if (named && ts.isNamespaceImport(named)) namespaces.add(named.name.text);
    if (named && ts.isNamedImports(named)) {
      for (const element of named.elements) {
        const kind = runners.get((element.propertyName ?? element.name).text);
        if (kind) bindings.set(element.name.text, kind);
      }
    }
  }
  const definitions = [];
  const occurrences = new Map();
  const print = (node) => printer.printNode(ts.EmitHint.Unspecified, node, ast);
  const visit = (node, suites, gates, scopeNamespaces = namespaces) => {
    if (ts.isCallExpression(node)) {
      const kind = runner(node.expression, bindings, scopeNamespaces);
      const title = node.arguments[0];
      const callback = [...node.arguments]
        .reverse()
        .find((arg) => ts.isArrowFunction(arg) || ts.isFunctionExpression(arg));
      const named = title && !ts.isArrowFunction(title) && !ts.isFunctionExpression(title);
      const callbackReference = node.arguments.length > 1 && ts.isIdentifier(node.arguments.at(-1));
      const pending =
        node.arguments.length === 1 &&
        title &&
        (ts.isStringLiteralLike(title) || ts.isTemplateExpression(title));
      const factory =
        ts.isPropertyAccessExpression(node.expression) &&
        ['skipIf', 'runIf', 'each', 'for'].includes(node.expression.name.text);
      if (kind && named && !factory && (callback || callbackReference || pending)) {
        const name = ts.isStringLiteralLike(title) ? title.text : `<expression: ${print(title)}>`;
        const titles = [...suites, name];
        const key = JSON.stringify([path, kind, titles]);
        const occurrence = occurrences.get(key) ?? 0;
        occurrences.set(key, occurrence + 1);
        const header =
          print(node.expression) +
          node.arguments
            .filter((arg) => arg !== callback)
            .map(print)
            .join(',');
        const fingerprint = createHash('sha256')
          .update(JSON.stringify([...gates, kind === 'suite' ? header : print(node)]))
          .digest('hex');
        definitions.push({
          path,
          kind,
          titles,
          occurrence,
          fingerprint,
          line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1,
        });
        const callbackNamespaces = new Set(scopeNamespaces);
        const context = callback?.parameters[0]?.name;
        if (kind === 'test' && context && ts.isIdentifier(context))
          callbackNamespaces.add(context.text);
        for (const child of node.arguments)
          visit(
            child,
            child === callback ? titles : suites,
            kind === 'suite' ? [...gates, header] : gates,
            child === callback ? callbackNamespaces : scopeNamespaces,
          );
        return;
      }
    }
    ts.forEachChild(node, (child) => visit(child, suites, gates, scopeNamespaces));
  };
  visit(ast, [], []);
  return definitions;
}

export function compareDefinitions(before, after) {
  const key = (entry) => JSON.stringify([entry.path, entry.kind, entry.titles, entry.occurrence]);
  const old = new Map(before.map((entry) => [key(entry), entry]));
  const next = new Map(after.map((entry) => [key(entry), entry]));
  return {
    removed: before.filter((entry) => !next.has(key(entry))),
    added: after.filter((entry) => !old.has(key(entry))),
    modified: after.filter(
      (entry) => old.has(key(entry)) && old.get(key(entry)).fingerprint !== entry.fingerprint,
    ),
  };
}

export function inspectTestChanges(base, head, cwd = process.cwd()) {
  const git = (...args) =>
    execFileSync('git', args, {
      cwd,
      env: gitCleanEnv(),
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    });
  const baseSha = git('rev-parse', '--verify', `${base}^{commit}`).trim();
  const headSha = git('rev-parse', '--verify', `${head}^{commit}`).trim();
  const paths = git('diff', '--name-only', '-z', '--no-renames', baseSha, headSha)
    .split('\0')
    .filter((path) => testFile.test(path));
  const filesAt = (sha) => new Set(git('ls-tree', '-r', '--name-only', '-z', sha).split('\0'));
  const oldFiles = filesAt(baseSha);
  const newFiles = filesAt(headSha);
  const before = [];
  const after = [];
  for (const path of paths) {
    if (oldFiles.has(path))
      before.push(...testDefinitions(path, git('show', `${baseSha}:${path}`)));
    if (newFiles.has(path)) after.push(...testDefinitions(path, git('show', `${headSha}:${path}`)));
  }
  return { baseSha, headSha, ...compareDefinitions(before, after) };
}

function escapeMarkdown(text) {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('|', '&#124;')
    .replaceAll('\n', ' ')
    .replaceAll('`', '&#96;')
    .replaceAll('[', '&#91;')
    .replaceAll(']', '&#93;');
}

export function renderTestChanges(report) {
  const lines = [
    '## Test definition changes',
    '',
    `Base: ${report.baseSha} · Head: ${report.headSha}`,
    '',
    'Review each removed or changed definition. Renames appear as a removal and an addition. Parameterized rows are not expanded; this is a static definition inventory, not execution coverage.',
    '',
  ];
  for (const [kind, entries] of Object.entries({
    Removed: report.removed,
    Added: report.added,
    Modified: report.modified,
  })) {
    lines.push(
      `### ${kind} (${entries.length})`,
      '',
      '| File | Definition | Kind |',
      '| --- | --- | --- |',
    );
    if (entries.length > 200)
      lines.push(
        '| Full inventory | Download the test-definition-changes artifact; this preview shows 200 entries. | |',
      );
    for (const entry of entries.slice(0, 200))
      lines.push(
        '| ' +
          escapeMarkdown(entry.path.slice(0, 400)) +
          ':' +
          entry.line +
          ' | ' +
          escapeMarkdown(entry.titles.join(' > ').slice(0, 300)) +
          ' | ' +
          entry.kind +
          ' |',
      );
    lines.push('');
  }
  return lines.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [base, head = 'HEAD', output, summary] = process.argv.slice(2);
  if (!base) throw new Error('Usage: node scripts/test-changes.mjs <base> [head] [report.json]');
  const report = inspectTestChanges(base, head);
  const markdown = renderTestChanges(report);
  if (output) writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  if (summary) appendFileSync(summary, `${markdown}\n`);
  console.log(markdown);
}
