'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PlanStore, derivePlanTitle, diffLines } = require('../../src/core/plans');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bdfl-plans-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let sequence = 0;
  return { root, store: new PlanStore(root, { id: () => `abcdef${++sequence}123456`, now: () => new Date('2026-01-01T00:00:00Z') }) };
}

test('stores immutable Markdown revisions atomically and deduplicates by SHA-256', (t) => {
  const { root, store } = fixture(t);
  const first = store.capture({ content: '# Ship router\n\none', host: 'claude', session: 's1', episode: '1', sourcePath: '/native/plan.md' });
  const duplicate = store.capture({ content: '# Ship router\n\none', host: 'claude', session: 's1', episode: '1' });
  const second = store.capture({ content: '# Ship router\n\ntwo', host: 'claude', session: 's1', episode: '1' });
  assert.equal(first.plan.id, second.plan.id);
  assert.equal(duplicate.deduplicated, true);
  assert.equal(store.list()[0].versions.length, 2);
  assert.equal(store.content(first.plan.id, 2), '# Ship router\n\ntwo');
  assert.deepEqual(fs.readdirSync(path.join(root, '.bdfl', 'plans', first.plan.directory, 'versions')), ['0001.md', '0002.md']);
  assert.equal(fs.readdirSync(path.join(root, '.bdfl', 'plans')).some((file) => file.endsWith('.tmp')), false);
});

test('separates plan episodes in one host session and selects a version', (t) => {
  const { store } = fixture(t);
  const one = store.capture({ content: '# First', host: 'codex', session: 'same', episode: '1' });
  const two = store.capture({ content: '# Second', host: 'codex', session: 'same', episode: '2' });
  assert.notEqual(one.plan.id, two.plan.id);
  assert.equal(store.select(one.plan.id, 1).selectedVersion, 1);
  assert.throws(() => store.select(one.plan.id, 9), /Unknown plan version/);
});

test('migrates legacy state plans once and removes embedded bodies', (t) => {
  const { store } = fixture(t);
  const state = { plans: [{ id: 'old', runId: 'run', title: 'Legacy', selectedVersion: 2, versions: [{ number: 1, content: 'one', createdAt: '2025-01-01' }, { number: 2, content: 'two', createdAt: '2025-01-02' }] }] };
  const migrated = store.migrateStatePlans(state);
  assert.equal(migrated.migrated, true);
  assert.deepEqual(migrated.state.plans, []);
  assert.equal(store.list()[0].selectedVersion, 2);
  assert.equal(store.migrateStatePlans(state).migrated, false);
});

test('derives titles and produces semantic line additions and removals', () => {
  assert.equal(derivePlanTitle('intro\n## Ship the router\nbody', '/repo/bdfl'), 'Ship the router');
  assert.deepEqual(diffLines('keep\nold', 'keep\nnew'), [
    { type: 'context', text: 'keep' }, { type: 'addition', text: 'new' }, { type: 'removal', text: 'old' }
  ]);
});
