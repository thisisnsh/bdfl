#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { runtimePaths, ensureRuntime, TmuxCommand } = require('../src/tmux/command');
const { TmuxServer } = require('../src/tmux/server');
const { launchPane } = require('../src/tmux/pane-helper');
const { DaemonSupervisor } = require('../src/daemon/supervisor');
const { PopupClient } = require('../src/tui/popup');
const { request } = require('../src/daemon/protocol');

function option(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : null;
}

async function main(argv = process.argv.slice(2)) {
  const command = argv[0];
  if (command === 'pane') return launchPane(argv[1]);
  if (command === 'empty-pane') return new Promise(() => {});
  if (command === 'daemon') {
    const root = path.resolve(option(argv, '--root'));
    const paths = runtimePaths(root);
    ensureRuntime(paths);
    const tmux = new TmuxServer(root, new TmuxCommand(paths.tmuxSocket), paths);
    const supervisor = new DaemonSupervisor(root, tmux, paths, { dangerous: argv.includes('--dangerous') });
    supervisor.start();
    process.on('SIGTERM', () => supervisor.stop(false));
    process.on('SIGINT', () => supervisor.stop(false));
    return;
  }
  if (command === 'popup') return new PopupClient(option(argv, '--socket'), option(argv, '--page')).start();
  if (command === 'action') {
    const socket = option(argv, '--socket');
    const name = option(argv, '--name');
    if (name === 'shutdown') return request(socket, 'shutdown');
    if (name === 'dangerous-on' || name === 'dangerous-off')
      return request(socket, 'configure', { dangerous: name === 'dangerous-on' });
    if (name === 'pause-active') return request(socket, 'pause-active');
    if (name === 'focus-relative')
      return request(socket, 'focus-relative', { direction: option(argv, '--direction') || 'next' });
    if (name === 'toggle-overview') return request(socket, 'toggle-overview');
  }
  throw new Error('Unsupported BDFL internal entrypoint');
}

void main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
