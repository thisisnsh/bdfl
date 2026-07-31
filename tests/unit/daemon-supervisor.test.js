'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DaemonSupervisor } = require('../../src/daemon/supervisor');
const { PROTOCOL_VERSION, SURFACE_SNAPSHOT_VERSION } = require('../../src/daemon/protocol');

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

test('opening a session from navigation always focuses its pane', async () => {
  const value = Object.create(DaemonSupervisor.prototype);
  const calls = [];
  value.sessions = {
    open(id, options) {
      calls.push(['open', id, options]);
      return { id };
    },
    focus(id) {
      calls.push(['focus', id]);
    }
  };
  assert.deepEqual(await value.handle({ action: 'open', params: { sessionId: 'worker-2' } }), { id: 'worker-2' });
  assert.deepEqual(calls, [
    ['open', 'worker-2', { lifecycleOwner: 'user' }],
    ['focus', 'worker-2']
  ]);
});

test('global relative focus follows durable session and agent order', () => {
  const value = Object.create(DaemonSupervisor.prototype);
  const focused = [];
  value.store = {
    load: () => ({
      workstreams: [{ id: 'first' }, { id: 'second' }],
      sessions: [
        { id: 'a', workstreamId: 'first', paneNumber: 1 },
        { id: 'b', workstreamId: 'first', paneNumber: 2 },
        { id: 'c', workstreamId: 'second', paneNumber: 1 }
      ]
    })
  };
  value.tmux = {
    panes: () => [
      { sessionId: 'a', dead: '0' },
      { sessionId: 'b', dead: '0' },
      { sessionId: 'c', dead: '0' }
    ],
    activePane: () => ({ sessionId: 'b' })
  };
  value.sessions = { focus: (id) => focused.push(id) };
  value.refreshLabels = () => {};
  assert.equal(value.focusRelative('next').id, 'c');
  assert.equal(value.focusRelative('previous').id, 'a');
  assert.deepEqual(focused, ['c', 'a']);
});

test('pausing an active agent chooses an open sibling before another session', () => {
  const value = Object.create(DaemonSupervisor.prototype);
  const calls = [];
  value.tmux = { activePane: () => ({ sessionId: 'worker' }) };
  value.orderedOpenSessions = () => [
    { id: 'planning', workstreamId: 'one' },
    { id: 'worker', workstreamId: 'one' },
    { id: 'other', workstreamId: 'two' }
  ];
  value.sessions = {
    pause: (id) => (calls.push(['pause', id]), { id }),
    focus: (id) => calls.push(['focus', id])
  };
  value.admitWaiting = () => {};
  value.refreshLabels = () => {};
  assert.deepEqual(value.pauseActive(), { id: 'worker' });
  assert.deepEqual(calls, [
    ['pause', 'worker'],
    ['focus', 'planning']
  ]);
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

test('workflow snapshots are versioned and preserve durable session identities', () => {
  const value = Object.create(DaemonSupervisor.prototype);
  value.store = {
    load: () => ({
      workstreams: [{ id: 'stream', name: 'Build it', status: 'open', createdAt: '2026-01-01' }],
      sessions: [
        {
          id: 'agent',
          workstreamId: 'stream',
          name: 'Worker 1',
          role: 'worker',
          paneNumber: 2,
          taskSnippet: 'Implement durable snapshots',
          turnState: 'working'
        }
      ]
    })
  };
  value.tmux = { activePane: () => ({ sessionId: 'agent' }) };
  value.sessions = { isOpen: (id) => id === 'agent' };
  const snapshot = value.surfaceSnapshot('Sessions');
  assert.equal(snapshot.protocolVersion, PROTOCOL_VERSION);
  assert.equal(snapshot.snapshotVersion, SURFACE_SNAPSHOT_VERSION);
  assert.equal(snapshot.activeId, 'agent');
  assert.equal(snapshot.groups[0].agents[0].id, 'agent');
  assert.equal(snapshot.groups[0].agents[0].taskSnippet, 'Implement durable snapshots');
});

test('explicit workflow actions keep mutations behind the supervisor', () => {
  const value = Object.create(DaemonSupervisor.prototype);
  const calls = [];
  value.store = {
    load: () => ({ sessions: [{ id: 'planning', workstreamId: 'stream', role: 'delegator' }] }),
    renameWorkstream: (id, name) => calls.push(['rename-session', id, name])
  };
  value.sessions = {
    isOpen: () => false,
    open: (id, options) => calls.push(['open', id, options]),
    focus: (id) => calls.push(['focus', id])
  };
  value.lineages = {
    rename: (id, name) => calls.push(['rename-plan', id, name]),
    readManifest: () => ({ approvals: {}, chunks: [{ id: 'chunk', sha: 'sha' }] }),
    approve: (id, version, section) => calls.push(['approve', id, version, section])
  };
  value.controller = {
    scheduler: { accept: (executionId, itemId) => calls.push(['accept', executionId, itemId]) }
  };
  value.sessionAction({ name: 'resume', id: 'planning' });
  value.sessionAction({ name: 'rename', id: 'stream', value: 'Renamed' });
  value.planAction({ name: 'rename', id: 'plan', value: 'Plan name' });
  value.planAction({ name: 'toggle-approval', id: 'plan', version: 1, sectionId: 'chunk' });
  value.reviewAction({ name: 'accept', executionId: 'execution', itemId: 'chunk' });
  assert.deepEqual(calls, [
    ['open', 'planning', { lifecycleOwner: 'user' }],
    ['focus', 'planning'],
    ['rename-session', 'stream', 'Renamed'],
    ['rename-plan', 'plan', 'Plan name'],
    ['approve', 'plan', 1, 'chunk'],
    ['accept', 'execution', 'chunk']
  ]);
});

test('ping advertises the private protocol version', async () => {
  const value = Object.create(DaemonSupervisor.prototype);
  assert.equal((await value.handle({ action: 'ping' })).protocolVersion, PROTOCOL_VERSION);
});
