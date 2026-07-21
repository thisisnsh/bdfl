'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { initialState } = require('../../src/state/store');
const { EventBroker } = require('../../src/broker/events');

class MemoryStore {
  constructor(state) { this.state = state; }
  load() { return structuredClone(this.state); }
  update(fn) { this.state = fn(structuredClone(this.state)); return this.state; }
}

test('questions and permissions suspend agents until explicit answers', () => {
  const state = initialState();
  state.agents.push({ id: 'a1', status: 'running' });
  const store = new MemoryStore(state);
  let number = 0;
  const broker = new EventBroker(store, { id: () => `id-${++number}`, now: () => new Date('2026-01-01T00:00:00Z') });
  broker.publish('a1', { type: 'question', question: 'Choose API?' });
  assert.equal(store.state.agents[0].status, 'waiting');
  assert.equal(store.state.inbox[0].status, 'open');
  assert.throws(() => broker.answer(store.state.inbox[0].id, ''), /explicit/);
  broker.answer(store.state.inbox[0].id, 'Use v2');
  assert.equal(store.state.agents[0].status, 'running');
  assert.equal(store.state.inbox[0].answer, 'Use v2');
});

test('bundles simultaneous questions, permissions, and completions independently', () => {
  const state = initialState();
  state.tasks.push({ id: 't1', runId: 'r1', title: 'API', status: 'running' }, { id: 't2', runId: 'r1', title: 'Tests', status: 'running' });
  state.agents.push({ id: 'a1', runId: 'r1', taskId: 't1', status: 'running' }, { id: 'a2', runId: 'r1', taskId: 't2', status: 'running' });
  const store = new MemoryStore(state);
  let id = 0;
  const broker = new EventBroker(store, { id: () => `e${++id}` });
  broker.publish('a1', { type: 'question', question: { message: 'Which API?', choices: ['v1', 'v2'] } });
  broker.publish('a2', { type: 'permission', request: { message: 'Run tests?' } });
  store.state.tasks[1].status = 'review';
  const events = broker.attention('r1');
  assert.deepEqual(events.map((event) => event.type), ['question', 'permission', 'completion']);
  assert.deepEqual(events[0].choices, ['v1', 'v2']);
  assert.equal(store.state.agents[0].status, 'waiting');
  assert.equal(store.state.agents[1].status, 'waiting');
});

test('wait resolves as soon as any agent reaches an attention state', async () => {
  const state = initialState();
  state.tasks.push({ id: 't1', runId: 'r1', title: 'API', status: 'running' });
  state.agents.push({ id: 'a1', runId: 'r1', taskId: 't1', status: 'running' });
  const store = new MemoryStore(state);
  const broker = new EventBroker(store, { id: () => 'event' });
  const waiting = broker.waitForAttention('r1');
  broker.publish('a1', { type: 'question', question: 'Which?' });
  assert.equal((await waiting)[0].message, 'Which?');
});

test('cancellation and crashes retain explicit exit state', () => {
  const state = initialState();
  state.agents.push({ id: 'a1', status: 'running' });
  const store = new MemoryStore(state);
  const broker = new EventBroker(store, { id: () => 'event', now: () => new Date('2026-01-01T00:00:00Z') });
  broker.publish('a1', { type: 'error', message: 'provider exited 9' });
  assert.equal(store.state.agents[0].status, 'failed');
  assert.equal(store.state.agents[0].exitState, 'provider exited 9');
  store.state.agents[0].status = 'running';
  broker.cancel('a1');
  assert.equal(store.state.agents[0].status, 'cancelled');
});
