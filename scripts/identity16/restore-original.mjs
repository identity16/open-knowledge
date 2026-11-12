#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { service } from './channel.mjs';

const base = join(homedir(), '.local/share', service);
const migration = JSON.parse(readFileSync(join(base, 'migration.json'), 'utf8'));
const domain = `gui/${process.getuid()}`;
spawnSync('launchctl', ['bootout', `${domain}/${service}`], { stdio: 'ignore' });
execFileSync(process.execPath, [join(base, 'channel.mjs'), 'run', 'stop', migration.project], {
  stdio: 'inherit',
});
execFileSync('launchctl', ['disable', `${domain}/${service}`]);
for (const name of ['ok', 'open-knowledge', 'openknowledge-update']) {
  const installed = join(homedir(), '.local/bin', name);
  const saved = join(migration.backup, name);
  if (
    !existsSync(installed) ||
    !readFileSync(installed, 'utf8').includes(join(base, 'channel.mjs'))
  )
    continue;
  if (existsSync(saved)) copyFileSync(saved, installed);
  else rmSync(installed);
}
if (existsSync(migration.oldPlist)) {
  execFileSync('launchctl', ['enable', `${domain}/com.joon.openknowledge`]);
  execFileSync('launchctl', ['bootstrap', domain, migration.oldPlist], { stdio: 'inherit' });
}
console.log(
  `Original commands restored. Documents and ~/.ok were preserved. Backup: ${migration.backup}`,
);
