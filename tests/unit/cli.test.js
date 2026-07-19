'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { initialState } = require('../../src/state/store');
const { activate, deactivate, defaultModel } = require('../../src/cli');

class Store {
  constructor(state = initialState()) { this.state = state; }
  load() { return structuredClone(this.state); }
  update(fn) { this.state = fn(structuredClone(this.state)); return this.state; }
}

const settings = { defaultModel: 'claude:sonnet:medium', models: ['claude:sonnet:medium'] };

test('default model follows the installed parent host', () => {
  const models = { defaultModel: 'claude:sonnet:medium', models: ['claude:sonnet:medium', 'codex:gpt-5.6-sol:medium'] };
  assert.equal(defaultModel(models, (command) => command === 'claude'), 'claude:sonnet:medium');
  assert.equal(defaultModel(models, (command) => command === 'codex'), 'codex:gpt-5.6-sol:medium');
});

test('explicit configured and requested models are preserved', () => {
  const configured = { defaultModel: 'ollama:qwen3.5:medium', models: ['ollama:qwen3.5:medium'] };
  assert.equal(defaultModel(configured, () => false), 'ollama:qwen3.5:medium');
  const result = activate('/repo', 'ollama:qwen3.5:medium', configured, new Store(), () => false);
  assert.equal(result.model, 'ollama:qwen3.5:medium');
});

test('activation never makes an automatic recovery choice', () => {
  const state = initialState();
  state.agents.push({ id: 'a1', status: 'waiting' });
  const result = activate('/repo', null, settings, new Store(state));
  assert.equal(result.active, false);
  assert.deepEqual(result.recovery.choices, ['resume', 'inspect', 'archive', 'cancel']);
});

test('deactivation waits for running agents', () => {
  const state = initialState();
  state.agents.push({ id: 'a1', status: 'running' });
  assert.equal(deactivate(new Store(state)).blocked, true);
});
