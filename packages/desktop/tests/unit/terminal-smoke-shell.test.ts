import { rmSync } from 'node:fs';
import { afterEach, describe, expect, test } from 'vitest';
import {
  buildProcessIdProbe,
  readTerminalProcessId,
  reportedWorkingDirectory,
  terminalSmokeEnvironment,
  terminalSmokeShellCommands,
} from '../smoke/_helpers/terminal-smoke-shell.ts';

const SHELL_BANNER = 'zsh';
const WINDOW_PROJECT_DIR =
  'C:\\Users\\runneradmin\\AppData\\Local\\Temp\\ok-termwin-open-close-proj-AbC123';
const WINDOW_PROMPT = `PS ${WINDOW_PROJECT_DIR}> `;
const WINDOW_CWD_ECHO = `${WINDOW_PROMPT}${terminalSmokeShellCommands('darwin').workingDirectory('WINDOW_CWD')}`;
const WINDOW_CWD_REPORT = `WINDOW_CWD=[${WINDOW_PROJECT_DIR}]`;
const WINDOW_CWD_REPORT_UNCLOSED =
  'WINDOW_CWD=[C:\\Users\\runneradmin\\AppData\\Local\\Temp\\ok-termwin-open-cl';
const WINDOW_CWD_REPORT_STARTED = 'WINDOW_CWD=[C:\\Users\\runneradmin\\AppData\\Loc';
const XTERM_VIEWPORT_ROWS = 12;
const XTERM_EMPTY_ACCESSIBILITY_ROW = '\u00a0';
const XTERM_CURSOR_CELL = ' ';

interface RenderedRows {
  readonly rows: readonly string[];
  readonly accessibilityRows?: readonly string[];
  readonly liveRegion?: string;
}

function readAccessibilityCopyThenRows({
  rows,
  accessibilityRows = rows,
  liveRegion = '',
}: RenderedRows): string {
  const accessibility = accessibilityRows
    .map((row) => row.trimEnd() || XTERM_EMPTY_ACCESSIBILITY_ROW)
    .join('');
  const padding = XTERM_EMPTY_ACCESSIBILITY_ROW.repeat(
    XTERM_VIEWPORT_ROWS - accessibilityRows.length,
  );
  return `${accessibility}${padding}${liveRegion}\n${rows.join('')}${XTERM_CURSOR_CELL}`;
}

const cleanup: string[] = [];

