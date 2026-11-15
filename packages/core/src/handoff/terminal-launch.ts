import type { OpenKnowledgeMcpTool } from '../constants/mcp.ts';
import type { HandoffTarget } from './types.ts';

export function shellSingleQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

export function fishSingleQuote(s: string): string {
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

export interface TerminalLaunchCommand {
  readonly executable: string;
  readonly args: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  readonly pathPrepend?: readonly string[];
}

const TERMINAL_LAUNCH_ENV_SLOT_PREFIX = 'OK_TERMINAL_LAUNCH_ENV_';

interface TerminalLaunchEnvSlot {
  readonly name: string;
  readonly slot: string;
  readonly value: string;
}

export function terminalLaunchEnvSlots(
  env: Readonly<Record<string, string>> | undefined,
): TerminalLaunchEnvSlot[] {
  return Object.entries(env ?? {}).map(([name, value], index) => ({
    name,
    slot: `${TERMINAL_LAUNCH_ENV_SLOT_PREFIX}${index}`,
    value,
  }));
}

const TERMINAL_LAUNCH_ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function isTerminalLaunchEnvName(name: string): boolean {
  return (
    TERMINAL_LAUNCH_ENV_NAME.test(name) &&
    !name.toUpperCase().startsWith(TERMINAL_LAUNCH_ENV_SLOT_PREFIX)
  );
}

export type TerminalCli =
  | 'claude'
  | 'codex'
  | 'copilot'
  | 'cursor'
  | 'opencode'
  | 'pi'
  | 'antigravity'
  | 'openclaw'
  | 'hermes';

export interface TerminalCliInfo {
  readonly bin: string;
  readonly displayName: string;
  readonly docsUrl: string;
  readonly handoffTarget: HandoffTarget;
  readonly subcommand?: string;
  readonly promptFlag?: string;
  readonly startupInjection?: {
    readonly submit: string;
    readonly readyMarker?: string;
    readonly settleMs: number;
    readonly capMs: number;
  };
}

export const OK_GATED_TOOL_NAMES = [
  'delete',
  'move',
  'share_link',
  'install',
  'import',
] as const satisfies ReadonlyArray<OpenKnowledgeMcpTool>;

function approvedServerName(opts: BuildCliLaunchOptions): string | null {
  return opts.mcpServerName ? opts.mcpServerName : null;
}

function codexAutoApproveSetting(server: string, quote: string): string {
  return `mcp_servers.${server}.default_tools_approval_mode=${quote}approve${quote}`;
}

function buildClaudeSettingsJson(opts: BuildCliLaunchOptions): string | null {
  const server = approvedServerName(opts);
  if (server === null) return null;
  const settings: {
    enabledMcpjsonServers?: string[];
    permissions?: { allow: string[]; ask: string[] };
  } = {};
  if (opts.mcpPreApprove === true) {
    settings.enabledMcpjsonServers = [server];
  }
  if (opts.autoApproveOkTools === true) {
    settings.permissions = {
      allow: opts.cliCommandName
        ? [`mcp__${server}`, `Bash(${opts.cliCommandName} open:*)`]
        : [`mcp__${server}`],
      ask: OK_GATED_TOOL_NAMES.map((tool) => `mcp__${server}__${tool}`),
    };
  }
  if (settings.enabledMcpjsonServers === undefined && settings.permissions === undefined) {
    return null;
  }
  return JSON.stringify(settings);
}

const ESC = '\x1b';
const BRACKETED_PASTE_START = `${ESC}[200~`;
const BRACKETED_PASTE_END = `${ESC}[201~`;

const TERMINAL_LINE_BREAK_RE = /\r\n?/g;
const TERMINAL_UNSAFE_CONTROL_RE = new RegExp(
  '[' + '\\u0000-\\u0008' + '\\u000b-\\u001f' + '\\u007f-\\u009f' + ']',
  'g',
);
const TRAILING_LINE_BREAKS_RE = /\n*$/;

export const TERMINAL_CONTROL_LABEL_NOTICE =
  'Control characters in the text above are shown as <control-NNNN> labels; the source document holds the raw characters.';

function controlLabel(control: string): string {
  const codePoint = control.codePointAt(0) ?? 0;
  return `<control-${codePoint.toString(16).toUpperCase().padStart(4, '0')}>`;
}

export function toTerminalPromptText(text: string): string {
  let labeled = false;
  const printable = text
    .replace(TERMINAL_LINE_BREAK_RE, '\n')
    .replace(TERMINAL_UNSAFE_CONTROL_RE, (control) => {
      labeled = true;
      return controlLabel(control);
    });
  if (!labeled) return printable;
  const trailing = TRAILING_LINE_BREAKS_RE.exec(printable)?.[0] ?? '';
  const body = printable.slice(0, printable.length - trailing.length);
  return `${body}\n\n${TERMINAL_CONTROL_LABEL_NOTICE}${trailing}`;
}

export function buildTerminalInputBytes(text: string, bracketedPaste: boolean): string {
  const printable = toTerminalPromptText(text);
  return bracketedPaste ? `${BRACKETED_PASTE_START}${printable}${BRACKETED_PASTE_END}` : printable;
}

export const BRACKETED_PASTE_ENABLE_MARKER = '\x1b[?2004h';
const HERMES_INJECT_DEBOUNCE_MS = 300;
const HERMES_INJECT_CAP_MS = 4000;

export const TERMINAL_CLIS = {
  claude: {
    bin: 'claude',
    displayName: 'Claude',
    docsUrl: 'https://docs.claude.com/en/docs/claude-code',
    handoffTarget: 'claude-code',
  },
  codex: {
    bin: 'codex',
    displayName: 'Codex',
    docsUrl: 'https://developers.openai.com/codex/cli',
    handoffTarget: 'codex',
  },
  copilot: {
    bin: 'copilot',
    displayName: 'GitHub Copilot',
    docsUrl: 'https://docs.github.com/en/copilot/how-tos/copilot-cli/cli-getting-started',
    handoffTarget: 'copilot',
    promptFlag: '--interactive',
  },
  cursor: {
    bin: 'cursor-agent',
    displayName: 'Cursor',
    docsUrl: 'https://cursor.com/docs/cli/overview',
    handoffTarget: 'cursor',
  },
  opencode: {
    bin: 'opencode',
    displayName: 'OpenCode',
    docsUrl: 'https://opencode.ai/docs',
    handoffTarget: 'opencode',
    promptFlag: '--prompt',
  },
  pi: {
    bin: 'pi',
    displayName: 'Pi',
    docsUrl: 'https://pi.dev',
    handoffTarget: 'pi',
  },
  antigravity: {
    bin: 'agy',
    displayName: 'Antigravity',
    docsUrl: 'https://antigravity.google/docs/cli-getting-started',
    handoffTarget: 'antigravity',
    promptFlag: '--prompt-interactive',
  },
  openclaw: {
    bin: 'openclaw',
    subcommand: 'chat',
    displayName: 'OpenClaw',
    docsUrl: 'https://docs.openclaw.ai/cli/tui',
    handoffTarget: 'openclaw',
    promptFlag: '--message',
  },
  hermes: {
    bin: 'hermes',
    subcommand: 'chat',
    displayName: 'Hermes',
    docsUrl: 'https://hermes-agent.nousresearch.com/docs/user-guide/cli',
    handoffTarget: 'hermes',
    startupInjection: {
      submit: '\r',
      readyMarker: BRACKETED_PASTE_ENABLE_MARKER,
      settleMs: HERMES_INJECT_DEBOUNCE_MS,
      capMs: HERMES_INJECT_CAP_MS,
    },
  },
} as const satisfies Record<TerminalCli, TerminalCliInfo>;

export const TERMINAL_CLI_IDS = [
  'claude',
  'codex',
  'opencode',
  'cursor',
  'copilot',
  'pi',
  'antigravity',
  'openclaw',
  'hermes',
] as const satisfies readonly TerminalCli[];

export interface BuildCliLaunchOptions {
  readonly mcpPreApprove?: boolean;
  readonly autoApproveOkTools?: boolean;
  readonly mcpServerName?: string;
  readonly cliCommandName?: string;
}

export function buildPosixCliLaunch(
  cli: TerminalCli,
  prompt: string | null | undefined,
  opts: BuildCliLaunchOptions = {},
): TerminalLaunchCommand {
  const info: TerminalCliInfo = TERMINAL_CLIS[cli];
  const server = approvedServerName(opts);
  const settingsJson = cli === 'claude' ? buildClaudeSettingsJson(opts) : null;
  const fixedArgs =
    settingsJson !== null
      ? ['--settings', settingsJson]
      : cli === 'codex' && opts.autoApproveOkTools === true && server !== null
        ? ['-c', codexAutoApproveSetting(server, '"')]
        : [];
  const args = [...(info.subcommand ? [info.subcommand] : []), ...fixedArgs];
  if (info.startupInjection != null || prompt == null || prompt.length === 0) {
    return { executable: info.bin, args };
  }
  return {
    executable: info.bin,
    args: [...args, ...(info.promptFlag ? [info.promptFlag] : []), toTerminalPromptText(prompt)],
  };
}

export function startupInjectionFor(cli: TerminalCli): TerminalCliInfo['startupInjection'] {
  const info: TerminalCliInfo = TERMINAL_CLIS[cli];
  return info.startupInjection;
}

export function buildStartupInjectionBytes(
  cli: TerminalCli,
  prompt: string | null | undefined,
): string | null {
  const injection = startupInjectionFor(cli);
  if (injection == null || prompt == null || prompt.length === 0) return null;
  return `${buildTerminalInputBytes(prompt, true)}${injection.submit}`;
}
