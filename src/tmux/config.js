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
    'set -g mouse on',
    'set -g history-limit 5000',
    'set -g remain-on-exit on',
    'set -g status on',
    'set -g status-position bottom',
    'set -g status 3',
    'set -g status-interval 1',
    'set -g status-style "bg=default,fg=colour245"',
    'set -g status-left ""',
    'set -g status-right ""',
    'set -g pane-border-status top',
    'set -g pane-border-format " #{E:@bdfl-label} "',
    'set -g pane-border-style "fg=colour238"',
    'set -g pane-active-border-style "fg=colour81"',
    'set -g status-format[0] "#[fg=colour245] BDFL  #[range=control|0]#[fg=colour81][New]#[norange] #[range=control|1][Plans]#[norange] #[range=control|2][Sessions]#[norange] #[range=control|3][Reviews]#[norange] #[range=control|4][Pause]#[norange]#[align=right]#[fg=colour245]click labels · C-b + arrows "',
    'set -g status-format[1] "#[fg=colour245] Agents  #{W:#{?#{&&:#{window_active},#{@bdfl-workstream-id}},#{P:#[range=pane|#{pane_id}] #{E:@bdfl-label} #[norange]},},}"',
    'set -g status-format[2] "#[fg=colour245] Sessions  #{W:#{?@bdfl-workstream-id,#[range=window|#{window_index}]#{?window_active,#[fg=colour81]◆ ,}#[fg=white]#{window_name}#[default] #[norange],},}"',
    `bind N display-popup -E -w '100%' -h '75%' -x 0 -y S ${quote(popup('New'))}`,
    `bind n display-popup -E -w '100%' -h '75%' -x 0 -y S ${quote(popup('New'))}`,
    `bind P display-popup -E -w '100%' -h '75%' -x 0 -y S ${quote(popup('Plans'))}`,
    `bind p display-popup -E -w '100%' -h '75%' -x 0 -y S ${quote(popup('Plans'))}`,
    `bind S display-popup -E -w '100%' -h '75%' -x 0 -y S ${quote(popup('Sessions'))}`,
    `bind s display-popup -E -w '100%' -h '75%' -x 0 -y S ${quote(popup('Sessions'))}`,
    `bind R display-popup -E -w '100%' -h '75%' -x 0 -y S ${quote(popup('Reviews'))}`,
    `bind r display-popup -E -w '100%' -h '75%' -x 0 -y S ${quote(popup('Reviews'))}`,
    `bind X run-shell -b ${quote(action('pause-active'))}`,
    `bind x run-shell -b ${quote(action('pause-active'))}`,
    `bind Q run-shell -b ${quote(action('shutdown'))}`,
    `bind q run-shell -b ${quote(action('shutdown'))}`,
    'bind Left previous-window',
    'bind Right next-window',
    'bind Up select-pane -t :.-',
    'bind Down select-pane -t :.+',
    'bind h previous-window',
    'bind l next-window',
    'bind k select-pane -t :.-',
    'bind j select-pane -t :.+',
    `bind -T root MouseDown1Control0 display-popup -E -w '100%' -h '75%' -x 0 -y S ${quote(popup('New'))}`,
    `bind -T root MouseDown1Control1 display-popup -E -w '100%' -h '75%' -x 0 -y S ${quote(popup('Plans'))}`,
    `bind -T root MouseDown1Control2 display-popup -E -w '100%' -h '75%' -x 0 -y S ${quote(popup('Sessions'))}`,
    `bind -T root MouseDown1Control3 display-popup -E -w '100%' -h '75%' -x 0 -y S ${quote(popup('Reviews'))}`,
    `bind -T root MouseDown1Control4 run-shell -b ${quote(action('pause-active'))}`,
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