afterEach(() => {
  for (const directory of cleanup.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('terminal smoke shell commands', () => {
  test('keeps the existing POSIX command contracts on macOS and Linux', () => {
    for (const platform of ['darwin', 'linux'] as const) {
      const commands = terminalSmokeShellCommands(platform);
      expect(commands.cwd).toBe('pwd');
      expect(commands.workingDirectory('WINDOW_CWD')).toBe(
        "printf '%s=[%s]\\n' 'WINDOW_CWD' \"$PWD\"",
      );
      expect(commands.arithmetic('HARNESS', 6, 7, 'DONE')).toBe('echo HARNESS_$((6*7))_DONE');
      expect(commands.columns('COLS')).toBe('echo COLS=$(tput cols)');
      expect(commands.setEnvironment('OK_MARK', 'survived')).toBe("export OK_MARK='survived'");
      expect(commands.readEnvironment('OK_MARK', 'marker')).toBe('echo "marker=[$OK_MARK]"');
      expect(commands.processId('SHELLPID')).toBe('printf \'SHELLPID=%s;\\n\' "$$"');
      expect(commands.output('MARK_ONE')).toBe("printf '%s\\n' 'MARK_ONE'");
    }
  });
});

describe('terminal smoke shell fixtures', () => {
  test('keeps the POSIX login-shell fixture and delimiter', () => {
    expect(
      terminalSmokeEnvironment('/tmp/fixture-home', {
        platform: 'linux',
        env: { PATH: '/developer/bin' },
        pathPrefix: '/tmp/fixture-bin',
        restrictPath: true,
        pinPosixZsh: true,
      }),
    ).toEqual({
      HOME: '/tmp/fixture-home',
      PATH: '/tmp/fixture-bin:/usr/bin:/bin:/usr/sbin:/sbin',
      SHELL: '/bin/zsh',
    });
  });
});

describe('working directory reported by the evaluated command', () => {
  const noReport = [
    {
      state: 'the shell command echo alone',
      text: terminalSmokeShellCommands('darwin').workingDirectory('WINDOW_CWD'),
    },
    {
      state: 'the POSIX command echo alone',
      text: terminalSmokeShellCommands('darwin').workingDirectory('WINDOW_CWD'),
    },
    {
      state: 'a report whose closing bracket has not arrived',
      text: WINDOW_CWD_REPORT_UNCLOSED,
    },
    {
      state: 'a report partial in both the accessibility copy and the rows copy',
      text: readAccessibilityCopyThenRows({
        rows: [SHELL_BANNER, WINDOW_CWD_ECHO, WINDOW_CWD_REPORT_UNCLOSED],
        accessibilityRows: [SHELL_BANNER, WINDOW_CWD_ECHO, WINDOW_CWD_REPORT_STARTED],
      }),
    },
    {
      state:
        'a report partial in both copies after the live region repainted the prompt and the command',
      text: readAccessibilityCopyThenRows({
        rows: [SHELL_BANNER, WINDOW_CWD_ECHO, WINDOW_CWD_REPORT_UNCLOSED],
        accessibilityRows: [SHELL_BANNER, WINDOW_CWD_ECHO, WINDOW_CWD_REPORT_STARTED],
        liveRegion: `${WINDOW_CWD_ECHO}${WINDOW_CWD_REPORT_STARTED}`,
      }),
    },
    {
      state: 'a report partial in the accessibility copy before the rows copy shows it',
      text: readAccessibilityCopyThenRows({
        rows: [SHELL_BANNER, WINDOW_CWD_ECHO],
        accessibilityRows: [SHELL_BANNER, WINDOW_CWD_ECHO, WINDOW_CWD_REPORT_STARTED],
      }),
    },
  ];

  test('returns the path from the report glued to the next prompt', () => {
    expect(
      reportedWorkingDirectory(
        'WINDOW_CWD',
        `WINDOW_CWD=[${WINDOW_PROJECT_DIR}]PS ${WINDOW_PROJECT_DIR}> `,
      ),
    ).toBe(WINDOW_PROJECT_DIR);
  });

  test('returns the path from the rows copy while the accessibility copy still holds a partial report', () => {
    expect(
      reportedWorkingDirectory(
        'WINDOW_CWD',
        readAccessibilityCopyThenRows({
          rows: [SHELL_BANNER, WINDOW_CWD_ECHO, WINDOW_CWD_REPORT, WINDOW_PROMPT],
          accessibilityRows: [SHELL_BANNER, WINDOW_CWD_ECHO, WINDOW_CWD_REPORT_STARTED],
        }),
      ),
    ).toBe(WINDOW_PROJECT_DIR);
  });

  for (const { state, text } of noReport) {
    test(`returns null for ${state}`, () => {
      expect(reportedWorkingDirectory('WINDOW_CWD', text)).toBeNull();
    });
  }
});

describe('process id reported by terminal rows', () => {
  const marker = 'RESTART_PROCESS_abcdef0123456789abcdef0123456789';

  test('reads the marker pid when the following rendered row begins with digits', () => {
    const text = [`${marker}=5784;`, '671PS C:\\Users\\runneradmin> '].join('');

    expect(readTerminalProcessId(marker, text)).toBe(5784);
  });

  test('keeps a genuinely different marker pid different', () => {
    const text = [`${marker}=8449;`, 'PS C:\\Users\\runneradmin> '].join('');

    expect(readTerminalProcessId(marker, text)).toBe(8449);
  });

  test('uses the latest complete marker row after replay', () => {
    const text = [`${marker}=5784;`, 'PS C:\\Users\\runneradmin> ', `${marker}=8448;`].join('');

    expect(readTerminalProcessId(marker, text)).toBe(8448);
  });

  test('reads the full pid of a marker line wrapped at any column', () => {
    const line = `${marker}=5784;`;
    for (let column = 1; column < line.length; column += 1) {
      const text = [
        `${marker}=1111;`,
        'PS C:\\Users\\runneradmin> ',
        line.slice(0, column),
        line.slice(column),
        '671PS C:\\Users\\runneradmin> ',
      ].join('');

      expect({ column, pid: readTerminalProcessId(marker, text) }).toEqual({ column, pid: 5784 });
    }
  });

  test('reads no pid from a newest marker line whose ending has not arrived', () => {
    const text = [`${marker}=1111;`, 'PS C:\\Users\\runneradmin> ', `${marker}=57`].join('');

    expect(readTerminalProcessId(marker, text)).toBe(0);
  });
});

describe('process id probes repeated for one marker', () => {
  const marker = 'RESTART_PROCESS_abcdef0123456789abcdef0123456789';
  const prompt = '$ ';

  test('reads no pid for a later probe until its own output arrives', () => {
    for (const platform of ['darwin', 'linux'] as const) {
      const earlier = buildProcessIdProbe(marker, platform);
      const later = buildProcessIdProbe(marker, platform);
      const earlierAnswered = [
        `${prompt}${earlier.command}`,
        `${earlier.marker}=1111;`,
        prompt,
      ].join('');
      const laterEchoed = `${earlierAnswered}${later.command}`;
      const laterAnswered = `${laterEchoed}${later.marker}=2222;${prompt}`;

      expect({
        platform,
        earlierAnswered: readTerminalProcessId(later.marker, earlierAnswered),
        laterEchoed: readTerminalProcessId(later.marker, laterEchoed),
        laterAnswered: readTerminalProcessId(later.marker, laterAnswered),
      }).toEqual({ platform, earlierAnswered: 0, laterEchoed: 0, laterAnswered: 2222 });
    }
  });
});
