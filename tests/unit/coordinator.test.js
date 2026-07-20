'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ProjectCoordinator } = require('../../src/core/coordinator');
const { EventBroker } = require('../../src/broker/events');
const { initialState } = require('../../src/state/store');

class Store {
  constructor(state = initialState()) { this.state = state; }
  load() { return structuredClone(this.state); }
  update(mutator) { this.state = mutator(structuredClone(this.state)); return this.load(); }
}

const settings = {
  defaultModel: 'codex:gpt-5.6-sol:medium',
  models: ['codex:gpt-5.6-sol:medium'],
  maxAgents: 4,
  ollamaBaseUrl: 'http://localhost:11434'
};

function task(key, dependencies = []) {
  return {
    key,
    title: `Readable ${key}`,
    prompt: `Exact provider prompt for ${key}\nwith details`,
    objective: `Objective ${key}`,
    context: 'Context',
    allowedPaths: [key],
    dependencies,
    model: 'codex:gpt-5.6-sol:medium',
    permissionMode: 'default',
    validationCommands: ['node --test'],
    completionCriteria: 'Tests pass'
  };
}

test('dispatch stores readable tasks and sends the exact stored prompt to linked agents', () => {
  const state = initialState();
  state.runs.push({ id: 'run-1', status: 'pending' });
  const store = new Store(state);
  let next = 0;
  const starts = [];
  const coordinator = new ProjectCoordinator('/repo', {
    store,
    settingsLoader: () => settings,
    id: () => `internal-${++next}`,
    now: () => new Date('2026-01-01T00:00:00.000Z'),
    worktrees: { create: (id) => ({ branch: `bdfl/${id}`, worktree: `/worktrees/${id}` }) },
    runner: {
      start: (agent, model, options) => {
        starts.push({ agent, model, options });
        store.update((value) => { value.agents.push({ ...agent, status: 'running' }); return value; });
        return { started: true };
      },
      stop: () => {}
    }
  });
  const result = coordinator.dispatch({ host: 'codex', tasks: [task('src'), task('tests')] });
  assert.equal(result.tasks.length, 2);
  assert.equal(starts.length, 2);
  const saved = store.load();
  for (const start of starts) {
    const savedTask = saved.tasks.find((item) => item.id === start.agent.taskId);
    assert.equal(start.agent.title, savedTask.title);
    assert.equal(start.options.prompt, savedTask.prompt);
    assert.equal(start.options.cwd, savedTask.attempts[0].worktree);
  }
});

test('dependencies wait for explicit review approval before the next wave starts', () => {
  const state = initialState();
  state.runs.push({ id: 'run-1', status: 'pending' });
  const store = new Store(state);
  let next = 0;
  const starts = [];
  const runner = {
    start: (agent) => { starts.push(agent); store.update((value) => { value.agents.push({ ...agent, status: 'running' }); return value; }); return { started: true }; },
    stop: () => {}
  };
  const coordinator = new ProjectCoordinator('/repo', {
    store, settingsLoader: () => settings, id: () => `id-${++next}`,
    worktrees: { create: (id) => ({ branch: `bdfl/${id}`, worktree: `/worktrees/${id}` }) }, runner
  });
  coordinator.dispatch({ host: 'codex', tasks: [task('src'), task('tests', ['src'])] });
  assert.equal(starts.length, 1);
  const first = store.load().tasks.find((item) => item.title === 'Readable src');
  new EventBroker(store, { id: () => 'event-1' }).publish(first.agentId, { type: 'completion', result: {} });
  assert.equal(store.load().tasks.find((item) => item.id === first.id).status, 'review');
  coordinator.approveTask(first.id);
  assert.equal(starts.length, 2);
});

test('stale persisted processes become interrupted without deleting their records', () => {
  const state = initialState();
  state.tasks.push({ id: 'task-1', status: 'running', prompt: 'preserved' });
  state.agents.push({ id: 'agent-1', taskId: 'task-1', status: 'waiting', branch: 'preserved' });
  const store = new Store(state);
  const coordinator = new ProjectCoordinator('/repo', {
    store, settingsLoader: () => settings, worktrees: {}, runner: {}
  });
  coordinator.recoverStaleProcesses();
  assert.equal(store.load().tasks[0].status, 'interrupted');
  assert.equal(store.load().tasks[0].prompt, 'preserved');
  assert.equal(store.load().agents[0].status, 'interrupted');
  assert.equal(store.load().agents[0].branch, 'preserved');
});
