'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { statusline } = require('../../src/hooks/statusline');

test('renders the process verb with the current animation frame', () => {
  const output = statusline({
    now: 1500,
    color: false,
    state: { version: 1, tasks: [{ status: 'validating' }] }
  });
  assert.equal(output, 'BDFL is validating....');
});
