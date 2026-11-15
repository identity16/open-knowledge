import { currentCliCommandName } from '@inkeep/open-knowledge-core';

function posixQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function quoteStopCommandPath(projectPath: string, _platform: NodeJS.Platform): string {
  return posixQuote(projectPath);
}

export function stopCommandLine(
  projectPath: string,
  platform: NodeJS.Platform,
  opts: { readonly force?: boolean } = {},
): string {
  const force = opts.force === true ? ' --force' : '';
  return `${currentCliCommandName()} stop${force} ${quoteStopCommandPath(projectPath, platform)}`;
}
