'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');
const { requireTmux, runtimePaths, ensureRuntime, TmuxCommand } = require('../tmux/command');
const { TmuxServer } = require('../tmux/server');
const { WorkspaceCatalog } = require('../state/repositories');

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readPid(file, io = fs) {
  try {
    return Number(io.readFileSync(file, 'utf8').trim());
  } catch {
    return 0;
  }
}

function waitForFile(file, timeout = 5000, io = fs) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (io.existsSync(file)) return true;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
  }
  return false;
}

class ForegroundLauncher {
  constructor(
    root,
    {
      dangerous = false,
      packageRoot = path.resolve(__dirname, '../..'),
      io = fs,
      spawnProcess = spawn,
      runProcess = execFileSync,
      commandOptions
    } = {}
  ) {
    this.root = path.resolve(root);
    this.dangerous = dangerous;
    this.packageRoot = packageRoot;
    this.io = io;
    this.spawnProcess = spawnProcess;
    this.runProcess = runProcess;
    this.paths = runtimePaths(root);
    this.commandOptions = commandOptions;
  }
  startDaemon() {
    const log = this.io.openSync(this.paths.log, 'a', 0o600);
    const child = this.spawnProcess(
      process.execPath,
      [
        path.join(this.packageRoot, 'bin', 'bdfl-internal.js'),
        'daemon',
        '--root',
        this.root,
        ...(this.dangerous ? ['--dangerous'] : [])
      ],
      { detached: true, stdio: ['ignore', log, log], shell: false }
    );
    child.once?.('error', () => {});
    child.unref();
    this.io.closeSync(log);
    if (!waitForFile(this.paths.daemonSocket, 5000, this.io)) {
      const error = new Error(`BDFL supervisor did not start; inspect ${this.paths.log}`);
      error.code = 'DAEMON_START_FAILED';
      throw error;
    }
  }
  start() {
    requireTmux(this.commandOptions);
    ensureRuntime(this.paths, this.io);
    if (!processAlive(readPid(this.paths.pid, this.io)) || !this.io.existsSync(this.paths.daemonSocket)) {
      try {
        this.io.unlinkSync(this.paths.daemonSocket);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      this.startDaemon();
    }
    this.runProcess(
      process.execPath,
      [
        path.join(this.packageRoot, 'bin', 'bdfl-internal.js'),
        'action',
        '--socket',
        this.paths.daemonSocket,
        '--name',
        this.dangerous ? 'dangerous-on' : 'dangerous-off'
      ],
      { stdio: 'ignore' }
    );
    const command = new TmuxCommand(this.paths.tmuxSocket, this.commandOptions);
    const tmux = new TmuxServer(this.root, command, this.paths, { packageRoot: this.packageRoot, io: this.io });
    tmux.selectFirst();
    const hasSavedSessions = new WorkspaceCatalog(this.root).load().sessions.length > 0;
    if (!hasSavedSessions)
      command.tryRun([
        'set-hook',
        '-g',
        'client-attached',
        `display-popup -E -w '100%' -h '75%' -x 0 -y S '${process.execPath}' '${path.join(this.packageRoot, 'bin', 'bdfl-internal.js')}' popup --socket '${this.paths.daemonSocket}' --page New`
      ]);
    else command.tryRun(['set-hook', '-gu', 'client-attached']);
    return command.attach('bdfl');
  }
}

module.exports = { processAlive, readPid, waitForFile, ForegroundLauncher };
