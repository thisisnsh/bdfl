'use strict';

const readline = require('node:readline');
const { normalizeEvent, preflight, runProvider } = require('../providers');

class AgentRunner {
  constructor(store, broker, { preflightProvider = preflight, spawnProvider = runProvider, platform = process.platform } = {}) {
    this.store = store;
    this.broker = broker;
    this.preflightProvider = preflightProvider;
    this.spawnProvider = spawnProvider;
    this.platform = platform;
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
    this.processes.set(agent.id, child);
    const lines = readline.createInterface({ input: child.stdout });
    lines.on('line', (line) => {
      if (!line.trim()) return;
      try {
        const event = normalizeEvent(agent.provider, line);
        this.broker.publish(agent.id, event);
        if (['question', 'permission'].includes(event.type) && this.platform !== 'win32') child.kill('SIGSTOP');
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
      if (current && !['review', 'failed', 'cancelled'].includes(current.status)) {
        this.broker.publish(agent.id, code === 0
          ? { type: 'completion', result: { code, signal } }
          : { type: 'error', message: `Provider exited with code ${code}${signal ? ` (${signal})` : ''}` });
      }
    });
    return { started: true, child };
  }

  answer(agentId, inboxId, answer) {
    this.broker.answer(inboxId, answer);
    const child = this.processes.get(agentId);
    if (!child) throw new Error(`Agent process is not running: ${agentId}`);
    child.stdin.write(`${JSON.stringify({ type: 'answer', answer })}\n`);
    if (this.platform !== 'win32') child.kill('SIGCONT');
  }

  stop(agentId) {
    const child = this.processes.get(agentId);
    if (child) child.kill('SIGTERM');
    this.broker.cancel(agentId);
  }
}

module.exports = { AgentRunner };

