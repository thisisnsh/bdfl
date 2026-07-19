'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { nextAttempt, rewindAttempt } = require('../../src/core/attempts');

test('rewind preserves prior attempts and starts from an explicit safe checkpoint', () => {
  const task = {
    id: 't1',
    attempts: [{ number: 1, status: 'failed', baseCheckpoint: 'base', lastSafeCheckpoint: 'safe' }]
  };
  const rewound = rewindAttempt(task, 'safe', '2026-01-01');
  assert.equal(rewound.attempts.length, 2);
  assert.equal(rewound.attempts[0].status, 'rewound');
  assert.equal(rewound.attempts[1].baseCheckpoint, 'safe');
});

test('follow-up instructions create a fresh attempt without mutating history', () => {
  const task = { id: 't1', attempts: [{ number: 1, status: 'completed', baseCheckpoint: 'base' }] };
  const next = nextAttempt(task, { instructions: 'Handle nulls', checkpoint: 'base', now: '2026-01-01' });
  assert.equal(next.attempts[1].correctiveInstructions, 'Handle nulls');
  assert.equal(task.attempts.length, 1);
});
