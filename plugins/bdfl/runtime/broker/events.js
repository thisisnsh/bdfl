'use strict';

const crypto = require('node:crypto');

function timestamp(now) { return (now || new Date()).toISOString(); }

class EventBroker {
  constructor(store, { id = () => crypto.randomUUID(), now = () => new Date() } = {}) {
    this.store = store;
    this.id = id;
    this.now = now;
  }

  publish(agentId, event) {
    const record = { id: this.id(), agentId, createdAt: timestamp(this.now()), ...event };
    this.store.update((state) => {
      state.events.push(record);
      const agent = state.agents.find((item) => item.id === agentId);
      if (event.type === 'session' && agent) agent.sessionId = event.sessionId;
      if (['question', 'permission'].includes(event.type)) {
        if (agent) agent.status = 'waiting';
        state.inbox.push({
          id: this.id(),
          agentId,
          eventId: record.id,
          kind: event.type,
          status: 'open',
          createdAt: record.createdAt,
          payload: event.question || event.request
        });
      }
      if (event.type === 'completion' && agent) agent.status = 'review';
      if (event.type === 'error' && agent) { agent.status = 'failed'; agent.exitState = event.message; }
      return state;
    });
    return record;
  }

  answer(inboxId, answer) {
    if (answer === undefined || answer === null || answer === '') throw new Error('An explicit inbox answer is required');
    return this.store.update((state) => {
      const item = state.inbox.find((candidate) => candidate.id === inboxId);
      if (!item || item.status !== 'open') throw new Error(`Open inbox item not found: ${inboxId}`);
      item.status = 'answered';
      item.answer = answer;
      item.resolvedAt = timestamp(this.now());
      const agent = state.agents.find((candidate) => candidate.id === item.agentId);
      if (agent) agent.status = 'running';
      return state;
    });
  }

  cancel(agentId, reason = 'Stopped by user') {
    return this.store.update((state) => {
      const agent = state.agents.find((candidate) => candidate.id === agentId);
      if (!agent) throw new Error(`Agent not found: ${agentId}`);
      agent.status = 'cancelled';
      agent.exitState = reason;
      agent.stoppedAt = timestamp(this.now());
      return state;
    });
  }
}

module.exports = { EventBroker };

