'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { initialState } = require('../../src/state/store');
const { BdflMcpServer, canonicalProjectRoot, ensureGitExclude, pageText } = require('../../src/mcp/server');

class Store {
  constructor(state = initialState()) { this.state = state; }
  load() { return structuredClone(this.state); }
  update(mutator) { this.state = mutator(structuredClone(this.state)); return this.load(); }
}

function fixture(state = initialState(), { elicitation = true, attention = [] } = {}) {
  const messages = [];
  const settings = {
    version: 2,
    defaultModel: 'claude:sonnet:medium',
    models: ['claude:sonnet:medium', 'claude:opus:medium', 'claude:haiku:medium', 'codex:gpt-5.6-sol:medium', 'ollama:qwen3.5:medium'],
    discoveredModels: ['claude:sonnet:medium', 'claude:opus:medium', 'claude:haiku:medium', 'codex:gpt-5.6-sol:medium'],
    customModels: ['ollama:qwen3.5:medium'],
    modelCatalog: [
      { provider: 'claude', model: 'sonnet', efforts: ['medium'], defaultEffort: 'medium' },
      { provider: 'claude', model: 'opus', efforts: ['medium'], defaultEffort: 'medium' },
      { provider: 'claude', model: 'haiku', efforts: ['medium'], defaultEffort: 'medium' },
      { provider: 'codex', model: 'gpt-5.6-sol', efforts: ['medium'], defaultEffort: 'medium' }
    ],
    maxAgents: 4,
    ollamaBaseUrl: 'http://localhost:11434'
  };
  let persisted = settings;
  const store = new Store(state);
  const planRows = [];
  const planBodies = new Map();
  const plans = {
    list: () => structuredClone(planRows),
    select: (id, number) => { planRows.find((plan) => plan.id === id).selectedVersion = number; },
    content: (id, number) => planBodies.get(`${id}:${number}`),
    add: (plan, bodies) => {
      planRows.push(structuredClone(plan));
      bodies.forEach((body, index) => planBodies.set(`${plan.id}:${index + 1}`, body));
    }
  };
  const calls = [];
  const coordinator = {
    broker: { attention: () => structuredClone(attention) },
    activeRun: () => ({ id: 'run-1' }),
    waitForAttention: async () => structuredClone(attention),
    recoverStaleProcesses: () => calls.push('recover'),
    approveTask: (id) => calls.push(['approve', id]),
    answerEvent: (id, answer) => calls.push(['answer', id, answer]),
    declineTask: (id, feedback) => calls.push(['decline', id, feedback]),
    reviewTask: (id) => ({ taskId: id, title: 'Review task', fileList: ['src/a.js'], diffstat: '1 file changed', patch: 'line 1\nline 2' }),
    cancelTask: (id) => calls.push(['cancel', id]),
    dispatch: (args) => { calls.push(['dispatch', args]); return { runId: 'run-1', tasks: [], waves: [] }; }
  };
  const server = new BdflMcpServer({
    output: { write: (line) => messages.push(JSON.parse(line)) },
    settingsLoader: () => structuredClone(persisted),
    settingsSaver: (value) => { persisted = structuredClone(value); return structuredClone(value); },
    rootResolver: () => '/repo',
    gitExcluder: () => {},
    storeFactory: () => store,
    planStoreFactory: () => plans,
    coordinatorFactory: () => coordinator,
    id: () => 'fixed-id',
    now: () => new Date('2026-01-01T00:00:00.000Z')
  });
  return { messages, server, settings: () => persisted, store, plans, calls, elicitation };
}

async function initialize(fix) {
  await fix.server.handleMessage({
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-11-25', capabilities: fix.elicitation ? { elicitation: { form: {} } } : {} }
  });
}

async function answerLatest(fix, selection) {
  await new Promise((resolve) => setImmediate(resolve));
  const request = [...fix.messages].reverse().find((message) => message.method === 'elicitation/create' && fix.server.pending.has(message.id));
  assert.ok(request, `expected elicitation for ${selection}`);
  await fix.server.handleMessage({ jsonrpc: '2.0', id: request.id, result: { action: 'accept', content: { selection } } });
  return request;
}

function call(fix, id, command, extra = {}) {
  return fix.server.handleMessage({
    jsonrpc: '2.0', id, method: 'tools/call',
    params: { name: 'bdfl', arguments: { projectRoot: '/repo', command, ...extra } }
  });
}

