'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { initialState } = require('../../src/state/store');
const { PlanStore } = require('../../src/core/plans');
const { HELP, selectModel, snapshot, formatModelList, loadPlanRows, migratePlans } = require('../../src/cli');

class Store {
  constructor(state = initialState()) { this.state = state; }
  load() { return structuredClone(this.state); }
  update(fn) { this.state = fn(structuredClone(this.state)); return this.state; }
  save(state) { this.state = structuredClone(state); return this.state; }
  exists() { return true; }
}

const settings = { defaultModel: 'claude:sonnet', models: ['claude:sonnet'] };

test('compatibility help exposes inspection only', () => {
  assert.match(HELP, /status\|models\|plans\|tasks\|agents\|help/);
  assert.doesNotMatch(HELP, /Turn BDFL on|Turn BDFL off/);
});

test('loads current filesystem plan bodies and migrates legacy state plans', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bdfl-cli-plans-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const plans = new PlanStore(root, { id: () => 'plan-id', now: () => new Date('2026-01-02') });
  const state = initialState();
  state.plans.push({ id: 'legacy', title: 'Legacy plan', versions: [{ number: 1, content: '# Legacy plan\n\nBody' }] });
  const store = new Store(state);
  migratePlans(store, plans);
  assert.deepEqual(store.load().plans, []);
  assert.equal(loadPlanRows(plans)[0].versions[0].content, '# Legacy plan\n\nBody');
});

test('model selection validates and persists the exact listed model', () => {
  const configured = { defaultModel: 'claude:sonnet', models: ['claude:sonnet', 'codex:gpt-5.6-sol'] };
  let persisted;
  const selected = selectModel('codex:gpt-5.6-sol', configured, (value) => { persisted = value; return value; });
  assert.equal(selected.defaultModel, 'codex:gpt-5.6-sol');
  assert.equal(persisted.defaultModel, 'codex:gpt-5.6-sol');
  assert.throws(() => selectModel('codex:unknown', configured, () => {}), /not listed/);
});

test('focused snapshots open the requested management tab', () => {
  const state = initialState();
  state.agents.push({ id: 'agent-1' });
  assert.match(snapshot(state, settings, { color: false }, 'Agents'), /\[Agents\]/);
});

test('non-interactive model list has a current marker and no dead key hints', () => {
  const configured = { defaultModel: 'claude:sonnet', models: ['claude:sonnet', 'codex:gpt-5.6-sol'] };
  const output = formatModelList(configured);
  assert.match(output, /^BDFL · models/m);
  assert.match(output, /● claude:sonnet/);
  assert.match(output, /○ codex:gpt-5.6-sol/);
  assert.match(output, /medium effort/);
  assert.doesNotMatch(output, /arrow|↑|↓|Enter/);
});
