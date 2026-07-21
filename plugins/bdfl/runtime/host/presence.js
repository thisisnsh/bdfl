'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { configDirectory } = require('../core/settings');

function registryFile(file = path.join(configDirectory(), 'processes.json')) { return file; }

function processAlive(pid, signal = process.kill) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { signal(pid, 0); return true; }
  catch (error) { return error.code === 'EPERM'; }
}

function readRegistry(file = registryFile(), io = fs) {
  if (!io.existsSync(file)) return { version: 1, processes: [] };
  try {
    const value = JSON.parse(io.readFileSync(file, 'utf8'));
    return { version: 1, processes: Array.isArray(value.processes) ? value.processes : [] };
  } catch { return { version: 1, processes: [] }; }
}

function writeRegistry(file, value, io = fs) {
  io.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  io.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  io.renameSync(temporary, file);
  return value;
}

function pruneRegistry(file = registryFile(), { io = fs, alive = processAlive } = {}) {
  const current = readRegistry(file, io);
  const processes = current.processes.filter((entry) => ['claude', 'codex'].includes(entry.host) && alive(entry.pid));
  if (processes.length !== current.processes.length) writeRegistry(file, { version: 1, processes }, io);
  return processes;
}

function registerProcess(host, pid = process.pid, file = registryFile(), options = {}) {
  if (!['claude', 'codex'].includes(host)) throw new Error(`Unknown BDFL host: ${host}`);
  const processes = pruneRegistry(file, options).filter((entry) => !(entry.host === host && entry.pid === pid));
  processes.push({ host, pid, startedAt: new Date().toISOString() });
  writeRegistry(file, { version: 1, processes }, options.io || fs);
  return () => unregisterProcess(host, pid, file, options);
}

function unregisterProcess(host, pid = process.pid, file = registryFile(), options = {}) {
  const io = options.io || fs;
  const current = readRegistry(file, io);
  const processes = current.processes.filter((entry) => !(entry.host === host && entry.pid === pid) && (options.alive || processAlive)(entry.pid));
  if (processes.length) writeRegistry(file, { version: 1, processes }, io);
  else if (io.existsSync(file)) io.rmSync(file, { force: true });
  return processes;
}

function hostIsLive(host, file = registryFile(), options = {}) {
  return pruneRegistry(file, options).some((entry) => entry.host === host);
}

function startupNotice(host, file, options) {
  return hostIsLive(host, file, options)
    ? 'BDFL — Benevolent Delegator for LLMs — is enabled and ready. It acts only when you explicitly ask BDFL.'
    : '';
}

module.exports = { registryFile, processAlive, readRegistry, writeRegistry, pruneRegistry, registerProcess, unregisterProcess, hostIsLive, startupNotice };
