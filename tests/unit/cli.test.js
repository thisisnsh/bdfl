'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { initialState } = require('../../src/state/store');
const { HELP, selectModel, snapshot, formatModelList } = require('../../src/cli');

class Store {
  constructor(state = initialState()) { this.state = state; }
  load() { return structuredClone(this.state); }
  update(fn) { this.state = fn(structuredClone(this.state)); return this.state; }
}

const settings = { defaultModel: 'claude:sonnet:medium', models: ['claude:sonnet:medium'] };

test('compatibility help exposes inspection only', () => {
  assert.match(HELP, /status\|models\|plans\|tasks\|agents\|help/);
  assert.doesNotMatch(HELP, /Turn BDFL on|Turn BDFL off/);
});

test('model selection validates and persists the exact listed model', () => {
  const configured = { defaultModel: 'claude:sonnet:medium', models: ['claude:sonnet:medium', 'codex:gpt-5.6-sol:medium'] };
  let persisted;
  const selected = selectModel('codex:gpt-5.6-sol:medium', configured, (value) => { persisted = value; return value; });
  assert.equal(selected.defaultModel, 'codex:gpt-5.6-sol:medium');
  assert.equal(persisted.defaultModel, 'codex:gpt-5.6-sol:medium');
  assert.throws(() => selectModel('codex:unknown:medium', configured, () => {}), /not listed/);
});

test('focused snapshots open the requested management tab', () => {
  const state = initialState();
  state.agents.push({ id: 'agent-1' });
  assert.match(snapshot(state, settings, { color: false }, 'Agents'), /\[Agents\]/);
});

test('non-interactive model list has a current marker and no dead key hints', () => {
  const configured = { defaultModel: 'claude:sonnet:medium', models: ['claude:sonnet:medium', 'codex:gpt-5.6-sol:medium'] };
  const output = formatModelList(configured);
  assert.match(output, /^BDFL · models/m);
  assert.match(output, /● claude:sonnet:medium/);
  assert.match(output, /○ codex:gpt-5.6-sol:medium/);
  assert.doesNotMatch(output, /arrow|↑|↓|Enter/);
});
