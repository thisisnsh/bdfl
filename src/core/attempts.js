'use strict';

function nextAttempt(task, { instructions = null, checkpoint = null, now = new Date().toISOString() } = {}) {
  const attempts = [...(task.attempts || [])];
  const previous = attempts.at(-1);
  if (previous && !['completed', 'failed', 'cancelled', 'review', 'rewound'].includes(previous.status)) {
    throw new Error(`Attempt ${previous.number} is still active`);
  }
  if (previous && checkpoint === null) checkpoint = previous.lastSafeCheckpoint || previous.baseCheckpoint;
  const attempt = {
    number: attempts.length + 1,
    status: 'pending',
    baseCheckpoint: checkpoint,
    correctiveInstructions: instructions,
    createdAt: now
  };
  attempts.push(attempt);
  return { ...task, status: 'pending', attempts };
}

function rewindAttempt(task, checkpoint, now = new Date().toISOString()) {
  const attempts = [...(task.attempts || [])];
  const previous = attempts.at(-1);
  if (!previous) throw new Error('Cannot rewind a task without an attempt');
  attempts[attempts.length - 1] = { ...previous, status: 'rewound', rewoundAt: now };
  return nextAttempt({ ...task, attempts }, { checkpoint, now });
}

module.exports = { nextAttempt, rewindAttempt };
