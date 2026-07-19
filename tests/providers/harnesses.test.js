'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { preflight } = require('../../src/providers');

const bin = path.resolve(__dirname, '..', 'fixtures', 'bin');
const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` };
const run = (command, args, options) => spawnSync(command, args, { ...options, env });

test('fake Claude, Codex, and Ollama harnesses make CI deterministic', () => {
  assert.equal(preflight('claude:sonnet:medium', { host: 'claude', permissionMode: 'default' }, run).ok, true);
  assert.equal(preflight('codex:gpt-5.6-sol:medium', { host: 'codex', permissionMode: 'default' }, run).ok, true);
  assert.equal(preflight('ollama:qwen3.5:9b:medium', {
    host: 'codex', permissionMode: 'default', ollamaBaseUrl: 'http://localhost:11434'
  }, run).ok, true);
});

test('real provider smoke tests are opt-in', { skip: process.env.BDFL_SMOKE !== '1' }, () => {
  const codex = preflight(process.env.BDFL_SMOKE_MODEL || 'codex:gpt-5.6-sol:medium', { host: 'codex', permissionMode: 'read-only' });
  assert.equal(codex.ok, true, codex.message);
});

