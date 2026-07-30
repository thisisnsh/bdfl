'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');

const MINIMUM_TMUX = Object.freeze({ major: 3, minor: 2 });

function parseTmuxVersion(value) {
  const match = /tmux\s+(\d+)\.(\d+)([a-z]?)/iu.exec(`${value || ''}`.trim());
  return match ? { major: Number(match[1]), minor: Number(match[2]), suffix: match[3] || '' } : null;
}

function supportedTmux(value) {
  const version = typeof value === 'string' ? parseTmuxVersion(value) : value;
  return Boolean(
    version &&
    (version.major > MINIMUM_TMUX.major ||
      (version.major === MINIMUM_TMUX.major && version.minor >= MINIMUM_TMUX.minor))
  );
}

function installationGuidance(platform = process.platform) {
  if (platform === 'darwin') return 'Install tmux 3.2 or newer with: brew install tmux';
  if (platform === 'linux')
    return 'Install tmux 3.2 or newer with your package manager, for example: sudo apt install tmux';
  return 'Install tmux 3.2 or newer with your system package manager.';
}

function requireTmux({ command = execFileSync, platform = process.platform } = {}) {
  let output;
  try {
    output = command('tmux', ['-V'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (cause) {
    const error = new Error(`tmux is required. ${installationGuidance(platform)}`, { cause });
    error.code = 'TMUX_REQUIRED';
    throw error;
  }
  const version = parseTmuxVersion(output);
  if (!supportedTmux(version)) {
    const error = new Error(
      `tmux 3.2 or newer is required (found ${`${output}`.trim()}). ${installationGuidance(platform)}`
    );
    error.code = 'TMUX_TOO_OLD';
    throw error;
  }
  return version;
}

function runtimePaths(root) {
  const run = path.join(path.resolve(root), '.bdfl', 'run');
  return {
    run,
    tmuxSocket: path.join(run, 'tmux.sock'),
    daemonSocket: path.join(run, 'supervisor.sock'),
    config: path.join(run, 'tmux.conf'),
    pid: path.join(run, 'supervisor.pid'),
    log: path.join(run, 'supervisor.log'),
    launches: path.join(run, 'launches')
  };
}

function ensureRuntime(paths, io = fs) {
  io.mkdirSync(paths.run, { recursive: true, mode: 0o700 });
  io.chmodSync?.(paths.run, 0o700);
  io.mkdirSync(paths.launches, { recursive: true, mode: 0o700 });
  io.chmodSync?.(paths.launches, 0o700);
}

class TmuxCommand {
  constructor(socket, { command = execFileSync, spawnProcess = spawn } = {}) {
    this.socket = socket;
    this.command = command;
    this.spawnProcess = spawnProcess;
  }
  args(args) {
    return ['-S', this.socket, ...args];
  }
  run(args, options = {}) {
    return `${this.command('tmux', this.args(args), {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options
    })}`.trimEnd();
  }
  tryRun(args, options = {}) {
    try {
      return this.run(args, options);
    } catch {
      return null;
    }
  }
  attach(target = 'bdfl', options = {}) {
    return this.spawnProcess('tmux', this.args(['attach-session', '-t', target]), {
      stdio: 'inherit',
      ...options
    });
  }
}

module.exports = {
  MINIMUM_TMUX,
  parseTmuxVersion,
  supportedTmux,
  installationGuidance,
  requireTmux,
  runtimePaths,
  ensureRuntime,
  TmuxCommand
};
