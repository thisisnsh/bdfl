'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SessionManager } = require('../../src/sessions/manager');
const { WorkspaceStore } = require('../../src/state/workspace');
const { FakeTmux } = require('../helpers/fake-tmux');

test('materializes a mode-0600 capability while provider launch data stays in the tmux descriptor boundary', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bdfl-tmux-bridge-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const profile = { provider: 'codex', model: 'gpt-test', effort: 'medium' };
  const store = new WorkspaceStore(root);
  const stream = store.createWorkstream({
    version: 1,
    delegatorProfile: profile,
    workerProfile: { ...profile, permissionMode: 'workspace-write' },
    workerCapacity: 1
  });
  const session = store.createSession(stream.id, 'delegator', profile);
  const tmux = new FakeTmux();
  const bridge = {
    issue(scope) {
      return { endpoint: '/tmp/bridge.sock', token: 'secret', scope };
    }
  };
  const manager = new SessionManager(root, store, { tmux, bridge, requireBridge: true });
  manager.open(session.id);
  const capability = path.join(root, '.bdfl', 'sessions', session.id, 'capability.json');
  assert.equal(fs.statSync(capability).mode & 0o777, 0o600);
  assert.match(tmux.launches[0].invocation.args.join(' '), /bdfl/);
});

test('direct agents resume without creating BDFL capability or plugin artifacts', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bdfl-direct-resume-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const profile = { provider: 'claude', model: 'default', effort: 'medium', permissionMode: 'workspace-write' };
  const store = new WorkspaceStore(root);
  const stream = store.createWorkstream({ version: 1, sessionType: 'direct', directProfile: profile });
  const session = store.createSession(stream.id, 'direct', profile, {
    providerSessionId: 'same-conversation',
    providerSessionReady: true,
    status: 'completed'
  });
  const tmux = new FakeTmux();
  const manager = new SessionManager(root, store, { tmux, bridge: { issue: () => assert.fail('bridge used') } });
  manager.open(session.id);
  assert.ok(tmux.launches[0].invocation.args.includes('same-conversation'));
  assert.equal(fs.existsSync(path.join(root, '.bdfl', 'sessions', session.id, 'capability.json')), false);
});
