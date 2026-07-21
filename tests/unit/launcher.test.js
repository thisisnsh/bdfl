'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');

test('the unadvertised compatibility executable still launches the runtime', () => {
  const executable = path.resolve(__dirname, '..', '..', 'bin', 'bdfl');
  const result = spawnSync(executable, ['help'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Usage: bdfl/);
});

test('neither host ships a BDFL command skill', () => {
  const root = path.resolve(__dirname, '..', '..');
  assert.equal(fs.existsSync(path.join(root, 'skills', 'bdfl', 'SKILL.md')), false);
  assert.equal(fs.existsSync(path.join(root, 'claude', 'skills', 'bdfl', 'SKILL.md')), false);
  assert.equal(fs.existsSync(path.join(root, 'plugins', 'bdfl', 'skills', 'bdfl', 'SKILL.md')), false);
});

test('the directly runnable MCP server completes a fresh handshake', () => {
  const request = {
    jsonrpc: '2.0', id: 0, method: 'initialize',
    params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1.0.0' } }
  };
  const result = spawnSync(process.execPath, [path.resolve(__dirname, '..', '..', 'bin', 'bdfl-mcp.js')], {
    input: `${JSON.stringify(request)}\n`, encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr);
  const response = JSON.parse(result.stdout);
  assert.equal(response.id, 0);
  assert.equal(response.result.serverInfo.name, 'bdfl');
});
