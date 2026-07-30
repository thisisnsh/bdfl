'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { atomicWrite } = require('../core/plans');
const { agentLabel } = require('./status');
const { quote, internalCommand, writeTmuxConfig } = require('./config');

const FIELD_SEPARATOR = '\u001f';

function parseRows(output, fields) {
  if (!output) return [];
  return `${output}`
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const values = line.split(FIELD_SEPARATOR);
      return Object.fromEntries(fields.map((field, index) => [field, values[index] ?? '']));
    });
}

function paneRows(output) {
  return parseRows(output, ['paneId', 'windowId', 'sessionId', 'workstreamId', 'dead', 'active']);
}

function windowRows(output) {
  return parseRows(output, ['windowId', 'workstreamId', 'name', 'active']);
}

function clientWidths(output) {
  return `${output || ''}`
    .split('\n')
    .map(Number)
    .filter((value) => Number.isFinite(value) && value > 0);
}

class TmuxServer {
  constructor(root, command, paths, { packageRoot = path.resolve(__dirname, '../..'), io = fs } = {}) {
    this.root = path.resolve(root);
    this.command = command;
    this.paths = paths;
    this.packageRoot = packageRoot;
    this.io = io;
  }
  alive() {
    return this.command.tryRun(['has-session', '-t', 'bdfl']) !== null;
  }
  start() {
    writeTmuxConfig(
      this.paths.config,
      { packageRoot: this.packageRoot, daemonSocket: this.paths.daemonSocket },
      this.io
    );
    if (this.alive()) {
      this.command.tryRun(['source-file', this.paths.config]);
      return false;
    }
    this.command.run([
      '-f',
      this.paths.config,
      'new-session',
      '-d',
      '-s',
      'bdfl',
      '-n',
      'BDFL',
      '-c',
      this.root,
      internalCommand(this.packageRoot, 'empty-pane')
    ]);
    this.command.run(['set-option', '-w', '-t', 'bdfl:0', '@bdfl-placeholder', '1']);
    return true;
  }
  panes() {
    return paneRows(
      this.command.tryRun([
        'list-panes',
        '-a',
        '-F',
        [
          '#{pane_id}',
          '#{window_id}',
          '#{@bdfl-session-id}',
          '#{@bdfl-workstream-id}',
          '#{pane_dead}',
          '#{pane_active}'
        ].join(FIELD_SEPARATOR)
      ])
    );
  }
  windows() {
    return windowRows(
      this.command.tryRun([
        'list-windows',
        '-a',
        '-F',
        ['#{window_id}', '#{@bdfl-workstream-id}', '#{window_name}', '#{window_active}'].join(FIELD_SEPARATOR)
      ])
    );
  }
  narrowestClientWidth(fallback = 80) {
    const widths = clientWidths(
      this.command.tryRun(['list-clients', '-F', '#{?client_control_mode,,#{client_width}}'])
    );
    return widths.length ? Math.min(...widths) : fallback;
  }
  launchDescriptor(session, invocation) {
    const file = path.join(this.paths.launches, `${session.id}-${crypto.randomUUID()}.json`);
    atomicWrite(
      file,
      `${JSON.stringify(
        {
          schema: 1,
          sessionId: session.id,
          command: invocation.command,
          args: invocation.args,
          cwd: invocation.cwd,
          env: invocation.env
        },
        null,
        2
      )}\n`,
      this.io
    );
    this.io.chmodSync?.(file, 0o600);
    return file;
  }
  windowFor(workstreamId) {
    return this.windows().find((window) => window.workstreamId === workstreamId);
  }
  paneFor(sessionId) {
    return this.panes().find((pane) => pane.sessionId === sessionId);
  }
  ensureWindow(stream, descriptor, cwd) {
    const current = this.windowFor(stream.id);
    if (current) return current.windowId;
    const placeholder = this.windows().find((window) => !window.workstreamId);
    const target = placeholder?.windowId;
    if (target) {
      this.command.run([
        'respawn-pane',
        '-k',
        '-t',
        target,
        '-c',
        cwd,
        internalCommand(this.packageRoot, 'pane', descriptor)
      ]);
      this.command.run(['rename-window', '-t', target, stream.name]);
      this.command.run(['set-option', '-w', '-t', target, '@bdfl-workstream-id', stream.id]);
      return this.command.run(['display-message', '-p', '-t', target, '#{pane_id}']);
    }
    const id = this.command.run([
      'new-window',
      '-d',
      '-P',
      '-F',
      '#{window_id}',
      '-t',
      'bdfl:',
      '-n',
      stream.name,
      '-c',
      cwd,
      internalCommand(this.packageRoot, 'pane', descriptor)
    ]);
    this.command.run(['set-option', '-w', '-t', id, '@bdfl-workstream-id', stream.id]);
    return this.command.run(['display-message', '-p', '-t', id, '#{pane_id}']);
  }
  openPane(stream, session, invocation) {
    const existing = this.paneFor(session.id);
    if (existing && existing.dead !== '1') return existing.paneId;
    const descriptor = this.launchDescriptor(session, invocation);
    let paneId;
    const window = this.windowFor(stream.id);
    if (!window) paneId = this.ensureWindow(stream, descriptor, invocation.cwd);
    else if (existing) {
      this.command.run([
        'respawn-pane',
        '-k',
        '-t',
        existing.paneId,
        '-c',
        invocation.cwd,
        internalCommand(this.packageRoot, 'pane', descriptor)
      ]);
      paneId = existing.paneId;
    } else {
      paneId = this.command.run([
        'split-window',
        '-d',
        '-P',
        '-F',
        '#{pane_id}',
        '-t',
        window.windowId,
        '-c',
        invocation.cwd,
        internalCommand(this.packageRoot, 'pane', descriptor)
      ]);
    }
    this.command.run(['set-option', '-p', '-t', paneId, '@bdfl-session-id', session.id]);
    this.command.run(['set-option', '-p', '-t', paneId, '@bdfl-workstream-id', stream.id]);
    this.setLabel(paneId, session);
    this.command.run(['select-layout', '-t', paneId, 'tiled']);
    return paneId;
  }
  setLabel(paneId, session, focused = false, columns = Infinity) {
    if (!Number.isFinite(columns)) {
      const pane = this.panes().find((item) => item.paneId === paneId);
      const count = pane ? this.panes().filter((item) => item.windowId === pane.windowId).length : 1;
      columns = Math.max(1, Math.floor((this.narrowestClientWidth() - Math.max(0, count - 1)) / count));
    }
    this.command.tryRun([
      'set-option',
      '-p',
      '-t',
      paneId,
      '@bdfl-label',
      agentLabel(session, { focused, columns, tmux: true })
    ]);
  }
  focus(sessionId) {
    const pane = this.paneFor(sessionId);
    if (!pane) return false;
    this.command.run(['select-window', '-t', pane.windowId]);
    this.command.run(['select-pane', '-t', pane.paneId]);
    return true;
  }
  activePane() {
    return this.panes().find((pane) => pane.active === '1');
  }
  killPane(sessionId) {
    const pane = this.paneFor(sessionId);
    if (!pane) return false;
    const windowPanes = this.panes().filter((item) => item.windowId === pane.windowId);
    if (windowPanes.length === 1 && this.windows().length === 1) {
      this.command.tryRun(['respawn-pane', '-k', '-t', pane.paneId, internalCommand(this.packageRoot, 'empty-pane')]);
      for (const option of ['@bdfl-session-id', '@bdfl-workstream-id', '@bdfl-label'])
        this.command.tryRun(['set-option', '-pu', '-t', pane.paneId, option]);
      this.command.tryRun(['set-option', '-wu', '-t', pane.windowId, '@bdfl-workstream-id']);
      this.command.tryRun(['rename-window', '-t', pane.windowId, 'BDFL']);
    } else this.command.tryRun(['kill-pane', '-t', pane.paneId]);
    return true;
  }
  snapshot(sessionId, destination) {
    const pane = this.paneFor(sessionId);
    if (!pane) return null;
    const content = this.command.tryRun(['capture-pane', '-p', '-e', '-S', '-5000', '-t', pane.paneId]);
    if (content === null) return null;
    atomicWrite(destination, `${content}\n`, this.io);
    this.io.chmodSync?.(destination, 0o600);
    return destination;
  }
  message(value) {
    this.command.tryRun(['display-message', `${value}`]);
  }
  selectFirst() {
    const pane = this.panes().find((item) => item.sessionId && item.dead !== '1');
    return pane ? this.focus(pane.sessionId) : false;
  }
  kill() {
    this.command.tryRun(['kill-server']);
  }
}

module.exports = { FIELD_SEPARATOR, parseRows, paneRows, windowRows, clientWidths, TmuxServer, quote };
