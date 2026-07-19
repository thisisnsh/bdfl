'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { projectRootFromInput, isActiveState, statusline } = require('../../src/hooks/statusline');

test('renders the process verb with the current animation frame', () => {
  const output = statusline({
    now: 1500,
    color: false,
    state: { version: 1, runs: [{ status: 'running' }], tasks: [{ status: 'validating' }] }
  });
  assert.equal(output, 'BDFL is validating..');
});

test('uses Claude workspace input to find project state', () => {
  assert.equal(projectRootFromInput('{"workspace":{"project_dir":"/project"}}', '/fallback'), '/project');
  assert.equal(projectRootFromInput('invalid', '/fallback'), '/fallback');
});

test('emits yellow ANSI color even when the status command is not a TTY', () => {
  const output = statusline({ now: 0, state: { version: 1, runs: [{ status: 'running' }] } });
  assert.match(output, /^\u001b\[38;5;220mBDFL is commanding\.\u001b\[0m$/);
});

test('stays hidden until activation and hides after off', () => {
  assert.equal(isActiveState({ version: 1 }), false);
  assert.equal(statusline({ state: { version: 1 } }), '');
  assert.equal(statusline({ state: { version: 1, runs: [{ status: 'completed' }] } }), '');
  assert.equal(isActiveState({ runs: [{ status: 'running' }] }), true);
});
