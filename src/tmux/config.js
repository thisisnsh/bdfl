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
    'set -g status 2',
    'set -g status-interval 1',
    'set -g status-style "bg=default,fg=colour245"',
    'set -g status-left ""',
    'set -g status-right ""',
    'set -g pane-border-status off',
    'set -g pane-border-format " #{E:@bdfl-label} "',
    'set -g pane-border-style "fg=colour238"',
    'set -g pane-active-border-style "fg=colour81"',
    'set -g status-format[0] "#[fg=colour245] BDFL  #[range=control|0]#[fg=colour81][New]#[norange] #[range=control|1][Plans]#[norange] #[range=control|2][Sessions]#[norange] #[range=control|3][Reviews]#[norange]#[align=right]#[range=control|5][? Help]#[norange] "',
    'set -g status-format[1] "#[fg=colour245] Agents  No open agents"',
    `bind N display-popup -E -w '95%' -h '90%' ${quote(popup('New'))}`,
    `bind n display-popup -E -w '95%' -h '90%' ${quote(popup('New'))}`,
    `bind P display-popup -E -w '95%' -h '90%' ${quote(popup('Plans'))}`,
    `bind p display-popup -E -w '95%' -h '90%' ${quote(popup('Plans'))}`,
    `bind S display-popup -E -w '95%' -h '90%' ${quote(popup('Sessions'))}`,
    `bind s display-popup -E -w '95%' -h '90%' ${quote(popup('Sessions'))}`,
    `bind R display-popup -E -w '95%' -h '90%' ${quote(popup('Reviews'))}`,
    `bind r display-popup -E -w '95%' -h '90%' ${quote(popup('Reviews'))}`,
    `bind X run-shell -b ${quote(action('pause-active'))}`,
    `bind x run-shell -b ${quote(action('pause-active'))}`,
    `bind Q display-popup -E -w '60%' -h '9' ${quote(popup('Shutdown'))}`,
    `bind q display-popup -E -w '60%' -h '9' ${quote(popup('Shutdown'))}`,
    `bind ? display-popup -E -w '95%' -h '90%' ${quote(popup('Help'))}`,
    `bind o run-shell -b ${quote(action('toggle-overview'))}`,
    `bind Enter if-shell -F '#{@bdfl-overview}' ${quote(`run-shell -b ${quote(action('toggle-overview'))}`)} ''`,
    `bind Left if-shell -F '#{@bdfl-overview}' 'select-pane -L' ${quote(`run-shell -b ${quote(`${action('focus-relative')} --direction previous`)}`)}`,
    `bind Right if-shell -F '#{@bdfl-overview}' 'select-pane -R' ${quote(`run-shell -b ${quote(`${action('focus-relative')} --direction next`)}`)}`,
    `bind Up if-shell -F '#{@bdfl-overview}' 'select-pane -U' ''`,
    `bind Down if-shell -F '#{@bdfl-overview}' 'select-pane -D' ''`,
    `bind h run-shell -b ${quote(`${action('focus-relative')} --direction previous`)}`,
    `bind l run-shell -b ${quote(`${action('focus-relative')} --direction next`)}`,
    `bind -T root MouseDown1Control0 display-popup -E -w '95%' -h '90%' ${quote(popup('New'))}`,
    `bind -T root MouseDown1Control1 display-popup -E -w '95%' -h '90%' ${quote(popup('Plans'))}`,
    `bind -T root MouseDown1Control2 display-popup -E -w '95%' -h '90%' ${quote(popup('Sessions'))}`,
    `bind -T root MouseDown1Control3 display-popup -E -w '95%' -h '90%' ${quote(popup('Reviews'))}`,
    `bind -T root MouseDown1Control5 display-popup -E -w '95%' -h '90%' ${quote(popup('Help'))}`,
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
