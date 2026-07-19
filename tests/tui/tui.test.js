'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { TABS, ACTIONS, TuiController } = require('../../src/tui/controller');
const { bannerFrame, PERIODS } = require('../../src/tui/banner');

test('uses the exact ordinary-period animation and yellow ANSI color', () => {
  assert.deepEqual(PERIODS, [1, 2, 3, 4, 3, 2]);
  assert.match(bannerFrame(0), /^\u001b\[38;5;220mBDFL is commanding\.\u001b\[0m$/);
  assert.equal(bannerFrame(3, false), 'BDFL is commanding....');
});

test('navigates all tabs, details, Esc, and every contextual action', () => {
  const rows = Object.fromEntries(TABS.map((tab) => [tab.toLowerCase(), [{ id: tab }]]));
  const ui = new TuiController(rows, { color: false });
  for (let index = 1; index < TABS.length; index += 1) ui.key('\u001b[C');
  assert.equal(TABS[ui.tab], 'Models');
  ui.key('\r');
  assert.equal(ui.detail, true);
  assert.equal(ui.key('\u001b').action, 'back');
  for (const [key, action] of Object.entries(ACTIONS)) assert.equal(ui.key(key).action, action);
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
  assert.match(output, /x stop/);
  assert.doesNotMatch(output, /\u001b\[/);
});
