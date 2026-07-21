#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const candidates = [
  path.resolve(__dirname, '..', 'src', 'mcp', 'server.js'),
  path.resolve(__dirname, '..', 'runtime', 'mcp', 'server.js')
];
const server = candidates.find((candidate) => fs.existsSync(candidate));
if (!server) throw new Error('BDFL MCP runtime is missing');

const { BdflMcpServer } = require(server);
const presence = require(server.replace(path.join('mcp', 'server.js'), path.join('host', 'presence.js')));
const hostIndex = process.argv.indexOf('--host');
const registryIndex = process.argv.indexOf('--registry');
const host = hostIndex === -1 ? null : process.argv[hostIndex + 1];
const registry = registryIndex === -1 ? undefined : process.argv[registryIndex + 1];
let cleanup = () => {};
const instance = new BdflMcpServer({ onInitialize: () => { if (host) cleanup = presence.registerProcess(host, process.pid, registry); } });
let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  instance.shutdown();
  cleanup();
};
process.on('exit', cleanup);
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => { stop(); process.exit(0); });
instance.start();
