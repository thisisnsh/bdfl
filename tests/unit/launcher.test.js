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

test('Codex skills resolve the bundled executable instead of relying on PATH', () => {
  for (const name of ['bdfl', 'models']) {
    const contents = fs.readFileSync(path.resolve(__dirname, '..', '..', 'skills', name, 'SKILL.md'), 'utf8');
    assert.match(contents, /\.\.\/\.\.\/bin\/bdfl/);
    assert.doesNotMatch(contents, /Run `bdfl/);
  }
});

test('Claude skills resolve the executable through CLAUDE_PLUGIN_ROOT', () => {
  for (const name of ['bdfl', 'models']) {
    const contents = fs.readFileSync(path.resolve(__dirname, '..', '..', 'claude', 'skills', name, 'SKILL.md'), 'utf8');
    assert.match(contents, /CLAUDE_PLUGIN_ROOT/);
    assert.doesNotMatch(contents, /Run `bdfl/);
  }
});
