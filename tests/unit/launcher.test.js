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

test('Codex ships one bare skill that routes management and dispatch through MCP', () => {
  const contents = fs.readFileSync(path.resolve(__dirname, '..', '..', 'skills', 'bdfl', 'SKILL.md'), 'utf8');
  assert.match(contents, /MCP `bdfl`/);
  assert.match(contents, /MCP `dispatch`/);
  assert.match(contents, /MCP `continue`/);
  assert.doesNotMatch(contents, /needsPlanBackfill/);
  assert.doesNotMatch(contents, /bin\/bdfl|bundled executable/);
  for (const removed of ['models', 'plans', 'agents']) {
    assert.equal(fs.existsSync(path.resolve(__dirname, '..', '..', 'skills', removed, 'SKILL.md')), false);
  }
});

test('Claude ships one bare skill with the event-driven command protocol', () => {
  const contents = fs.readFileSync(path.resolve(__dirname, '..', '..', 'claude', 'skills', 'bdfl', 'SKILL.md'), 'utf8');
  assert.match(contents, /`on`, `off`, `models`, `plans`, `tasks`, `agents`, or `help`/);
  assert.match(contents, /MCP `continue`/);
  assert.doesNotMatch(contents, /needsPlanBackfill/);
  assert.doesNotMatch(contents, /CLAUDE_PLUGIN_ROOT|bin\/bdfl/);
  for (const removed of ['models', 'plans', 'agents']) {
    assert.equal(fs.existsSync(path.resolve(__dirname, '..', '..', 'claude', 'skills', removed, 'SKILL.md')), false);
  }
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
