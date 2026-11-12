#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { service, update } from './channel.mjs';

const project = resolve(process.argv[2] ?? '.');
if (process.platform !== 'darwin' || process.arch !== 'arm64')
  throw new Error('Requires macOS Apple Silicon.');
if (!existsSync(project)) throw new Error('Project directory does not exist.');
const home = homedir();
const base = join(home, '.local/share', service);
const bin = join(home, '.local/bin');
const agents = join(home, 'Library/LaunchAgents');
const backup = join(base, 'backups', new Date().toISOString().replaceAll(':', '-'));
const domain = `gui/${process.getuid()}`;
const oldLabel = 'com.joon.openknowledge';
const oldPlist = join(agents, `${oldLabel}.plist`);
const plist = join(agents, `${service}.plist`);
const shellQuote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
const xml = (value) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
mkdirSync(backup, { recursive: true, mode: 0o700 });
mkdirSync(bin, { recursive: true });
mkdirSync(agents, { recursive: true });
function snapshotDatabases(source, destination) {
  if (!existsSync(source)) return;
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const input = join(source, entry.name);
    const output = join(destination, entry.name);
    if (entry.isDirectory()) snapshotDatabases(input, output);
    else if (entry.isFile() && entry.name.endsWith('.sqlite')) {
      const pending = `${output}.snapshot`;
      execFileSync('/usr/bin/sqlite3', [
        input,
        '.timeout 5000',
        `.backup '${pending.replaceAll("'", "''")}'`,
      ]);
      renameSync(pending, output);
      for (const suffix of ['-wal', '-shm']) rmSync(`${output}${suffix}`, { force: true });
    }
  }
}
if (existsSync(join(home, '.ok')))
  cpSync(join(home, '.ok'), join(backup, 'user-ok'), { recursive: true });
snapshotDatabases(join(home, '.ok/local'), join(backup, 'user-ok/local'));
cpSync(project, join(backup, 'project'), { recursive: true });
for (const file of [oldPlist, plist])
  if (existsSync(file)) copyFileSync(file, join(backup, file.split('/').at(-1)));
for (const name of ['ok', 'open-knowledge', 'openknowledge-update']) {
  if (existsSync(join(bin, name))) copyFileSync(join(bin, name), join(backup, name));
}
await update({ force: true });
if (!existsSync(join(project, '.ok/config.yml'))) {
  execFileSync(
    process.execPath,
    [
      join(base, 'current/node_modules/@inkeep/open-knowledge/dist/cli.mjs'),
      'init',
      '--no-mcp',
      '--no-skills',
      '--json',
    ],
    { cwd: project, stdio: 'inherit' },
  );
}
const installedChannel = join(base, 'channel.mjs');
const sourceChannel = join(import.meta.dirname, 'channel.mjs');
if (resolve(sourceChannel) !== resolve(installedChannel))
  copyFileSync(sourceChannel, installedChannel);
const command = `${shellQuote(process.execPath)} ${shellQuote(installedChannel)}`;
for (const name of ['ok', 'open-knowledge']) {
  writeFileSync(join(bin, name), `#!/bin/sh\nexec ${command} run "$@"\n`, { mode: 0o755 });
}
writeFileSync(
  join(bin, 'openknowledge-update'),
  `#!/bin/sh\nset -e\n${command} update\nlaunchctl kickstart -k ${shellQuote(`${domain}/${service}`)}\n`,
  { mode: 0o755 },
);
writeFileSync(
  plist,
  `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${service}</string>
<key>ProgramArguments</key><array><string>${xml(process.execPath)}</string><string>${xml(installedChannel)}</string><string>start</string><string>start</string><string>--mode</string><string>browser</string><string>--no-open-browser</string><string>--port</string><string>8080</string><string>--idle-shutdown</string><string>off</string></array>
<key>WorkingDirectory</key><string>${xml(project)}</string>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
<key>ThrottleInterval</key><integer>30</integer>
<key>StandardOutPath</key><string>${xml(join(base, 'service.log'))}</string>
<key>StandardErrorPath</key><string>${xml(join(base, 'service.log'))}</string>
<key>EnvironmentVariables</key><dict><key>PATH</key><string>${xml(`${dirname(process.execPath)}:${bin}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`)}</string><key>LANG</key><string>en_US.UTF-8</string></dict>
</dict></plist>\n`,
);
execFileSync('plutil', ['-lint', plist], { stdio: 'inherit' });
spawnSync('launchctl', ['bootout', `${domain}/${oldLabel}`], { stdio: 'ignore' });
spawnSync('launchctl', ['bootout', `${domain}/${service}`], { stdio: 'ignore' });
const oldCli = '/opt/homebrew/lib/node_modules/@inkeep/open-knowledge/dist/cli.mjs';
if (existsSync(oldCli))
  execFileSync(process.execPath, [oldCli, 'stop', project], { stdio: 'inherit' });
if (existsSync(oldPlist)) {
  copyFileSync(oldPlist, join(backup, `${oldLabel}.plist`));
  execFileSync('launchctl', ['disable', `${domain}/${oldLabel}`]);
}
execFileSync('launchctl', ['enable', `${domain}/${service}`]);
execFileSync('launchctl', ['bootstrap', domain, plist], { stdio: 'inherit' });
writeFileSync(
  join(base, 'migration.json'),
  `${JSON.stringify({ project, backup, oldPlist, plist, node: process.execPath }, null, 2)}\n`,
);
console.log(
  `Service installed: ${service}\nBackup: ${backup}\nCommands: ${bin}/ok, ${bin}/openknowledge-update`,
);
