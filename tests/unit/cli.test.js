'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { initialState } = require('../../src/state/store');
const { activate, deactivate } = require('../../src/cli');

class Store {
  constructor(state = initialState()) { this.state = state; }
  load() { return structuredClone(this.state); }
  update(fn) { this.state = fn(structuredClone(this.state)); return this.state; }
}

const settings = { defaultModel: 'claude:sonnet:medium', models: ['claude:sonnet:medium'] };

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
