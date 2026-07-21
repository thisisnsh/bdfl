'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const readme = fs.readFileSync(path.resolve(__dirname, '..', '..', 'README.md'), 'utf8');

test('README documents the exact public command set for both hosts', () => {
  for (const command of ['on', 'off', 'models', 'plans', 'tasks', 'agents', 'help']) {
    assert.match(readme, new RegExp(`/bdfl ${command}`));
    assert.match(readme, new RegExp(`\\$bdfl ${command}`));
  }
  assert.match(readme, /`workflow`, `inbox`, and `capture-plan` are not commands/);
});

test('README states Git, hook, recovery, and coming-soon boundaries', () => {
  assert.match(readme, /Git is mandatory/);
  assert.match(readme, /no `SessionStart` hook/);
  assert.match(readme, /questions appear automatically/i);
  assert.match(readme, /Ollama support.*coming soon/i);
  assert.match(readme, /Windows installation is coming soon/);
  assert.doesNotMatch(readme, /terminal-demo/);
});
