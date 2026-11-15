import { expect } from '@playwright/test';
import type { BootLogSnapshot } from './launch-readiness';

const DIAGNOSTIC_ATTACHMENT_MAX_BYTES = 128 * 1024;
const SCREEN_JPEG_QUALITIES = [60, 40, 20, 10] as const;

export async function waitForShellReady(
  readTerminalText: () => Promise<string>,
  _sendTerminalCommand: (command: string) => Promise<void>,
  { timeout = 30_000, quietPolls = 3, interval = 250 }: WaitForShellReadyOptions = {},
): Promise<void> {
  await waitForQuietTerminalText(readTerminalText, timeout, quietPolls, interval);
}

export async function captureTerminalStartupDiagnostics({
  readBootLog,
  readTerminalDom,
  captureScreen,
  attach,
}: TerminalStartupDiagnosticSources): Promise<void> {
  await attach('terminal-startup-boot-log', {
    body: boundedJson(readBootLog()),
    contentType: 'application/json',
  });
  await attach('terminal-startup-dom', {
    body: boundedJson(await readTerminalDom()),
    contentType: 'application/json',
  });
  let screen = await captureScreen({ quality: SCREEN_JPEG_QUALITIES[0] });
  const originalBytes = screen.byteLength;
  for (const quality of SCREEN_JPEG_QUALITIES.slice(1)) {
    if (screen.byteLength <= DIAGNOSTIC_ATTACHMENT_MAX_BYTES) break;
    screen = await captureScreen({ quality });
  }
  if (screen.byteLength <= DIAGNOSTIC_ATTACHMENT_MAX_BYTES) {
    await attach('terminal-startup-screen', {
      body: screen,
      contentType: 'image/jpeg',
    });
  } else {
    await attach('terminal-startup-screen', {
      body: boundedJson({ truncated: true, originalBytes }),
      contentType: 'application/json',
    });
  }
}

function boundedJson(value: unknown): string {
  const source = JSON.stringify(value) ?? 'null';
  const originalBytes = Buffer.byteLength(source, 'utf8');
  if (originalBytes <= DIAGNOSTIC_ATTACHMENT_MAX_BYTES) return source;
  let end = source.slice(-DIAGNOSTIC_ATTACHMENT_MAX_BYTES);
  let body = JSON.stringify({ truncated: true, originalBytes, end });
  while (Buffer.byteLength(body, 'utf8') > DIAGNOSTIC_ATTACHMENT_MAX_BYTES && end.length > 0) {
    end = end.slice(1024);
    body = JSON.stringify({ truncated: true, originalBytes, end });
  }
  return body;
}

async function _waitForTerminalText(
  readTerminalText: () => Promise<string>,
  pattern: RegExp,
  label: string,
  timeout: number,
  interval: number,
): Promise<void> {
  await expect(async () => {
    expect(await readTerminalText(), label).toMatch(pattern);
  }).toPass({ timeout, intervals: [interval] });
}

export async function waitForTerminalOutput(
  readTerminalText: () => Promise<string>,
  expected: string,
  { stallMs }: WaitForTerminalOutputOptions,
): Promise<void> {
  const startedAt = performance.now();
  let lastText: string | undefined;
  let lastChangeSeenAt = startedAt;
  let reads = 0;
  let changes = 0;
  let slowestReadMs = 0;
  await expect
    .poll(
      async () => {
        const readStartedAt = performance.now();
        const text = await readTerminalText();
        const readEndedAt = performance.now();
        reads += 1;
        slowestReadMs = Math.max(slowestReadMs, readEndedAt - readStartedAt);
        if (text !== lastText) {
          lastText = text;
          lastChangeSeenAt = readEndedAt;
          changes += 1;
          return text;
        }
        const quietMs = readStartedAt - lastChangeSeenAt;
        if (quietMs < stallMs) return text;
        throw new Error(
          `The terminal output stopped advancing before it showed ${JSON.stringify(expected)}: it has not changed for ${Math.round(quietMs)} ms, which reaches this wait's declared stall window of ${stallMs} ms. It last changed ${Math.round(lastChangeSeenAt - startedAt)} ms after the wait began; the wait made ${reads} reads in ${Math.round(readEndedAt - startedAt)} ms, ${changes} of which changed the text, and its slowest read took ${Math.round(slowestReadMs)} ms. Last read: ${JSON.stringify(text)}`,
        );
      },
      { message: `the terminal output shows ${expected}`, timeout: 0 },
    )
    .toContain(expected);
}

async function waitForQuietTerminalText(
  readTerminalText: () => Promise<string>,
  timeout: number,
  quietPolls: number,
  interval: number,
): Promise<void> {
  let previous: string | null = null;
  let stable = 0;
  await expect(async () => {
    const current = (await readTerminalText()).replace(/\s+$/, '');
    stable = current.length > 0 && current === previous ? stable + 1 : 0;
    previous = current;
    if (stable < quietPolls) {
      throw new Error(
        `terminal text quiet for ${stable} of ${quietPolls} polls; last read ${JSON.stringify(current)}`,
      );
    }
  }).toPass({ timeout, intervals: [interval] });
}

export interface WaitForShellReadyOptions {
  timeout?: number;
  quietPolls?: number;
  interval?: number;
  platform?: NodeJS.Platform;
  onPrimaryPromptFailure?: () => Promise<void>;
}

export interface WaitForTerminalOutputOptions {
  stallMs: number;
}

export interface TerminalDomText {
  readonly a11y: readonly string[];
  readonly rows: readonly string[];
}

export interface ScreenCaptureSetting {
  readonly quality: number;
}

export interface DiagnosticAttachment {
  readonly body: string | Buffer;
  readonly contentType: string;
}

export interface TerminalStartupDiagnosticSources {
  readonly readBootLog: () => BootLogSnapshot;
  readonly readTerminalDom: () => Promise<TerminalDomText>;
  readonly captureScreen: (setting: ScreenCaptureSetting) => Promise<Buffer>;
  readonly attach: (name: string, attachment: DiagnosticAttachment) => Promise<void>;
}
