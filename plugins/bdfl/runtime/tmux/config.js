'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { atomicWrite } = require('../core/plans');

function quote(value) {
  return `'${`${value}`.replaceAll("'", "'\\''")}'`;
}

function internalCommand(packageRoot, ...args) {
  return [process.execPath, path.join(packageRoot, 'bin', 'bdfl-internal.js'), ...args].map(quote).join(' ');
}

function tmuxConfig({ packageRoot, daemonSocket }) {
  const popup = (page) =>
    `${internalCommand(packageRoot, 'popup', '--socket', daemonSocket, '--page', page)} ` +
    `-- '#{client_width}' '#{client_height}'`;
  const action = (name) => internalCommand(packageRoot, 'action', '--socket', daemonSocket, '--name', name);
  return [
    'set -g prefix C-b',
    'unbind C-b',
    'bind C-b send-prefix',
    'set -g mouse off',
    'set -g history-limit 5000',
    'set -g remain-on-exit on',
    'set -g status on',
    'set -g status-position bottom',
    'set -g status 2',
    'set -g status-interval 1',
    'set -g status-style "bg=default,fg=colour245"',
    'set -g status-left ""',
    'set -g status-right ""',
    'set -g pane-border-status top',
    'set -g pane-border-format " #{E:@bdfl-label} "',
    'set -g pane-border-style "fg=colour238"',
    'set -g pane-active-border-style "fg=colour81"',
    'set -g status-format[0] "#{W:#{?#{&&:#{window_active},#{@bdfl-workstream-id}},#{P: #{E:@bdfl-label} },},}"',
    'set -g status-format[1] "#{W:#{?@bdfl-workstream-id,#{?window_active,#[fg=colour81]◆ ,}#[fg=white]#{window_name}#[default] ,},}"',
    `bind N display-popup -E -w '100%' -h '75%' -x 0 -y S ${quote(popup('New'))}`,
    `bind P display-popup -E -w '100%' -h '75%' -x 0 -y S ${quote(popup('Plans'))}`,
    `bind S display-popup -E -w '100%' -h '75%' -x 0 -y S ${quote(popup('Sessions'))}`,
    `bind R display-popup -E -w '100%' -h '75%' -x 0 -y S ${quote(popup('Reviews'))}`,
    `bind X run-shell -b ${quote(action('pause-active'))}`,
    `bind Q run-shell -b ${quote(action('shutdown'))}`,
    'bind-key -T copy-mode-vi WheelUpPane send-keys -X scroll-up',
    ''
  ].join('\n');
}

function writeTmuxConfig(file, options, io = fs) {
  atomicWrite(file, tmuxConfig(options), io);
  io.chmodSync?.(file, 0o600);
  return file;
}

module.exports = { quote, internalCommand, tmuxConfig, writeTmuxConfig };
