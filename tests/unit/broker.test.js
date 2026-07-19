'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { initialState } = require('../../src/state/store');
const { EventBroker } = require('../../src/broker/events');

class MemoryStore {
  constructor(state) { this.state = state; }
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

