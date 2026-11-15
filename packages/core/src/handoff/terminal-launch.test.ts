import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';
import { MCP_SERVER_NAME } from '../constants/mcp.ts';
import { DESKTOP_PRODUCTS } from '../constants/product.ts';
import {
  buildPosixCliLaunch,
  buildStartupInjectionBytes,
  buildTerminalInputBytes,
  OK_GATED_TOOL_NAMES,
  shellSingleQuote,
  startupInjectionFor,
  TERMINAL_CLI_IDS,
  TERMINAL_CLIS,
  TERMINAL_CONTROL_LABEL_NOTICE,
  toTerminalPromptText,
} from './terminal-launch.ts';

const OK_ALLOW = `["mcp__${MCP_SERVER_NAME}","Bash(ok open:*)"]`;
const OK_ASK = `["mcp__${MCP_SERVER_NAME}__delete","mcp__${MCP_SERVER_NAME}__move","mcp__${MCP_SERVER_NAME}__share_link","mcp__${MCP_SERVER_NAME}__install","mcp__${MCP_SERVER_NAME}__import"]`;
const CLAUDE_PREAPPROVE_JSON = `{"enabledMcpjsonServers":["${MCP_SERVER_NAME}"]}`;
const CLAUDE_AUTO_APPROVE_JSON = `{"permissions":{"allow":${OK_ALLOW},"ask":${OK_ASK}}}`;
const CLAUDE_BOTH_JSON = `{"enabledMcpjsonServers":["${MCP_SERVER_NAME}"],"permissions":{"allow":${OK_ALLOW},"ask":${OK_ASK}}}`;
const CODEX_APPROVE = `mcp_servers.${MCP_SERVER_NAME}.default_tools_approval_mode="approve"`;

describe('TERMINAL_CLI_IDS', () => {
  it('lists the CLIs in auto-pick priority order (claude > codex > opencode > cursor > copilot > pi > antigravity > openclaw > hermes)', () => {
    expect([...TERMINAL_CLI_IDS]).toEqual([
      'claude',
      'codex',
      'opencode',
      'cursor',
      'copilot',
      'pi',
      'antigravity',
      'openclaw',
      'hermes',
    ]);
  });
});

