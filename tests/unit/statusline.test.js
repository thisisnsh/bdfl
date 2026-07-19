'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { projectRootFromInput, statusline } = require('../../src/hooks/statusline');

test('renders the process verb with the current animation frame', () => {
  const output = statusline({
    now: 1500,
    color: false,
    state: { version: 1, tasks: [{ status: 'validating' }] }
  });
  assert.equal(output, 'BDFL is validating..');
});

test('uses Claude workspace input to find project state', () => {
  assert.equal(projectRootFromInput('{"workspace":{"project_dir":"/project"}}', '/fallback'), '/project');
  assert.equal(projectRootFromInput('invalid', '/fallback'), '/fallback');
});

test('emits yellow ANSI color even when the status command is not a TTY', () => {
  const output = statusline({ now: 0, state: { version: 1 } });
  assert.match(output, /^\u001b\[38;5;220mBDFL is commanding\.\u001b\[0m$/);
});
