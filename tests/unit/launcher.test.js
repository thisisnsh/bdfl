'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');

test('extensionless plugin executable launches the BDFL runtime', () => {
  const executable = path.resolve(__dirname, '..', '..', 'bin', 'bdfl');
  const result = spawnSync(executable, ['help'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Usage: bdfl/);
});

test('Codex activation resolves the executable and management skills use MCP', () => {
  const activation = fs.readFileSync(path.resolve(__dirname, '..', '..', 'skills', 'bdfl', 'SKILL.md'), 'utf8');
  assert.match(activation, /\.\.\/\.\.\/bin\/bdfl/);
  for (const name of ['models', 'plans', 'agents']) {
    const contents = fs.readFileSync(path.resolve(__dirname, '..', '..', 'skills', name, 'SKILL.md'), 'utf8');
    assert.match(contents, /bundled BDFL MCP server/);
    assert.doesNotMatch(contents, /Run `bdfl|bin\/bdfl/);
  }
});

test('Claude activation resolves the executable and management skills use MCP', () => {
  const activation = fs.readFileSync(path.resolve(__dirname, '..', '..', 'claude', 'skills', 'bdfl', 'SKILL.md'), 'utf8');
  assert.match(activation, /CLAUDE_PLUGIN_ROOT/);
  for (const name of ['models', 'plans', 'agents']) {
    const contents = fs.readFileSync(path.resolve(__dirname, '..', '..', 'claude', 'skills', name, 'SKILL.md'), 'utf8');
    assert.match(contents, /bundled BDFL MCP server/);
    assert.doesNotMatch(contents, /CLAUDE_PLUGIN_ROOT|bin\/bdfl/);
  }
});

test('Codex starts the bundled MCP server from the plugin directory', () => {
  const config = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', 'codex', '.mcp.json'), 'utf8'));
  assert.deepEqual(config.mcpServers.bdfl, {
    command: 'node',
    args: ['./bin/bdfl-mcp.js'],
    cwd: '.'
  });
  const pluginRoot = path.resolve(__dirname, '..', '..', 'plugins', 'bdfl');
  const request = {
    jsonrpc: '2.0',
    id: 0,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test', version: '1.0.0' }
    }
  };
  const result = spawnSync(config.mcpServers.bdfl.command, config.mcpServers.bdfl.args, {
    cwd: pluginRoot,
    input: `${JSON.stringify(request)}\n`,
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr);
  const response = JSON.parse(result.stdout);
  assert.equal(response.id, 0);
  assert.equal(response.result.protocolVersion, '2025-06-18');
});