describe('shellSingleQuote', () => {
  it('wraps a plain string in single quotes', () => {
    expect(shellSingleQuote('hello world')).toBe("'hello world'");
  });

  it('escapes embedded single quotes with the POSIX close-escape-reopen idiom', () => {
    expect(shellSingleQuote("it's")).toBe("'it'\\''s'");
  });

  it('renders shell metacharacters inert (no expansion possible)', () => {
    for (const payload of [
      '$(rm -rf /)',
      '`whoami`',
      'a; rm -rf /',
      'a && curl evil',
      'a | sh',
      'a > /etc/passwd',
      '$HOME',
      '*.md',
      'line1\nline2',
      'back\\slash',
    ]) {
      const quoted = shellSingleQuote(payload);
      expect(quoted.startsWith("'")).toBe(true);
      expect(quoted.endsWith("'")).toBe(true);
      expect(quoted).toContain(payload);
    }
  });

  it('cannot be broken out of with an injected quote + command', () => {
    const malicious = "'; rm -rf / #";
    const quoted = shellSingleQuote(malicious);
    expect(quoted).toBe("''\\''; rm -rf / #'");
    const interior = quoted.slice(1, -1);
    expect(interior.replace(/'\\''/g, '')).not.toContain("'");
  });
});

describe('buildPosixCliLaunch', () => {
  it('passes the prompt as one unquoted argument after the fixed args, for every argv-prompt CLI', () => {
    const prompt = "x\\'(touch pwned)\\' and '; rm -rf / # $(id) `id`\nline two";
    for (const cli of TERMINAL_CLI_IDS) {
      const launch = buildPosixCliLaunch(cli, prompt);
      expect(launch.executable).toBe(TERMINAL_CLIS[cli].bin);
      if (startupInjectionFor(cli) != null) {
        expect(launch.args).not.toContain(prompt);
        continue;
      }
      expect(launch.args.at(-1)).toBe(prompt);
      expect(launch.args.filter((arg) => arg.includes('pwned'))).toHaveLength(1);
    }
  });

  it('labels control characters in the prompt argument', () => {
    expect(buildPosixCliLaunch('codex', 'fix\u0003 this\r\nnow').args).toEqual([
      `fix<control-0003> this\nnow\n\n${TERMINAL_CONTROL_LABEL_NOTICE}`,
    ]);
  });

  it('carries the claude settings and codex approval as separate raw arguments', () => {
    expect(
      buildPosixCliLaunch('claude', 'hi', { mcpPreApprove: true, mcpServerName: MCP_SERVER_NAME }),
    ).toEqual({
      executable: 'claude',
      args: ['--settings', `{"enabledMcpjsonServers":["${MCP_SERVER_NAME}"]}`, 'hi'],
    });
    expect(
      buildPosixCliLaunch('codex', 'hi', {
        autoApproveOkTools: true,
        mcpServerName: MCP_SERVER_NAME,
      }),
    ).toEqual({
      executable: 'codex',
      args: ['-c', `mcp_servers.${MCP_SERVER_NAME}.default_tools_approval_mode="approve"`, 'hi'],
    });
    expect(buildPosixCliLaunch('openclaw', 'hi')).toEqual({
      executable: 'openclaw',
      args: ['chat', '--message', 'hi'],
    });
  });

  it('launches promptless when there is no prompt or the CLI takes it by startup injection', () => {
    expect(buildPosixCliLaunch('claude', null)).toEqual({ executable: 'claude', args: [] });
    expect(buildPosixCliLaunch('copilot', '')).toEqual({ executable: 'copilot', args: [] });
    expect(buildPosixCliLaunch('hermes', 'hi')).toEqual({ executable: 'hermes', args: ['chat'] });
  });
});

describe('buildPosixCliLaunch per-CLI shape', () => {
  it('keeps the fixed per-CLI shape (registry bin, subcommand and prompt flag, prompt last)', () => {
    expect(buildPosixCliLaunch('claude', 'hi')).toEqual({ executable: 'claude', args: ['hi'] });
    expect(buildPosixCliLaunch('codex', 'hi')).toEqual({ executable: 'codex', args: ['hi'] });
    expect(buildPosixCliLaunch('copilot', 'hi')).toEqual({
      executable: 'copilot',
      args: ['--interactive', 'hi'],
    });
    expect(buildPosixCliLaunch('cursor', 'hi')).toEqual({
      executable: 'cursor-agent',
      args: ['hi'],
    });
    expect(buildPosixCliLaunch('opencode', 'hi')).toEqual({
      executable: 'opencode',
      args: ['--prompt', 'hi'],
    });
    expect(buildPosixCliLaunch('pi', 'hi')).toEqual({ executable: 'pi', args: ['hi'] });
    expect(buildPosixCliLaunch('antigravity', 'hi')).toEqual({
      executable: 'agy',
      args: ['--prompt-interactive', 'hi'],
    });
    expect(buildPosixCliLaunch('openclaw', 'hi')).toEqual({
      executable: 'openclaw',
      args: ['chat', '--message', 'hi'],
    });
    expect(buildPosixCliLaunch('hermes', 'hi')).toEqual({ executable: 'hermes', args: ['chat'] });
  });

  it('keeps an injection payload as the final argument for every argv-prompt CLI with every option on', () => {
    for (const cli of TERMINAL_CLI_IDS) {
      if (startupInjectionFor(cli) != null) continue;
      const launch = buildPosixCliLaunch(cli, "'; rm -rf / #", {
        mcpPreApprove: true,
        autoApproveOkTools: true,
        mcpServerName: MCP_SERVER_NAME,
      });
      expect(launch.executable).toBe(TERMINAL_CLIS[cli].bin);
      expect(launch.args.at(-1)).toBe("'; rm -rf / #");
    }
  });

  it('labels control characters in the prompt argument instead of passing raw bytes to the CLI', () => {
    const prompt = buildPosixCliLaunch('claude', 'fix\u0000 this\u001b[2J\r\nnow').args.at(-1);
    expect(prompt).toBe(
      `fix<control-0000> this<control-001B>[2J\nnow\n\n${TERMINAL_CONTROL_LABEL_NOTICE}`,
    );
    expect(prompt).not.toMatch(TERMINAL_RAW_CONTROL_RE);
  });
});

describe('buildPosixCliLaunch promptless (New chat)', () => {
  it('emits the bare executable for a null/undefined/empty prompt, with no positional and no prompt flag', () => {
    for (const emptyPrompt of [null, undefined, ''] as const) {
      expect(buildPosixCliLaunch('claude', emptyPrompt)).toEqual({
        executable: 'claude',
        args: [],
      });
      expect(buildPosixCliLaunch('codex', emptyPrompt)).toEqual({ executable: 'codex', args: [] });
      expect(buildPosixCliLaunch('copilot', emptyPrompt)).toEqual({
        executable: 'copilot',
        args: [],
      });
      expect(buildPosixCliLaunch('cursor', emptyPrompt)).toEqual({
        executable: 'cursor-agent',
        args: [],
      });
      expect(buildPosixCliLaunch('opencode', emptyPrompt)).toEqual({
        executable: 'opencode',
        args: [],
      });
      expect(buildPosixCliLaunch('openclaw', emptyPrompt)).toEqual({
        executable: 'openclaw',
        args: ['chat'],
      });
      expect(buildPosixCliLaunch('hermes', emptyPrompt)).toEqual({
        executable: 'hermes',
        args: ['chat'],
      });
    }
  });

  it('still applies Claude MCP pre-approval on a promptless launch when opted in', () => {
    expect(
      buildPosixCliLaunch('claude', null, { mcpPreApprove: true, mcpServerName: MCP_SERVER_NAME }),
    ).toEqual({ executable: 'claude', args: ['--settings', CLAUDE_PREAPPROVE_JSON] });
  });

  it('still applies Claude OK auto-approve on a promptless launch, alone and merged with pre-approval', () => {
    expect(
      buildPosixCliLaunch('claude', null, {
        autoApproveOkTools: true,
        mcpServerName: MCP_SERVER_NAME,
        cliCommandName: 'ok',
      }).args,
    ).toEqual(['--settings', CLAUDE_AUTO_APPROVE_JSON]);
    expect(
      buildPosixCliLaunch('claude', null, {
        mcpPreApprove: true,
        autoApproveOkTools: true,
        mcpServerName: MCP_SERVER_NAME,
        cliCommandName: 'ok',
      }).args,
    ).toEqual(['--settings', CLAUDE_BOTH_JSON]);
  });

  it('never adds --prompt or a positional to a promptless opencode launch, even opted in', () => {
    expect(
      buildPosixCliLaunch('opencode', '', { mcpPreApprove: true, mcpServerName: MCP_SERVER_NAME }),
    ).toEqual({ executable: 'opencode', args: [] });
  });
});

describe('buildStartupInjectionBytes', () => {
  const START = '\x1b[200~';
  const END = '\x1b[201~';

  it('returns null for CLIs that carry the prompt on the argv (nothing to inject)', () => {
    for (const cli of TERMINAL_CLI_IDS) {
      if (startupInjectionFor(cli) != null) continue;
      expect(buildStartupInjectionBytes(cli, 'hi')).toBeNull();
    }
  });

  it('frames a Hermes prompt in bracketed paste + the registry submit byte', () => {
    expect(buildStartupInjectionBytes('hermes', 'do the thing')).toBe(
      `${START}do the thing${END}\r`,
    );
  });

  it('keeps a multi-line prompt intact inside the paste frame (no early submit)', () => {
    const multi = 'line one\nline two\nline three';
    expect(buildStartupInjectionBytes('hermes', multi)).toBe(`${START}${multi}${END}\r`);
  });

  it('labels ESC so the prompt cannot terminate the paste frame or inject a sequence', () => {
    const hostile = `abc${END}rm -rf /\x1b[2J`;
    const bytes = buildStartupInjectionBytes('hermes', hostile);
    expect(bytes).toBe(
      `${START}abc<control-001B>[201~rm -rf /<control-001B>[2J\n\n${TERMINAL_CONTROL_LABEL_NOTICE}${END}\r`,
    );
    expect(bytes?.split(START).length).toBe(2);
    expect(bytes?.split(END).length).toBe(2);
  });

  it('returns null for an empty/absent prompt (a promptless New-chat launch)', () => {
    for (const emptyPrompt of [null, undefined, ''] as const) {
      expect(buildStartupInjectionBytes('hermes', emptyPrompt)).toBeNull();
    }
  });

  it('Hermes waits on the DEC-2004 bracketed-paste-enable marker, with a cap beyond the debounce', () => {
    const cfg = startupInjectionFor('hermes');
    expect(cfg?.readyMarker).toBe('\x1b[?2004h');
    expect(cfg && cfg.capMs > cfg.settleMs).toBe(true);
  });
});

const TERMINAL_RAW_CONTROL_RE = new RegExp(
  '[' + '\\u0000-\\u0008' + '\\u000b-\\u001f' + '\\u007f-\\u009f' + ']',
);

function controlCodePoints(): number[] {
  const points: number[] = [];
  for (let point = 0x00; point <= 0x9f; point++) {
    if (point <= 0x1f || point >= 0x7f) points.push(point);
  }
  return points;
}

describe('toTerminalPromptText', () => {
  it('returns text without control characters unchanged and adds no notice', () => {
    const clean = 'Here is the passage:\n\n```\na\tb\n```\n\n';
    expect(toTerminalPromptText(clean)).toBe(clean);
  });

  it('labels every C0 control except TAB and LF, plus DEL and every C1 control', () => {
    for (const point of controlCodePoints()) {
      const control = String.fromCodePoint(point);
      const out = toTerminalPromptText(`a${control}b`);
      if (point === 0x09 || point === 0x0a) {
        expect(out).toBe(`a${control}b`);
      } else if (point === 0x0d) {
        expect(out).toBe('a\nb');
      } else {
        const label = `<control-${point.toString(16).toUpperCase().padStart(4, '0')}>`;
        expect(out).toBe(`a${label}b\n\n${TERMINAL_CONTROL_LABEL_NOTICE}`);
      }
      expect(out).not.toMatch(TERMINAL_RAW_CONTROL_RE);
    }
  });

  it('passes printable ASCII, NBSP and non-Latin text through unchanged', () => {
    let printableAscii = '';
    for (let point = 0x20; point <= 0x7e; point++) printableAscii += String.fromCodePoint(point);
    const passage = `${printableAscii}\u00a0é ü «» 日本語 🙂 \u2028`;
    expect(toTerminalPromptText(passage)).toBe(passage);
  });

  it('turns CRLF and lone CR line breaks into LF so a CR never reaches the CLI as Enter', () => {
    expect(toTerminalPromptText('one\r\ntwo\rthree\nfour')).toBe('one\ntwo\nthree\nfour');
  });

  it('places the notice before trailing line breaks so staged text keeps its blank-line tail', () => {
    expect(toTerminalPromptText('passage \u0003 end\n\n')).toBe(
      `passage <control-0003> end\n\n${TERMINAL_CONTROL_LABEL_NOTICE}\n\n`,
    );
  });

  it('is idempotent, so a relayed handoff is not labeled twice', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary' }), (text) => {
        const once = toTerminalPromptText(text);
        expect(toTerminalPromptText(once)).toBe(once);
        expect(once).not.toMatch(TERMINAL_RAW_CONTROL_RE);
        expect(once).not.toContain('\r');
      }),
    );
  });
});

