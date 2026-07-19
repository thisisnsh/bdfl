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
