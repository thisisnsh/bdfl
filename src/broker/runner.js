'use strict';

const readline = require('node:readline');
const { normalizeEvent, preflight, runProvider, resumeProvider } = require('../providers');

class AgentRunner {
  constructor(store, broker, { preflightProvider = preflight, spawnProvider = runProvider, resumeProviderSession = resumeProvider, onCompletion = null } = {}) {
    this.store = store;
    this.broker = broker;
    this.preflightProvider = preflightProvider;
    this.spawnProvider = spawnProvider;
    this.resumeProviderSession = resumeProviderSession;
    this.onCompletion = onCompletion;
    this.processes = new Map();
  }

  start(agent, specification, options) {
    const ready = this.preflightProvider(specification, options);
    if (!ready.ok) {
      this.broker.publish(agent.id, { type: 'error', code: ready.code, message: ready.message });
      return { started: false, preflight: ready };
    }
    this.store.update((state) => {
      const existing = state.agents.find((item) => item.id === agent.id);
      if (existing) Object.assign(existing, agent, { status: 'running' });
      else state.agents.push({ ...agent, status: 'running' });
      return state;
    });
    const child = this.spawnProvider(specification, options);
    this.attach(agent, child);
    return { started: true, child };
  }

  attach(agent, child) {
    this.processes.set(agent.id, child);
    const lines = readline.createInterface({ input: child.stdout });
    lines.on('line', (line) => {
      if (!line.trim()) return;
      try {
        const event = normalizeEvent(agent.provider, line);
        if (event.type === 'completion' && this.onCompletion) this.onCompletion(agent, event);
        else this.broker.publish(agent.id, event);
        if (['question', 'permission'].includes(event.type)) child.kill('SIGTERM');
      } catch (error) {
        this.broker.publish(agent.id, { type: 'error', message: `Invalid provider event: ${error.message}` });
      }
    });
    child.stderr.on('data', (chunk) => this.broker.publish(agent.id, { type: 'log', stream: 'stderr', text: `${chunk}` }));
    child.on('error', (error) => this.broker.publish(agent.id, { type: 'error', message: error.message }));
    child.on('close', (code, signal) => {
      this.processes.delete(agent.id);
      const state = this.store.load();
      const current = state.agents.find((item) => item.id === agent.id);
      if (current && !['waiting', 'review', 'failed', 'cancelled'].includes(current.status)) {
        this.broker.publish(agent.id, code === 0
          ? { type: 'completion', result: { code, signal } }
          : { type: 'error', message: `Provider exited with code ${code}${signal ? ` (${signal})` : ''}` });
      }
    });
  }

  answer(agentId, inboxId, answer, specification, options) {
    const state = this.store.load();
    const agent = state.agents.find((candidate) => candidate.id === agentId);
    if (!agent?.sessionId) throw new Error(`Agent session is unavailable for resume: ${agentId}`);
    const child = this.resumeProviderSession(specification, { ...options, sessionId: agent.sessionId, prompt: answer });
    this.broker.answer(inboxId, answer);
    this.attach(agent, child);
    return child;
  }

  stop(agentId) {
    const child = this.processes.get(agentId);
    if (child) child.kill('SIGTERM');
    this.broker.cancel(agentId);
  }
}

module.exports = { AgentRunner };
