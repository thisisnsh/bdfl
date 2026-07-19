'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { projectRootFromInput, isActiveState, statusSummary, statusline } = require('../../src/hooks/statusline');

test('renders only concrete model and workload facts', () => {
  const output = statusline({
    color: false,
    state: {
      version: 1,
      runs: [{ status: 'running', model: 'codex:gpt-5.6-sol:medium' }],
      tasks: [{ status: 'validating' }, { status: 'completed' }],
      agents: [{ status: 'running' }],
      inbox: [{ status: 'open' }]
    }
  });
  assert.equal(output, 'BDFL · codex:gpt-5.6-sol:medium · 1 agent · 1 task · 1 question');
  assert.doesNotMatch(output, /strategizing|commanding|orchestrating/);
});

test('uses Claude workspace input to find project state', () => {
  assert.equal(projectRootFromInput('{"workspace":{"project_dir":"/project"}}', '/fallback'), '/project');
  assert.equal(projectRootFromInput('invalid', '/fallback'), '/fallback');
});

test('emits yellow ANSI color even when the status command is not a TTY', () => {
  const output = statusline({ state: { version: 1, runs: [{ status: 'running', model: 'claude:sonnet:medium' }] } });
  assert.match(output, /^\u001b\[38;5;220mBDFL · claude:sonnet:medium\u001b\[0m$/);
});

test('stays hidden until activation and hides after off', () => {
  assert.equal(isActiveState({ version: 1 }), false);
  assert.equal(statusline({ state: { version: 1 } }), '');
  assert.equal(statusline({ state: { version: 1, runs: [{ status: 'completed' }] } }), '');
  assert.equal(isActiveState({ runs: [{ status: 'running' }] }), true);
});