describe('buildTerminalInputBytes', () => {
  const START = '\x1b[200~';
  const END = '\x1b[201~';

  it('frames the labeled text in exactly one bracketed paste whatever the text holds', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary' }), (text) => {
        const bytes = buildTerminalInputBytes(text, true);
        expect(bytes.startsWith(START)).toBe(true);
        expect(bytes.endsWith(END)).toBe(true);
        expect(bytes.slice(START.length, -END.length)).toBe(toTerminalPromptText(text));
        expect(bytes.split('\x1b').length).toBe(3);
      }),
    );
  });

  it('sends the labeled text unframed to a receiver that has not enabled bracketed paste', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary' }), (text) => {
        const bytes = buildTerminalInputBytes(text, false);
        expect(bytes).toBe(toTerminalPromptText(text));
        expect(bytes).not.toContain('\x1b');
      }),
    );
  });

  it('keeps TAB and LF raw inside the frame', () => {
    expect(buildTerminalInputBytes('Columns:\tA\tB\n\tC', true)).toBe(
      `${START}Columns:\tA\tB\n\tC${END}`,
    );
  });
});

describe('claude MCP pre-approval', () => {
  it('is OFF by default and only added for claude when opted in', () => {
    expect(buildPosixCliLaunch('claude', 'hi').args).not.toContain('--settings');
    expect(
      buildPosixCliLaunch('claude', 'hi', { mcpPreApprove: true, mcpServerName: MCP_SERVER_NAME })
        .args,
    ).toEqual(['--settings', CLAUDE_PREAPPROVE_JSON, 'hi']);
  });

  it('never added for codex/copilot/cursor/opencode, even when opted in (claude-only flag)', () => {
    const opts = { mcpPreApprove: true, mcpServerName: MCP_SERVER_NAME };
    expect(buildPosixCliLaunch('codex', 'hi', opts).args).toEqual(['hi']);
    expect(buildPosixCliLaunch('copilot', 'hi', opts).args).toEqual(['--interactive', 'hi']);
    expect(buildPosixCliLaunch('cursor', 'hi', opts).args).toEqual(['hi']);
    expect(buildPosixCliLaunch('opencode', 'hi', opts).args).toEqual(['--prompt', 'hi']);
  });

  it('names the canonical MCP server, matching what editor wiring registers in .mcp.json', () => {
    expect(
      buildPosixCliLaunch('claude', 'hi', { mcpPreApprove: true, mcpServerName: MCP_SERVER_NAME })
        .args[1],
    ).toContain(`["${MCP_SERVER_NAME}"]`);
  });
});

