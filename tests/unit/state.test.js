'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { StateStore, initialState, recoveryOptions } = require('../../src/state/store');

test('persists state atomically and detects unfinished recovery', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bdfl-state-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = new StateStore(root);
  assert.deepEqual(store.load(), initialState());
  const state = initialState();
  state.agents.push({ id: 'agent-1', status: 'waiting' });
  state.inbox.push({ id: 'inbox-1', status: 'open' });
  store.save(state);
  assert.equal(store.load().agents[0].id, 'agent-1');
  assert.deepEqual(recoveryOptions(store.load()).choices, ['resume', 'inspect', 'archive', 'cancel']);
  assert.deepEqual(fs.readdirSync(path.join(root, '.bdfl')), ['state.json']);
});

test('does not require recovery for terminal state', () => {
  const state = initialState();
  state.runs.push({ id: 'run-1', status: 'completed' });
  assert.deepEqual(recoveryOptions(state), { required: false });
});

