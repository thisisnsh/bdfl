'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { capturePlan, selectPlanVersion, diffLines } = require('../../src/core/plans');

test('captures immutable distinct revisions and selects one', () => {
  const first = capturePlan({ id: 'p1', versions: [], selectedVersion: null }, 'one', '2026-01-01');
  const duplicate = capturePlan(first, 'one', '2026-01-02');
  const second = capturePlan(duplicate, 'one\ntwo', '2026-01-03');
  assert.equal(second.versions.length, 2);
  assert.equal(selectPlanVersion(second, 1).selectedVersion, 1);
  assert.throws(() => selectPlanVersion(second, 3), /Unknown plan version/);
});

test('produces semantic line additions and removals', () => {
  assert.deepEqual(diffLines('keep\nold', 'keep\nnew'), [
    { type: 'context', text: 'keep' },
    { type: 'addition', text: 'new' },
    { type: 'removal', text: 'old' }
  ]);
});

