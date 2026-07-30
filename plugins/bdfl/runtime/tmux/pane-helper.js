'use strict';

const fs = require('node:fs');
const { spawn } = require('node:child_process');

function readLaunchDescriptor(file, io = fs) {
  const stat = io.lstatSync(file);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('Unsafe BDFL launch descriptor type');
  if ((stat.mode & 0o077) !== 0) throw new Error('Unsafe BDFL launch descriptor permissions');
  if (typeof process.getuid === 'function' && stat.uid !== process.getuid())
    throw new Error('Unsafe BDFL launch descriptor owner');
  const value = JSON.parse(io.readFileSync(file, 'utf8'));
  if (
    value.schema !== 1 ||
    typeof value.command !== 'string' ||
    !Array.isArray(value.args) ||
    value.args.some((item) => typeof item !== 'string') ||
    typeof value.cwd !== 'string' ||
    !value.env ||
    Object.values(value.env).some((item) => typeof item !== 'string')
  )
    throw new Error('Invalid BDFL launch descriptor');
  return value;
}

function launchPane(file, { io = fs, spawnProcess = spawn, environment = process.env } = {}) {
  const descriptor = readLaunchDescriptor(file, io);
  io.unlinkSync(file);
  const child = spawnProcess(descriptor.command, descriptor.args, {
    cwd: descriptor.cwd,
    env: { ...environment, ...descriptor.env },
    stdio: 'inherit',
    shell: false
  });
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'])
    process.on(signal, () => {
      if (!child.killed) child.kill(signal);
    });
  child.once('exit', (code, signal) => {
    process.exitCode = signal ? 128 : (code ?? 1);
  });
  child.once('error', (error) => {
    process.stderr.write(`Unable to launch provider: ${error.message}\n`);
    process.exitCode = 1;
  });
  return child;
}

module.exports = { readLaunchDescriptor, launchPane };