describe('OK auto-approve (autoApproveOkTools)', () => {
  const AUTO = { autoApproveOkTools: true, mcpServerName: MCP_SERVER_NAME, cliCommandName: 'ok' };

  it('adds the OK allow-list + destructive ask-list to Claude --settings when on', () => {
    expect(buildPosixCliLaunch('claude', 'hi', AUTO).args).toEqual([
      '--settings',
      CLAUDE_AUTO_APPROVE_JSON,
      'hi',
    ]);
  });

  it('merges server-trust + auto-approve into one --settings object when both on', () => {
    expect(buildPosixCliLaunch('claude', 'hi', { ...AUTO, mcpPreApprove: true }).args).toEqual([
      '--settings',
      CLAUDE_BOTH_JSON,
      'hi',
    ]);
  });

  it('keeps every gated tool in the ask list (never silently auto-approved)', () => {
    const settings = buildPosixCliLaunch('claude', 'hi', AUTO).args[1];
    expect(OK_GATED_TOOL_NAMES).toEqual(['delete', 'move', 'share_link', 'install', 'import']);
    for (const gated of OK_GATED_TOOL_NAMES) {
      expect(settings).toContain(`"mcp__${MCP_SERVER_NAME}__${gated}"`);
    }
  });

  it('never gates with `deny` (that would hide the tools from the agent)', () => {
    expect(buildPosixCliLaunch('claude', 'hi', AUTO).args[1]).not.toContain('"deny"');
  });

  it('adds the codex per-server `-c approve` override only when on', () => {
    expect(buildPosixCliLaunch('codex', 'hi', AUTO).args).toEqual(['-c', CODEX_APPROVE, 'hi']);
    expect(buildPosixCliLaunch('codex', 'hi').args).toEqual(['hi']);
  });

  it('is claude/codex only — copilot/cursor/opencode/pi never get an auto-approve arg', () => {
    expect(buildPosixCliLaunch('copilot', 'hi', AUTO).args).toEqual(['--interactive', 'hi']);
    expect(buildPosixCliLaunch('cursor', 'hi', AUTO).args).toEqual(['hi']);
    expect(buildPosixCliLaunch('opencode', 'hi', AUTO).args).toEqual(['--prompt', 'hi']);
    expect(buildPosixCliLaunch('pi', 'hi', AUTO).args).toEqual(['hi']);
  });

  it('keeps the fixed args for a promptless auto-approve launch', () => {
    expect(buildPosixCliLaunch('codex', null, AUTO)).toEqual({
      executable: 'codex',
      args: ['-c', CODEX_APPROVE],
    });
  });
});

