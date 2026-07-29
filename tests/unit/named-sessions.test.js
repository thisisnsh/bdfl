'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { WorkspaceStore, defaultWorkspace, normalizeTaskSnippet } = require('../../src/state/workspace');
const { SessionManager, substantivePlanningPrompt } = require('../../src/sessions/manager');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bdfl-named-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let number = 0;
  const store = new WorkspaceStore(root, { id: () => `${++number}`, now: () => new Date('2026-01-01T00:00:00.000Z') });
  const config = {
    version: 1,
    sessionType: 'planning',
    delegatorProfile: { provider: 'claude', model: 'opus', effort: 'high' },
    workerProfile: { provider: 'codex', model: 'gpt-5', effort: 'medium', permissionMode: 'workspace-write' },
    workerCapacity: 5
  };
  return { root, store, config };
}

test('uses schema 2 for workspace and saved configuration and rejects development schema 1 state', (t) => {
  const { root, store, config } = fixture(t);
  assert.equal(defaultWorkspace().schema, 2);
  store.createWorkstream(config);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, '.bdfl/config.json'))).schema, 2);
  const oldWorkspace = { schema: 1, workstreams: [], sessions: [] };
  fs.writeFileSync(path.join(root, '.bdfl/workspace.json'), JSON.stringify(oldWorkspace));
  assert.throws(
    () => store.load(),
    (error) => error.code === 'RESET_REQUIRED' && /remove this repository's \.bdfl/.test(error.message)
  );
  fs.writeFileSync(path.join(root, '.bdfl/workspace.json'), JSON.stringify(defaultWorkspace()));
  fs.writeFileSync(path.join(root, '.bdfl/config.json'), JSON.stringify({ schema: 1 }));
  assert.throws(
    () => store.loadConfig(),
    (error) => error.code === 'RESET_REQUIRED'
  );
});
test('assigns provider-local planning names and non-recycled worker names', (t) => {
  const { store, config } = fixture(t);
  const first = store.createWorkstream(config);
  const second = store.createWorkstream(config);
  const planningOne = store.createSession(first.id, 'delegator', config.delegatorProfile);
  const planningTwo = store.createSession(second.id, 'delegator', config.delegatorProfile);
  const workerOne = store.createSession(first.id, 'worker', config.workerProfile);
  const workerTwo = store.createSession(first.id, 'worker', config.workerProfile);
  store.deleteSession(workerTwo.id);
  store.closeWorkstream(first.id);
  store.reopenWorkstream(first.id);
  const workerThree = store.createSession(first.id, 'worker', config.workerProfile);
  assert.deepEqual([planningOne.name, planningTwo.name], ['Claude 1', 'Claude 2']);
  assert.deepEqual([workerOne.name, workerThree.name], ['Worker 1', 'Worker 3']);
  assert.deepEqual([workerOne.roleSequence, workerThree.roleSequence], [1, 3]);
});
test('migrates only collision-free exact legacy worker defaults', (t) => {
  const { root, store, config } = fixture(t);
  const stream = store.createWorkstream(config);
  const exact = store.createSession(stream.id, 'worker', config.workerProfile);
  const customLegacyLike = store.createSession(stream.id, 'worker', config.workerProfile, { name: 'W 99' });
  const collidingLegacy = store.createSession(stream.id, 'worker', config.workerProfile, { name: 'Temporary' });
  store.createSession(stream.id, 'worker', config.workerProfile, { name: 'Worker 3' });
  const file = path.join(root, '.bdfl', 'workspace.json');
  const state = JSON.parse(fs.readFileSync(file, 'utf8'));
  state.sessions.find((item) => item.id === exact.id).name = 'W 1';
  state.sessions.find((item) => item.id === collidingLegacy.id).name = 'W 3';
  fs.writeFileSync(file, JSON.stringify(state));
  const names = store.load().sessions.map((session) => session.name);
  assert.deepEqual(names, ['Worker 1', customLegacyLike.name, 'W 3', 'Worker 3']);
});
test('renames workstreams while agent names remain immutable', (t) => {
  const { store, config } = fixture(t);
  const first = store.createWorkstream(config);
  const second = store.createWorkstream(config);
  const planning = store.createSession(first.id, 'delegator', config.delegatorProfile);
  assert.equal(first.name, planning.name);
  assert.equal(store.renameWorkstream(first.id, 'Release train').name, 'Release train');
  assert.throws(() => store.renameWorkstream(second.id, 'release train'), /unique/);
  for (const invalid of ['', ' leading', 'trailing ', 'bad\nname', '1234567890123456789012345'])
    assert.throws(() => store.renameWorkstream(second.id, invalid), /1–24 printable/);
  assert.equal(store.load().sessions.find((session) => session.id === planning.id).name, 'Claude 1');
});
test('uses a legacy custom primary agent name as the missing workstream-name fallback', (t) => {
  const { root, store, config } = fixture(t);
  const stream = store.createWorkstream(config);
  const planning = store.createSession(stream.id, 'delegator', config.delegatorProfile);
  const file = path.join(root, '.bdfl', 'workspace.json');
  const state = JSON.parse(fs.readFileSync(file, 'utf8'));
  delete state.workstreams[0].name;
  state.sessions.find((session) => session.id === planning.id).name = 'Legacy planning';
  fs.writeFileSync(file, JSON.stringify(state));
  assert.equal(store.load().workstreams[0].name, 'Legacy planning');
});
test('persists independent agent turn state with an optional reason', (t) => {
  const { store, config } = fixture(t);
  const stream = store.createWorkstream(config);
  const session = store.createSession(stream.id, 'delegator', config.delegatorProfile);
  store.setSessionTurnState(session.id, 'idle', 'plan published');
  let saved = store.load().sessions[0];
  assert.equal(saved.turnState, 'idle');
  assert.equal(saved.turnStateReason, 'plan published');
  store.setSessionTurnState(session.id, 'working');
  saved = store.load().sessions[0];
  assert.equal(saved.turnState, 'working');
  assert.equal(saved.turnStateReason, undefined);
  assert.throws(() => store.setSessionTurnState(session.id, 'done'), /working or idle/);
});
test('normalizes snippets to one printable 200-character line and persists metadata through close and reopen', (t) => {
  const { store, config } = fixture(t);
  const stream = store.createWorkstream(config);
  const planning = store.createSession(stream.id, 'delegator', config.delegatorProfile);
  const raw = `  Build\n\t the\u001b rail ${'x'.repeat(250)}  `;
  const updated = store.setSessionTaskSnippet(planning.id, raw);
  assert.equal(updated.taskSnippet, normalizeTaskSnippet(raw));
  assert.equal([...updated.taskSnippet].length, 200);
  store.setSessionAttention(planning.id, true);
  store.closeWorkstream(stream.id);
  store.reopenWorkstream(stream.id);
  const restored = store.load().sessions[0];
  assert.equal(restored.name, 'Claude 1');
  assert.equal(restored.taskSnippet, updated.taskSnippet);
  assert.equal(restored.roleSequence, 1);
  assert.equal(restored.attention, true);
});
test('repairs a legacy prompt truncated on whitespace without resetting durable state', (t) => {
  const { root, store, config } = fixture(t);
  const stream = store.createWorkstream(config);
  const session = store.createSession(stream.id, 'delegator', config.delegatorProfile);
  const file = path.join(root, '.bdfl', 'workspace.json');
  const state = JSON.parse(fs.readFileSync(file, 'utf8'));
  state.sessions.find((item) => item.id === session.id).taskSnippet = `${'x'.repeat(199)} `;
  fs.writeFileSync(file, JSON.stringify(state));
  const restored = store.load().sessions[0];
  assert.equal(restored.taskSnippet, 'x'.repeat(199));
  assert.equal(restored.sessionType, 'planning');
});
test('reports invalid current-schema records without telling users to delete durable state', (t) => {
  const { root, store } = fixture(t);
  const file = path.join(root, '.bdfl', 'workspace.json');
  const state = defaultWorkspace();
  state.sessions.push({ id: 'broken', name: '', roleSequence: 1, taskSnippet: null, sessionType: 'planning' });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(state));
  assert.throws(
    () => store.load(),
    (error) =>
      error.code === 'STATE_INVALID' && /was not changed/.test(error.message) && !/remove.*\.bdfl/i.test(error.message)
  );
});
test('captures only substantive submitted planning prompts', (t) => {
  const { root, store, config } = fixture(t);
  const stream = store.createWorkstream(config);
  const session = store.createSession(stream.id, 'delegator', config.delegatorProfile);
  const writes = [];
  const child = {
    pid: 1,
    onData() {},
    onExit() {},
    write(value) {
      writes.push(value);
    },
    kill() {}
  };
  const manager = new SessionManager(root, store, {
    pty: {
      spawn() {
        return child;
      }
    }
  });
  manager.open(session.id);
  manager.write(session.id, 'Please build');
  manager.write(session.id, ' the named rail\r');
  assert.equal(store.load().sessions[0].taskSnippet, 'Please build the named rail');
  for (const ignored of ['yes\r', '/help\r', '\u0007\r', '   \r']) manager.write(session.id, ignored);
  assert.equal(store.load().sessions[0].taskSnippet, 'Please build the named rail');
  assert.equal(substantivePlanningPrompt('okay'), null);
  assert.equal(substantivePlanningPrompt('Explain okay handling'), 'Explain okay handling');
  assert.equal(writes.join(''), 'Please build the named rail\ryes\r/help\r\u0007\r   \r');
  manager.shutdown();
});
test('captures edited planning prompts without recording word-navigation keys', (t) => {
  const { root, store, config } = fixture(t);
  const stream = store.createWorkstream(config);
  const session = store.createSession(stream.id, 'delegator', config.delegatorProfile);
  const writes = [];
  const child = {
    pid: 1,
    onData() {},
    onExit() {},
    write(value) {
      writes.push(value);
    },
    kill() {}
  };
  const manager = new SessionManager(root, store, {
    pty: {
      spawn() {
        return child;
      }
    }
  });
  manager.open(session.id);
  for (const input of ['Build python script', '\u001bb', '\u001bb', 'bash & ', '\u001bf', ' and', '\r'])
    manager.write(session.id, input);
  assert.equal(store.load().sessions[0].taskSnippet, 'Build bash & python and script');
  assert.equal(writes.join(''), 'Build python script\u001bb\u001bbbash & \u001bf and\r');
  manager.shutdown();
});
test('bulk deletion clears workstream records and numbering while preserving configuration and other durable data', (t) => {
  const { root, store, config } = fixture(t);
  const first = store.createWorkstream(config);
  store.createSession(first.id, 'delegator', config.delegatorProfile);
  const second = store.createWorkstream(config);
  store.createSession(second.id, 'worker', config.workerProfile);
  fs.writeFileSync(path.join(root, '.bdfl', 'durable-marker'), 'keep\n');
  assert.deepEqual(store.deleteAllWorkstreams(), { workstreams: 2, sessions: 2 });
  assert.deepEqual(store.load(), defaultWorkspace());
  assert.deepEqual(store.loadConfig(), config);
  assert.equal(fs.readFileSync(path.join(root, '.bdfl', 'durable-marker'), 'utf8'), 'keep\n');
  const events = fs
    .readFileSync(path.join(root, '.bdfl', 'events.ndjson'), 'utf8')
    .trim()
    .split('\n')
    .map(JSON.parse);
  assert.deepEqual(
    { ...events.at(-1), id: '<event>' },
    { id: '<event>', type: 'workstreams.deleted', at: '2026-01-01T00:00:00.000Z', workstreams: 2, sessions: 2 }
  );
  assert.deepEqual(store.deleteAllWorkstreams(), { workstreams: 0, sessions: 0 });
});
