'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SessionManager } = require('../../src/sessions/manager');
const { WorkspaceStore } = require('../../src/state/workspace');

test('session manager translates one dangerous supervisor option for every provider', (t) => {
  for (const provider of ['claude', 'codex', 'ollama']) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `bdfl-dangerous-${provider}-`));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const model = provider === 'claude' ? 'default' : provider === 'ollama' ? 'qwen3:4b' : 'gpt-test';
    const profile = { provider, model, effort: 'medium' };
    const store = new WorkspaceStore(root);
    const stream = store.createWorkstream({ version: 1, delegatorProfile: profile, workerProfile: { ...profile, permissionMode: 'workspace-write' }, workerCapacity: 1 });
    const session = store.createSession(stream.id, 'delegator', profile);
    let launch;
    const manager = new SessionManager(root, store, { dangerous: true, pty: { spawn(command, args) { launch = { command, args }; return { pid: 1, onData() {}, onExit() {}, kill() {} }; } }, codexSessions: path.join(root, 'missing') });
    manager.captureCodexSession = () => {};
    manager.open(session.id);
    const expected = provider === 'claude' ? '--dangerously-skip-permissions' : '--dangerously-bypass-approvals-and-sandbox';
    assert.ok(launch.args.includes(expected), `${provider} launch should include ${expected}`);
    manager.shutdown();
  }
});
