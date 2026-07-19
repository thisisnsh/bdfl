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
new BdflMcpServer().start();
