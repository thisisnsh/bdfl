'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { TABS, ACTIONS, TuiController } = require('../../src/tui/controller');
const { bannerFrame, verbForState, VERBS, PERIODS } = require('../../src/tui/banner');

test('uses the exact ordinary-period animation and yellow ANSI color', () => {
  assert.deepEqual(PERIODS, [1, 2, 3, 4, 3, 2]);
  assert.match(bannerFrame(0), /^\u001b\[38;5;220mBDFL · commanding\.\u001b\[0m$/);
  assert.equal(bannerFrame(3, false), 'BDFL · commanding....');
});

test('selects dynamic verbs from the current process state', () => {
  assert.equal(VERBS.length, 9);
  assert.equal(verbForState({ runs: [{ status: 'pending' }] }), 'strategizing');
  assert.equal(verbForState({ tasks: [{ status: 'pending' }] }), 'delegating');
  assert.equal(verbForState({ agents: [{ status: 'running' }] }), 'orchestrating');
  assert.equal(verbForState({ tasks: [{ status: 'running' }] }), 'executing');
  assert.equal(verbForState({ inbox: [{ status: 'open' }] }), 'awaiting');
  assert.equal(verbForState({ tasks: [{ status: 'review' }] }), 'reviewing');
  assert.equal(verbForState({ tasks: [{ status: 'validating' }] }), 'validating');
  assert.equal(verbForState({ runs: [{ status: 'integrating' }] }), 'integrating');
  assert.equal(verbForState({}), 'commanding');
});

test('navigates all tabs, details, Esc, and every contextual action', () => {
  const rows = Object.fromEntries(TABS.map((tab) => [tab.toLowerCase(), [{ id: tab }]]));
  const ui = new TuiController(rows, { color: false });
  for (let index = 1; index < TABS.length - 1; index += 1) ui.key('\u001b[C');
  assert.equal(TABS[ui.tab], 'Agents');
  ui.key('\r');
  assert.equal(ui.detail, true);
  assert.equal(ui.key('\u001b').action, 'back');
  ui.key('\u001b[C');
  assert.equal(TABS[ui.tab], 'Models');
  for (const [key, action] of Object.entries(ACTIONS)) {
    assert.equal(ui.key(key).action, key === 'a' ? 'select' : action);
  }
});

test('opens focused views and exposes model selection', () => {
  const ui = new TuiController({ models: [{ id: 'claude:sonnet:medium', selected: true }] }, { color: false, initialTab: 'Models', focused: true });
  assert.equal(TABS[ui.tab], 'Models');
  assert.equal(ui.key('a').action, 'select');
  assert.equal(ui.key('\r').action, 'select');
  assert.equal(ui.key('q').action, 'quit');
  assert.match(ui.render(), /● claude:sonnet:medium/);
  assert.match(ui.render(), /Enter select/);
  assert.match(ui.render(), /^BDFL · models/);
  assert.doesNotMatch(ui.render(), /Runs.*Plans.*Tasks/);
});

test('empty focused views show a specific empty state without dead controls', () => {
  const plans = new TuiController({}, { color: false, initialTab: 'Plans', focused: true });
  assert.match(plans.render(), /No plans\./);
  assert.doesNotMatch(plans.render(), /version|approve|diff\/full/);
  const agents = new TuiController({}, { color: false, initialTab: 'Agents', focused: true });
  assert.match(agents.render(), /No agents\./);
  assert.doesNotMatch(agents.render(), /stop|rewind|follow-up/);
});

test('plan detail changes versions and switches diff/full modes', () => {
  const ui = new TuiController({ plans: [{ id: 'p1', versions: [
    { number: 1, content: 'old' }, { number: 2, content: 'new' }
  ] }] }, { color: true });
  ui.key('\u001b[C');
  ui.key('\r');
  ui.key('\u001b[B');
  assert.match(ui.render(), /\u001b\[32m\+ new/);
  assert.match(ui.render(), /\u001b\[31m- old/);
  ui.key('\u001b[C');
  assert.match(ui.render(), /v2 · full/);
  assert.equal(ui.key('a').version, 2);
});

test('resizes, clips, renders bottom keys, and falls back without color', () => {
  const ui = new TuiController({ runs: [{ id: 'a very long identifier for clipping' }] }, { color: false });
  ui.resize(24, 8);
  const output = ui.render();
  assert.ok(output.split('\n').every((line) => line.length <= 24));
  assert.match(output, /Ent/);
  assert.doesNotMatch(output, /\u001b\[/);
});
