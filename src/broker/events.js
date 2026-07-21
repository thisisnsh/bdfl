'use strict';

const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');

function timestamp(now) { return (now || new Date()).toISOString(); }

class EventBroker {
  constructor(store, { id = () => crypto.randomUUID(), now = () => new Date() } = {}) {
    this.store = store;
    this.id = id;
    this.now = now;
    this.emitter = new EventEmitter();
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
      const task = agent?.taskId ? state.tasks.find((item) => item.id === agent.taskId) : null;
      if (event.type === 'completion' && task) task.status = 'review';
      if (event.type === 'error' && task) { task.status = 'failed'; task.exitState = event.message; }
      return state;
    });
    this.emitter.emit('attention');
    return record;
  }

  attention(runId) {
    const state = this.store.load();
    const agents = new Map(state.agents.map((agent) => [agent.id, agent]));
    const tasks = new Map(state.tasks.map((task) => [task.id, task]));
    const events = [];
    for (const item of state.inbox.filter((candidate) => candidate.status === 'open')) {
      const agent = agents.get(item.agentId);
      if (runId && agent?.runId !== runId) continue;
      const task = tasks.get(agent?.taskId);
      const payload = item.payload;
      const message = typeof payload === 'string' ? payload : payload?.message || payload?.question || item.kind;
      const rawChoices = typeof payload === 'object' && payload ? payload.options || payload.choices : null;
      const choices = Array.isArray(rawChoices) ? rawChoices.map((choice) => typeof choice === 'string' ? choice : choice.label || choice.title || choice.value).filter(Boolean) : [];
      events.push({ id: item.id, type: item.kind, agentId: item.agentId, taskId: task?.id, title: task?.title || agent?.title || 'Agent', message, ...(choices.length ? { choices } : {}) });
    }
    for (const task of state.tasks.filter((candidate) => candidate.status === 'review' && (!runId || candidate.runId === runId))) {
      events.push({ id: `task:${task.id}`, type: 'completion', taskId: task.id, agentId: task.agentId, title: task.title, attempt: task.attempts?.at(-1)?.number || 1 });
    }
    for (const task of state.tasks.filter((candidate) => ['failed', 'interrupted'].includes(candidate.status) && !candidate.attentionAcknowledged && (!runId || candidate.runId === runId))) {
      events.push({ id: `task:${task.id}:${task.status}`, type: 'failure', taskId: task.id, agentId: task.agentId, title: task.title, message: task.exitState || task.status, recoverable: true });
    }
    for (const integration of (state.integrations || []).filter((candidate) => candidate.status === 'review' && (!runId || candidate.runId === runId))) {
      events.push({ id: `integration:${integration.id}`, type: 'integration', integrationId: integration.id, title: 'Integrated BDFL workflow', taskCount: integration.taskIds.length });
    }
    for (const integration of (state.integrations || []).filter((candidate) => candidate.status === 'failed' && !candidate.attentionAcknowledged && (!runId || candidate.runId === runId))) {
      events.push({ id: `integration:${integration.id}:failed`, type: 'failure', integrationId: integration.id, title: 'Integrated BDFL workflow', message: integration.exitState, recoverable: true });
    }
    return events;
  }

  waitForAttention(runId, signal) {
    const ready = this.attention(runId);
    if (ready.length) return Promise.resolve(ready);
    return new Promise((resolve, reject) => {
      const finish = () => {
        const events = this.attention(runId);
        if (!events.length) return;
        cleanup(); resolve(events);
      };
      const cancel = () => { cleanup(); const error = new Error('BDFL wait was interrupted'); error.name = 'AbortError'; reject(error); };
      const cleanup = () => { this.emitter.off('attention', finish); signal?.removeEventListener('abort', cancel); };
      this.emitter.on('attention', finish);
      signal?.addEventListener('abort', cancel, { once: true });
    });
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
      const task = agent.taskId ? state.tasks.find((item) => item.id === agent.taskId) : null;
      if (task) { task.status = 'cancelled'; task.exitState = reason; task.stoppedAt = agent.stoppedAt; }
      return state;
    });
  }
}

module.exports = { EventBroker };
