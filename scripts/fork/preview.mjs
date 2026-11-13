import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const appDir = resolve(root, 'packages/app');
const previewRoot = '/tmp/ok-fork-preview';
const fixtureDir = join(previewRoot, 'knowledge-base');
const outputDir = join(previewRoot, 'latest');

export const viewports = {
  mobile: { viewport: { width: 375, height: 740 }, isMobile: true, hasTouch: true },
  desktop: { viewport: { width: 1280, height: 800 } },
};

const fixtureDocs = {
  'README.md': `# Preview workspace

A **sample** document with a [link](guides/setup.md), a list and a table.

- A list item long enough to wrap on a phone screen without trouble
- Another item

| Column A | Column B | Column C | Column D |
|---|---|---|---|
| a long cell value | another long cell | third | fourth value |

\`\`\`ts
const someVeryLongVariableName = await fetchSomethingFromTheServer({ id: 123 });
\`\`\`
`,
  'guides/setup.md': '---\ntitle: Setup guide\ntags: [setup]\n---\n# Setup guide\n\nStep one.\n',
  'long.md': `# Long document\n\n${Array.from(
    { length: 60 },
    (_, index) => `Paragraph ${index}: lorem ipsum dolor sit amet, consectetur adipiscing elit.`,
  ).join('\n\n')}\n`,
};

export function parseArgs(argv) {
  const options = { url: null, docs: [], viewports: Object.keys(viewports) };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];
    if (arg === '--url') options.url = value;
    else if (arg === '--doc') options.docs.push(value);
    else if (arg === '--viewport') options.viewports = value.split(',');
    else throw new Error(`Unknown argument: ${arg}`);
    index += 1;
  }
  for (const name of options.viewports) {
    if (!(name in viewports)) throw new Error(`Unknown viewport: ${name}`);
  }
  if (options.docs.length === 0 && options.url === null) options.docs = ['README', 'long'];
  return options;
}

export function shotName(viewport, doc) {
  const page = doc === null ? 'home' : doc.replace(/[^A-Za-z0-9._-]+/g, '_');
  return `${viewport}-${page}.png`;
}

function writeFixture() {
  for (const [path, content] of Object.entries(fixtureDocs)) {
    const file = join(fixtureDir, path);
    if (existsSync(file)) continue;
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, content);
  }
  if (!existsSync(join(fixtureDir, '.git')))
    spawnSync('git', ['init', '-q'], { cwd: fixtureDir, stdio: 'ignore' });
}

async function waitFor(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(2_000) })).ok) return;
    } catch {}
    await new Promise((settle) => setTimeout(settle, 1_000));
  }
  throw new Error(`Dev server did not answer at ${url}.`);
}

function startDevServer(port) {
  const child = spawn('pnpm', ['run', 'dev', '--', '--port', String(port), '--strictPort'], {
    cwd: appDir,
    detached: true,
    stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, OK_TEST_CONTENT_DIR: fixtureDir, VITE_PORT: String(port) },
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-4_000);
  });
  return {
    child,
    stderr: () => stderr,
    stop: () => {
      if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
      process.kill(-child.pid, 'SIGTERM');
    },
  };
}

function loadWebkit() {
  const require = createRequire(join(appDir, 'package.json'));
  const { webkit, devices } = require('playwright');
  if (!existsSync(webkit.executablePath())) {
    const install = spawnSync('pnpm', ['exec', 'playwright', 'install', 'webkit'], {
      cwd: appDir,
      stdio: 'inherit',
    });
    if (install.status !== 0) throw new Error('Could not install the Playwright WebKit browser.');
  }
  return { webkit, devices };
}

async function capture({ url, docs, viewports: names }) {
  const { webkit, devices } = loadWebkit();
  rmSync(outputDir, { recursive: true, force: true });
  mkdirSync(outputDir, { recursive: true });
  const browser = await webkit.launch();
  const written = [];
  try {
    for (const name of names) {
      const options = { ...viewports[name], deviceScaleFactor: 2 };
      if (options.isMobile) options.userAgent = devices['iPhone 13'].userAgent;
      const context = await browser.newContext(options);
      const page = await context.newPage();
      for (const doc of [null, ...docs]) {
        const target = doc === null ? url : `${url}#/${encodeURI(doc)}`;
        await page.goto(target, { waitUntil: 'networkidle' });
        await page.waitForTimeout(1_500);
        const file = join(outputDir, shotName(name, doc));
        await page.screenshot({ path: file });
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth > window.innerWidth,
        );
        written.push({ file, overflow });
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }
  return written;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  let server = null;
  let url = options.url;
  if (url === null) {
    writeFixture();
    const port = 5190 + Math.floor(Math.random() * 7);
    url = `http://localhost:${port}/`;
    server = startDevServer(port);
    try {
      await waitFor(url, 180_000);
    } catch (error) {
      server.stop();
      throw new Error(`${error.message}\n${server.stderr()}`);
    }
  }
  try {
    const shots = await capture({ ...options, url });
    for (const { file, overflow } of shots)
      console.log(`${file}${overflow ? '  ⚠ horizontal overflow' : ''}`);
  } finally {
    server?.stop();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
