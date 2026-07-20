'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { capturePlan, derivePlanTitle, captureRunPlan, selectPlanVersion, diffLines } = require('../../src/core/plans');
const { initialState } = require('../../src/state/store');

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

test('derives plan titles from the first Markdown heading with a repository fallback', () => {
  assert.equal(derivePlanTitle('intro\n## Ship the router\nbody', '/repo/bdfl'), 'Ship the router');
  assert.equal(derivePlanTitle('No heading here', '/repo/bdfl'), 'bdfl');
});

test('captures one versioned plan per active run and deduplicates unchanged content', () => {
  const state = initialState();
  state.runs.push({ id: 'run-1', status: 'pending' }, { id: 'run-old', status: 'completed' });
  const first = captureRunPlan(state, {
    content: '# Implement selectors\n\nFirst version.',
    projectRoot: '/repo/bdfl',
    now: '2026-01-01',
    id: () => 'plan-internal'
  });
  assert.equal(first.plan.id, 'plan-internal');
  assert.equal(first.plan.runId, 'run-1');
  assert.equal(first.plan.title, 'Implement selectors');
  assert.equal(first.version, 1);
  assert.equal(first.created, true);

  const duplicate = captureRunPlan(first.state, {
    content: '# Implement selectors\n\nFirst version.', projectRoot: '/repo/bdfl', now: '2026-01-02'
  });
  assert.equal(duplicate.state.plans.length, 1);
  assert.equal(duplicate.plan.versions.length, 1);
  assert.equal(duplicate.deduplicated, true);

  const revision = captureRunPlan(duplicate.state, {
    content: '# Implement selectors safely\n\nSecond version.', projectRoot: '/repo/bdfl', now: '2026-01-03'
  });
  assert.equal(revision.state.plans.length, 1);
  assert.equal(revision.plan.title, 'Implement selectors safely');
  assert.equal(revision.plan.versions.length, 2);
  assert.equal(revision.version, 2);
});

test('captures against an explicit run and refuses capture without an active run', () => {
  const state = initialState();
  state.runs.push({ id: 'run-1', status: 'completed' });
  assert.equal(captureRunPlan(state, { runId: 'run-1', content: '# Backfill' }).plan.runId, 'run-1');
  assert.throws(() => captureRunPlan(initialState(), { content: '# Missing run' }), /Activate BDFL/);
});