test('advertises only the compact management, dispatch, and continue tools', async () => {
  const fix = fixture();
  await initialize(fix);
  await fix.server.handleMessage({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  assert.deepEqual(fix.messages.at(-1).result.tools.map((tool) => tool.name), ['bdfl', 'dispatch', 'continue']);
  assert.ok(fix.messages[0].result.instructions.length < 512);
});

test('continue renders simultaneous native decisions and keeps viewed reviews open', async () => {
  const attention = [
    { id: 'q1', type: 'question', taskId: 't1', title: 'API', message: 'Which?', choices: ['v1', 'v2'] },
    { id: 'task:t2', type: 'completion', taskId: 't2', title: 'Tests' }
  ];
  const fix = fixture(initialState(), { attention });
  await initialize(fix);
  const pending = fix.server.handleMessage({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'continue', arguments: { projectRoot: '/repo', runId: 'run-1' } } });
  await new Promise((resolve) => setImmediate(resolve));
  const request = [...fix.messages].reverse().find((message) => message.method === 'elicitation/create');
  assert.deepEqual(request.params.requestedSchema.properties.event_1.enum, ['v1', 'v2']);
  assert.deepEqual(request.params.requestedSchema.properties.event_2.enum, ['View', 'Accept', 'Decline']);
  await fix.server.handleMessage({ jsonrpc: '2.0', id: request.id, result: { action: 'accept', content: { event_1: 'v2', event_2: 'View' } } });
  await pending;
  assert.deepEqual(fix.calls.find((call) => call[0] === 'answer'), ['answer', 'q1', 'v2']);
  const result = fix.messages.find((message) => message.id === 9).result;
  assert.equal(result.structuredContent.reviews[0].taskId, 't2');
  assert.equal(result.structuredContent.events.length, 2);
});

test('model management elicits all configured options without a four-option limit', async () => {
  const fix = fixture();
  await initialize(fix);
  const pending = call(fix, 2, 'models');
  const request = await answerLatest(fix, 'codex:gpt-5.6-sol');
  assert.equal(request.params.requestedSchema.properties.selection.enum.length, 5);
  await answerLatest(fix, 'medium');
  await pending;
  assert.equal(fix.settings().defaultModel, 'codex:gpt-5.6-sol:medium');
});

test('empty plans return the exact empty state and cannot accidentally route to agents', async () => {
  const state = initialState();
  state.agents.push({ id: 'agent-1', title: 'Unrelated agent', status: 'waiting' });
  const fix = fixture(state);
  await initialize(fix);
  await call(fix, 2, 'plans');
  const result = fix.messages.find((message) => message.id === 2).result;
  assert.equal(result.content[0].text, 'No plans.');
  assert.deepEqual(result.structuredContent, { plans: [] });
  assert.equal(fix.messages.some((message) => message.method === 'elicitation/create'), false);
});

test('selects and approves a filesystem-backed plan version', async () => {
  const state = initialState();
  state.runs.push({ id: 'run-1', title: 'repo', status: 'pending' });
  const fix = fixture(state);
  await initialize(fix);
  fix.plans.add({ id: 'plan-1', title: 'Ship router', selectedVersion: null, versions: [
    { number: 1, createdAt: '2026-01-01T00:00:00.000Z' },
    { number: 2, createdAt: '2026-01-01T00:00:00.000Z' }
  ] }, ['# Ship router\n\nVersion one.', '# Ship router\n\nVersion two.']);

  const pending = call(fix, 5, 'plans');
  await answerLatest(fix, 'Ship router — 2 version(s)');
  await answerLatest(fix, 'v2 — 2026-01-01T00:00:00.000Z');
  await answerLatest(fix, 'Approve');
  await pending;
  assert.equal(fix.plans.list()[0].selectedVersion, 2);
});

test('task and agent selectors use readable task titles while prompts remain opt-in', async () => {
  const state = initialState();
  state.tasks.push({ id: 'task-internal', title: 'Implement API', prompt: 'secret exact prompt', status: 'running' });
  state.agents.push({ id: 'agent-internal', taskId: 'task-internal', status: 'running' });
  const fix = fixture(state, { elicitation: false });
  await initialize(fix);
  await call(fix, 2, 'tasks');
  await call(fix, 3, 'agents');
  const tasks = fix.messages.find((message) => message.id === 2).result;
  const agents = fix.messages.find((message) => message.id === 3).result;
  assert.equal(tasks.structuredContent.tasks[0].title, 'Implement API');
  assert.deepEqual(agents.structuredContent.agents, ['Implement API — running']);
  assert.doesNotMatch(JSON.stringify(tasks.structuredContent), /secret exact prompt/);
});

test('startup recovery presents guided choices and preserves artifacts when cancelling', async () => {
  const state = initialState();
  state.runs.push({ id: 'run-1', status: 'running' });
  state.tasks.push({ id: 'task-1', title: 'Task', status: 'running', prompt: 'keep me' });
  state.agents.push({ id: 'agent-1', taskId: 'task-1', status: 'running', worktree: '/kept' });
  const fix = fixture(state);
  await initialize(fix);
  const pending = call(fix, 2, 'on');
  const request = await answerLatest(fix, 'Cancel run');
  assert.deepEqual(request.params.requestedSchema.properties.selection.enum, ['Continue', 'Manage tasks', 'Archive run', 'Cancel run']);
  await pending;
  assert.equal(fix.store.load().tasks[0].prompt, 'keep me');
  assert.equal(fix.store.load().agents[0].worktree, '/kept');
  assert.equal(fix.store.load().runs[0].status, 'cancelled');
});

test('canonical roots reject non-absolute paths and pagination is bounded', () => {
  assert.throws(() => canonicalProjectRoot('relative'), /absolute/);
  assert.equal(canonicalProjectRoot('/repo/subdir', () => '/repo\n', { realpathSync: (value) => value }), '/repo');
  assert.deepEqual(pageText('a\nb\nc', 2, 1), { text: 'a\nb\nc', page: 1, pages: 1, pageSize: 10 });
});

test('activation exclusion adds .bdfl once to Git local metadata', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bdfl-git-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q', root]);
  ensureGitExclude(root);
  ensureGitExclude(root);
  const exclude = fs.readFileSync(path.join(root, '.git', 'info', 'exclude'), 'utf8');
  assert.equal(exclude.split('\n').filter((line) => line === '.bdfl/').length, 1);
});
