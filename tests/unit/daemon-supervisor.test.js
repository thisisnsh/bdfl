'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DaemonSupervisor } = require('../../src/daemon/supervisor');

function daemon(state, executions = []) {
  const closed = [];
  const deleted = [];
  const value = Object.create(DaemonSupervisor.prototype);
  value.store = {
    load: () => state,
    deleteWorkstream(id) {
      deleted.push(['workstream', id]);
    }
  };
  value.sessions = {
    isOpen: () => true,
    close(id) {
      closed.push(id);
    },
    delete(id) {
      deleted.push(['session', id]);
    }
  };
  value.controller = { scheduler: { list: () => executions } };
  return { daemon: value, closed, deleted };
}

test('scoped session deletion cascades only for a primary or explicit session request', () => {
  const state = {
    sessions: [
      { id: 'planning', workstreamId: 'stream', role: 'delegator' },
      { id: 'worker', workstreamId: 'stream', role: 'worker' }
    ]
  };
  let value = daemon(state);
  value.daemon.deleteSession('worker', false);
  assert.deepEqual(value.deleted, [['session', 'worker']]);
  assert.deepEqual(value.closed, []);
  value = daemon(state);
  value.daemon.deleteSession('planning', false);
  assert.deepEqual(value.closed, ['planning', 'worker']);
  assert.deepEqual(value.deleted, [['workstream', 'stream']]);
});

test('session deletion is blocked when its execution remains active', () => {
  const state = { sessions: [{ id: 'worker', workstreamId: 'stream', role: 'worker' }] };
  const { daemon: value } = daemon(state, [{ id: 'execution', workstreamId: 'stream', status: 'running' }]);
  assert.throws(
    () => value.deleteSession('worker'),
    (error) => error.code === 'ACTIVE_EXECUTION'
  );
});

test('plan deletion scopes uppercase deletion to the selected planning session', () => {
  const value = Object.create(DaemonSupervisor.prototype);
  const removed = [];
  value.store = { load: () => ({}) };
  value.controller = { scheduler: { list: () => [] } };
  value.lineages = {
    find: () => ({ lineage: { planId: 'one', originSessionId: 'planning-a' } }),
    list: () => [
      { planId: 'one', originSessionId: 'planning-a' },
      { planId: 'two', originSessionId: 'planning-a' },
      { planId: 'other', originSessionId: 'planning-b' }
    ],
    delete(id) {
      removed.push(id);
    }
  };
  value.deletePlan('one', true);
  assert.deepEqual(removed, ['one', 'two']);
});

test('a safe reconnect clears dangerous mode and restarts live providers with their saved identities', async () => {
  const value = Object.create(DaemonSupervisor.prototype);
  const restarted = [];
  value.store = { load: () => ({ sessions: [{ id: 'agent' }] }) };
  value.sessions = {
    dangerous: true,
    isOpen: () => true,
    restart(id) {
      restarted.push(id);
    }
  };
  value.controller = { dangerous: true };
  assert.deepEqual(await value.handle({ action: 'configure', params: { dangerous: false } }), {
    dangerous: false
  });
  assert.equal(value.controller.dangerous, false);
  assert.deepEqual(restarted, ['agent']);
});

test('review range recording writes one durable mode-0600 excerpt', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bdfl-review-excerpt-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const value = Object.create(DaemonSupervisor.prototype);
  value.root = root;
  value.io = fs;
  assert.equal(value.recordReviewExcerpt({ id: 'execution:chunk', start: 1, end: 2, lines: ['- old', '+ new'] }), true);
  const file = path.join(root, '.bdfl', 'review-excerpts.ndjson');
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), {
    reviewId: 'execution:chunk',
    start: 1,
    end: 2,
    text: '- old\n+ new',
    createdAt: JSON.parse(fs.readFileSync(file, 'utf8')).createdAt
  });
});
