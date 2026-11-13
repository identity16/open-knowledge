const path = require('node:path');

const resources = process.argv[2];
const modules = [
  ['app', 'node-pty', 'app.asar/node_modules/node-pty'],
  ['app', '@parcel/watcher', 'app.asar/node_modules/@parcel/watcher'],
  ['app', '@napi-rs/keyring', 'app.asar/node_modules/@napi-rs/keyring'],
  ['cli', '@parcel/watcher', 'cli/node_modules/@parcel/watcher'],
  ['cli', '@napi-rs/keyring', 'cli/node_modules/@napi-rs/keyring'],
  ['cli', 'native-config', 'cli/node_modules/@inkeep/open-knowledge-native-config'],
];

let failures = 0;
for (const [scope, name, relative] of modules) {
  try {
    require(path.join(resources, relative));
    console.log(`native module loads: ${scope} ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`native module failed: ${scope} ${name}: ${String(error.message).split('\n')[0]}`);
  }
}

function finish(ptyWorks) {
  process.exit(failures === 0 && ptyWorks ? 0 : 1);
}

let pty;
try {
  pty = require(path.join(resources, 'app.asar/node_modules/node-pty'));
} catch {
  finish(false);
}
const terminal = pty.spawn('/bin/echo', ['native-probe-pty'], { cols: 80, rows: 24 });
let output = '';
terminal.onData((data) => {
  output += data;
});
terminal.onExit(({ exitCode }) => {
  const works = exitCode === 0 && output.includes('native-probe-pty');
  console[works ? 'log' : 'error'](`node-pty ${works ? 'spawns a terminal' : 'failed to spawn'}`);
  finish(works);
});
