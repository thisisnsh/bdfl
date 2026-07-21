'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const readme = fs.readFileSync(path.resolve(__dirname, '..', '..', 'README.md'), 'utf8');

test('README documents MCP-only explicit invocation and the exact management set', () => {
  for (const command of ['status', 'models', 'plans', 'tasks', 'agents', 'help']) assert.match(readme, new RegExp(`BDFL ${command}`));
  assert.doesNotMatch(readme, /\/bdfl\s|\$bdfl/);
  assert.match(readme, /Plan approval, task complexity.*never start BDFL/);
  assert.match(readme, /“BDFL plan this” authorizes planning only/);
  assert.match(readme, /at least two useful atomic tasks/);
});

test('README states identity, Git, host visibility, recovery, and coming-soon boundaries', () => {
  assert.match(readme, /Benevolent Delegator for LLMs/);
  assert.equal(readme.toLowerCase().includes(['dict', 'ator'].join('')), false);
  assert.equal(readme.toLowerCase().includes(['wiki', 'pedia'].join('')), false);
  assert.match(readme, /Git is mandatory/);
  assert.match(readme, /new session says/);
  assert.match(readme, /Codex’s fixed footer is not modified/);
  assert.match(readme, /Continue, Manage tasks, Archive run, and Cancel run/);
  assert.match(readme, /Ollama provider code.*coming soon/i);
  assert.match(readme, /Windows installation is coming soon/);
  for (const section of ['Management requests', 'Recovery', 'Models', 'Local data', 'Advanced install options', 'Uninstall']) assert.match(readme, new RegExp(`<summary>${section}</summary>`));
  assert.doesNotMatch(readme, /align="center"|terminal-demo/);
});
