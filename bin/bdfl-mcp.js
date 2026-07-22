#!/usr/bin/env node
'use strict';

const fs = require('node:fs'); const path = require('node:path'); const readline = require('node:readline');
const base = fs.existsSync(path.resolve(__dirname, '..', 'src')) ? path.resolve(__dirname, '..', 'src') : path.resolve(__dirname, '..', 'runtime');
const { BridgeProxy } = require(path.join(base, 'mcp', 'proxy'));

function argument(name) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : null; }
function write(output, id, value) { output.write(`${JSON.stringify({ jsonrpc: '2.0', id: id ?? null, ...value })}\n`); }
function valid(message) { return message && message.jsonrpc === '2.0' && typeof message.method === 'string' && (message.id === undefined || ['string', 'number'].includes(typeof message.id)); }

async function main({ input = process.stdin, output = process.stdout, descriptor = argument('--descriptor'), proxy = descriptor ? new BridgeProxy(descriptor) : null } = {}) {
  if (!proxy) throw new Error('BDFL capability descriptor is required'); proxy.descriptor.load(true);
  const lines = readline.createInterface({ input, crlfDelay: Infinity }); let tools;
  lines.on('line', (line) => {
    if (!line.trim()) return;
    void (async () => {
      let message; try { message = JSON.parse(line); } catch (error) { write(output, null, { error: { code: -32700, message: error.message } }); return; }
      if (!valid(message)) { write(output, message?.id, { error: { code: -32600, message: 'Invalid JSON-RPC request' } }); return; }
      try { let result;
        if (message.method === 'initialize') { tools = await proxy.initialize(); result = { protocolVersion: message.params?.protocolVersion || '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'bdfl', version: '0.1.0' } }; }
        else if (message.method === 'tools/list') result = tools || await proxy.call({ method: 'tools' });
        else if (message.method === 'tools/call') { if (!message.params?.name) { write(output, message.id, { error: { code: -32602, message: 'Tool name is required' } }); return; } result = await proxy.call({ method: 'call', name: message.params.name, arguments: message.params.arguments || {} }); }
        else if (message.method === 'notifications/initialized') return;
        else { write(output, message.id, { error: { code: -32601, message: `Unknown method: ${message.method}` } }); return; }
        if (message.id !== undefined) write(output, message.id, { result });
      } catch (error) { if (message.id !== undefined) write(output, message.id, { error: { code: -32000, message: error.message } }); }
    })();
  });
  lines.on('close', () => proxy.close()); return lines;
}

if (require.main === module) void main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
module.exports = { main, valid };
