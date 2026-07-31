'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { runtimePaths, ensureRuntime, TmuxCommand } = require('../../src/tmux/command');
const { TmuxServer } = require('../../src/tmux/server');

const available = spawnSync('tmux', ['-V'], { encoding: 'utf8' }).status === 0;

test(
  'real isolated tmux provides clickable navigation, tiled panes, zoom, and crash reattachment',
  { skip: !available },
  (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bdfl-real-tmux-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const paths = runtimePaths(root);
    ensureRuntime(paths);
    const command = new TmuxCommand(paths.tmuxSocket);
    const tmux = new TmuxServer(root, command, paths, { packageRoot: path.resolve(__dirname, '../..') });
    t.after(() => tmux.kill());
    tmux.start();
    assert.equal(command.run(['show-options', '-gv', 'status']), '2');
    assert.equal(command.run(['show-options', '-gv', 'mouse']), 'on');
    assert.equal(command.run(['show-options', '-gv', 'history-limit']), '5000');
    assert.equal(command.run(['show-options', '-gv', 'remain-on-exit']), 'on');
    assert.equal(command.run(['show-options', '-gv', 'pane-border-status']), 'off');
    assert.match(command.run(['list-keys', '-T', 'prefix']), /Left\s+if-shell.*focus-relative/);
    assert.match(command.run(['list-keys', '-T', 'prefix']), /o\s+run-shell.*toggle-overview/);
    assert.match(command.run(['list-keys', '-T', 'root']), /MouseDown1Control2\s+display-popup/);
    const stream = { id: 'workstream-1', name: 'Session 1' };
    const invocation = {
      command: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1000)'],
      cwd: root,
      env: {}
    };
    tmux.openPane(stream, { id: 'agent-1', name: 'Planning', role: 'delegator', turnState: 'idle' }, invocation);
    tmux.openPane(stream, { id: 'agent-2', name: 'Worker 1', role: 'worker', turnState: 'working' }, invocation);
    assert.equal(tmux.panes().filter((pane) => pane.workstreamId === stream.id).length, 2);
    assert.match(
      command.run(['display-message', '-p', '-t', tmux.windowFor(stream.id).windowId, '#{window_layout}']),
      /,/
    );
    assert.equal(tmux.alive(), true);
    const before = command.run(['display-message', '-p', '#{session_id}']);
    const reattached = new TmuxServer(root, new TmuxCommand(paths.tmuxSocket), paths);
    assert.equal(reattached.start(), false);
    assert.equal(command.run(['display-message', '-p', '#{session_id}']), before);
    const pane = tmux.paneFor('agent-1');
    tmux.focus('agent-1');
    assert.equal(command.run(['display-message', '-p', '-t', pane.paneId, '#{window_zoomed_flag}']), '1');
    tmux.openPane(stream, { id: 'agent-3', name: 'Worker 2', role: 'worker', turnState: 'idle' }, invocation);
    assert.equal(command.run(['display-message', '-p', '-t', pane.paneId, '#{window_zoomed_flag}']), '1');
    assert.equal(tmux.toggleOverview(), true);
    assert.equal(command.run(['display-message', '-p', '-t', pane.paneId, '#{window_zoomed_flag}']), '0');
    assert.equal(tmux.toggleOverview(), false);
    assert.equal(command.run(['display-message', '-p', '-t', pane.paneId, '#{window_zoomed_flag}']), '1');
  }
);
