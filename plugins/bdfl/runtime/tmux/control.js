'use strict';

const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');

function decodeControl(value) {
  return `${value}`.replace(/\\([0-7]{3})/gu, (_match, octal) => String.fromCodePoint(Number.parseInt(octal, 8)));
}

function parseControlLine(line) {
  let match = /^%output (%\d+) (.*)$/u.exec(line);
  if (match) return { type: 'output', paneId: match[1], data: decodeControl(match[2]) };
  match = /^%pane-exited (%\d+)(?: (\d+))?$/u.exec(line);
  if (match) return { type: 'exit', paneId: match[1], code: Number(match[2] || 0) };
  match = /^%window-pane-changed @\d+ (%\d+)$/u.exec(line);
  if (match) return { type: 'focus', paneId: match[1] };
  match = /^%session-window-changed \$\d+ @\d+$/u.exec(line);
  if (match) return { type: 'window' };
  return null;
}

class TmuxControlClient extends EventEmitter {
  constructor(command, { spawnProcess = spawn } = {}) {
    super();
    this.command = command;
    this.spawnProcess = spawnProcess;
    this.child = null;
    this.buffer = '';
  }
  start() {
    if (this.child) return this;
    this.child = this.spawnProcess('tmux', this.command.args(['-C', 'attach-session', '-t', 'bdfl']), {
      stdio: ['pipe', 'pipe', 'ignore'],
      shell: false
    });
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (data) => {
      this.buffer += data;
      const lines = this.buffer.split('\n');
      this.buffer = lines.pop();
      for (const line of lines) {
        const event = parseControlLine(line.trimEnd());
        if (event) this.emit(event.type, event);
      }
    });
    this.child.once('exit', () => {
      this.child = null;
      this.emit('close');
    });
    return this;
  }
  stop() {
    this.child?.kill();
    this.child = null;
  }
}

module.exports = { decodeControl, parseControlLine, TmuxControlClient };
