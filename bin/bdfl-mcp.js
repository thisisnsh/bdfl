#!/usr/bin/env node
'use strict';

const fs = require('node:fs'); const path = require('node:path'); const readline = require('node:readline');
const base = fs.existsSync(path.resolve(__dirname, '..', 'src')) ? path.resolve(__dirname, '..', 'src') : path.resolve(__dirname, '..', 'runtime');
const { controlRequest } = require(path.join(base, 'mcp', 'bridge'));

function argument(name) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : null; }
function write(output, id, value) { output.write(`${JSON.stringify({ jsonrpc: '2.0', id, ...value })}\n`); }

async function main({ input = process.stdin, output = process.stdout, url = argument('--url') || process.env.BDFL_CONTROL_URL, token = argument('--token') || process.env.BDFL_CAPABILITY_TOKEN } = {}) {
  if (!url || !token) throw new Error('BDFL bridge URL and capability token are required');
  const lines = readline.createInterface({ input, crlfDelay: Infinity }); let tools;
  lines.on('line', (line) => {
    if (!line.trim()) return;
    void (async () => {
      const message = JSON.parse(line); let result;
      if (message.method === 'initialize') { tools = await controlRequest(url, token, { method: 'tools' }); result = { protocolVersion: message.params?.protocolVersion || '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'bdfl', version: '0.1.0' } }; }
      else if (message.method === 'tools/list') result = tools || await controlRequest(url, token, { method: 'tools' });
      else if (message.method === 'tools/call') result = await controlRequest(url, token, { method: 'call', name: message.params?.name, arguments: message.params?.arguments || {} });
      else return;
      write(output, message.id, { result });
    })().catch((error) => { let id = null; try { id = JSON.parse(line).id; } catch {} write(output, id, { error: { code: -32000, message: error.message } }); lines.close(); process.exitCode = 1; });
  });
  return lines;
}

if (require.main === module) void main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
module.exports = { main };
