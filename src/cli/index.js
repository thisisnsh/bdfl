'use strict';

const pkg = require('../../package.json');
const { WorkspaceCatalog } = require('../state/repositories');
const { ForegroundLauncher } = require('../daemon/launcher');
const { checkForUpdates } = require('../core/updates');
const { installFatalErrorHandlers, reportError } = require('../core/errors');
const HELP = `Usage: bdfl [--dangerous|status|help|--version]\n\nRun bdfl with no arguments in a Git workspace to attach the tmux-native supervisor. tmux 3.2 or newer must be installed.\nUse --dangerous to bypass provider approvals and sandboxing for every agent in this run.\n\nClick an agent or session label to switch directly. With the keyboard, press C-b then Left/Right to switch sessions or Up/Down to switch agents. C-b n/p/s/r opens New, Plans, Sessions, or Reviews; uppercase aliases also work. Esc closes a popup, C-b x pauses the active agent, and C-b q performs a normal BDFL shutdown. C-b z zooms a pane and C-b [ enters copy mode. Unprefixed arrow keys and Ctrl+C go directly to the active provider. Hold Shift while dragging to select native terminal text.\nIn Sessions, d deletes one managed agent and D deletes its whole session. In Plans, d deletes one plan and D deletes plans for the selected session. Deletions require Enter confirmation.`;
function status(root) {
  const value = new WorkspaceCatalog(root).load();
  return `${value.workstreams.length} saved session(s), ${value.sessions.filter((session) => session.status === 'running').length} active agent(s).`;
}
function main(
  argv = process.argv.slice(2),
  io = process,
  root = process.cwd(),
  create = (directory, options) => new ForegroundLauncher(directory, options),
  updates = checkForUpdates
) {
  void updates(pkg.version);
  const dangerous = argv.length === 1 && argv[0] === '--dangerous';
  const command = dangerous ? null : argv[0];
  if (command === '--version' || command === '-v') {
    io.stdout.write(`${pkg.version}\n`);
    return 0;
  }
  if (command === 'help' || command === '--help' || command === '-h') {
    io.stdout.write(`${HELP}\n`);
    return 0;
  }
  if (command === 'status') {
    io.stdout.write(`${status(root)}\n`);
    return 0;
  }
  if (command) {
    io.stderr.write(`Unknown command: ${command}\n${HELP}\n`);
    return 1;
  }
  if (!io.stdin.isTTY || !io.stdout.isTTY) {
    io.stderr.write(`${HELP}\n`);
    return 1;
  }
  create(root, { input: io.stdin, output: io.stdout, version: pkg.version, dangerous }).start();
  return 0;
}
function run(argv = process.argv.slice(2), io = process, root = process.cwd(), create, updates) {
  try {
    return main(argv, io, root, create, updates);
  } catch (error) {
    reportError(error, io, { version: pkg.version });
    return 1;
  }
}
module.exports = { HELP, status, main, run, installFatalErrorHandlers };