describe('launch approval names the server the main process checked', () => {
  const BETA = DESKTOP_PRODUCTS.beta.mcpServerName;
  const ALL_ON = { mcpPreApprove: true, autoApproveOkTools: true } as const;

  function artifacts(opts: Parameters<typeof buildPosixCliLaunch>[2]): string[] {
    return [
      buildPosixCliLaunch('claude', 'hi', opts).args.join(' '),
      buildPosixCliLaunch('codex', 'hi', opts).args.join(' '),
    ];
  }

  it('uses only the supplied Beta name, even when this process resolves to Stable', () => {
    vi.stubEnv('OK_CHANNEL', 'stable');
    try {
      const out = artifacts({ ...ALL_ON, mcpServerName: BETA, cliCommandName: 'ok-beta' });
      expect(out[0]).toBe(
        `--settings {"enabledMcpjsonServers":["${BETA}"],"permissions":{"allow":["mcp__${BETA}","Bash(ok-beta open:*)"],"ask":["mcp__${BETA}__delete","mcp__${BETA}__move","mcp__${BETA}__share_link","mcp__${BETA}__install","mcp__${BETA}__import"]}} hi`,
      );
      expect(out[1]).toBe(`-c mcp_servers.${BETA}.default_tools_approval_mode="approve" hi`);
      for (const artifact of out) {
        expect(artifact.replaceAll(BETA, '')).not.toContain('open-knowledge');
      }
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('emits no pre-approval and no auto-approve when main supplied no name', () => {
    for (const opts of [ALL_ON, { ...ALL_ON, mcpServerName: '' }]) {
      expect(buildPosixCliLaunch('claude', 'hi', opts)).toEqual({
        executable: 'claude',
        args: ['hi'],
      });
      expect(buildPosixCliLaunch('codex', 'hi', opts)).toEqual({
        executable: 'codex',
        args: ['hi'],
      });
    }
  });

  it('pre-approves no open command when main supplied no CLI name', () => {
    const out = artifacts({ ...ALL_ON, mcpServerName: BETA });
    expect(out[0]).toContain(`"allow":["mcp__${BETA}"]`);
    for (const artifact of out) expect(artifact).not.toContain('Bash(');
  });

  it('keeps the Stable artifacts byte-identical when main supplies the Stable names', () => {
    const out = artifacts({ ...ALL_ON, mcpServerName: 'open-knowledge', cliCommandName: 'ok' });
    expect(out[0]).toBe(
      `--settings {"enabledMcpjsonServers":["open-knowledge"],"permissions":{"allow":["mcp__open-knowledge","Bash(ok open:*)"],"ask":["mcp__open-knowledge__delete","mcp__open-knowledge__move","mcp__open-knowledge__share_link","mcp__open-knowledge__install","mcp__open-knowledge__import"]}} hi`,
    );
    expect(out[1]).toBe(`-c mcp_servers.open-knowledge.default_tools_approval_mode="approve" hi`);
  });

  it('imports without resolving the channel, so an unrecognised OK_CHANNEL cannot crash boot', async () => {
    vi.stubEnv('OK_CHANNEL', 'nightly');
    vi.resetModules();
    try {
      const mod = await import('./terminal-launch.ts');
      expect(mod.buildPosixCliLaunch('codex', 'hi', { autoApproveOkTools: true })).toEqual({
        executable: 'codex',
        args: ['hi'],
      });
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
});
