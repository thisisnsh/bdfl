'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SessionManager } = require('../../src/sessions/manager');
const { WorkspaceStore } = require('../../src/state/workspace');
const { FakeTmux } = require('../helpers/fake-tmux');

function fixture(t, width = 120) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bdfl-tmux-session-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const profile = { provider: 'codex', model: 'gpt-test', effort: 'medium', permissionMode: 'workspace-write' };
  const store = new WorkspaceStore(root);
  const stream = store.createWorkstream({
    version: 1,
    sessionType: 'direct',
    directProfile: profile
  });
  const session = store.createSession(stream.id, 'direct', profile);
  const tmux = new FakeTmux(width);
  return { root, store, stream, session, tmux, manager: new SessionManager(root, store, { tmux }) };
}

test('opens a provider in a tmux pane and derives working only from launch and output', (t) => {
  const { manager, session, tmux, store } = fixture(t);
  manager.open(session.id);
  assert.equal(tmux.launches.length, 1);
  assert.equal(store.load().sessions[0].turnState, 'working');
  manager.markIdle(session.id);
  assert.equal(store.load().sessions[0].turnState, 'idle');
  assert.equal(manager.isOpen(session.id), true);
  manager.markOutput(session.id);
  assert.equal(store.load().sessions[0].turnState, 'working');
});

test('snapshots, pauses, and resumes the same provider identity as user-owned', (t) => {
  const { manager, session, tmux, store } = fixture(t);
  store.update((value) => {
    value.sessions[0].providerSessionId = 'conversation-1';
    value.sessions[0].providerSessionReady = true;
    return value;
  });
  manager.open(session.id);
  manager.pause(session.id);
  let saved = store.load().sessions[0];
  assert.equal(saved.status, 'paused');
  assert.equal(saved.lifecycleOwner, 'user');
  assert.ok(tmux.snapshots.has(session.id));
  manager.resume(session.id);
  saved = store.load().sessions[0];
  assert.equal(saved.providerSessionId, 'conversation-1');
  assert.equal(saved.lifecycleOwner, 'user');
  assert.ok(tmux.launches.at(-1).invocation.args.includes('conversation-1'));
});

test('blocks user opens and queues automatic opens when rendered labels exceed the narrowest client', (t) => {
  const { manager, session, tmux, store } = fixture(t, 20);
  assert.equal(manager.open(session.id), null);
  assert.match(tmux.messages[0], /widen/);
  assert.equal(manager.open(session.id, { automatic: true }), null);
  assert.equal(store.load().sessions.find((item) => item.id === session.id).waitingReason, 'Waiting for rail space');
});

test('restoration clears stale working state for a non-running saved agent', (t) => {
  const { manager, session, store } = fixture(t);
  store.update((value) => {
    value.sessions[0].status = 'paused';
    value.sessions[0].explicitlyClosed = true;
    value.sessions[0].turnState = 'working';
    return value;
  });
  manager.restore();
  const saved = store.load().sessions.find((item) => item.id === session.id);
  assert.equal(saved.turnState, 'idle');
  assert.match(saved.turnStateReason, /without a live pane/);
});

test('restoration relaunches durable running agents after a normal tmux shutdown', (t) => {
  const { manager, session, store, tmux } = fixture(t);
  store.update((value) => {
    value.sessions[0].status = 'running';
    value.sessions[0].turnState = 'idle';
    value.sessions[0].providerSessionId = 'durable-conversation';
    value.sessions[0].providerSessionReady = true;
    return value;
  });
  const restored = manager.restore();
  assert.deepEqual([...restored], [session.id]);
  assert.equal(tmux.launches.length, 1);
  assert.ok(tmux.launches[0].invocation.args.includes('durable-conversation'));
});
