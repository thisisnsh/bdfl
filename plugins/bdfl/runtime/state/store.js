'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function initialState() {
  return { version: 1, runs: [], plans: [], tasks: [], agents: [], inbox: [], events: [] };
}

class StateStore {
  constructor(projectRoot, io = fs) {
    this.io = io;
    this.directory = path.join(projectRoot, '.bdfl');
    this.file = path.join(this.directory, 'state.json');
  }

  exists() { return this.io.existsSync(this.file); }

  load() {
    if (!this.exists()) return initialState();
    const state = JSON.parse(this.io.readFileSync(this.file, 'utf8'));
    if (state.version !== 1) throw new Error(`Unsupported state version: ${state.version}`);
    return state;
  }

  save(state) {
    if (state.version !== 1) throw new Error('State version must be 1');
    this.io.mkdirSync(this.directory, { recursive: true });
    const temporary = `${this.file}.${process.pid}.${crypto.randomUUID()}.tmp`;
    this.io.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    this.io.renameSync(temporary, this.file);
    return state;
  }

  update(mutator) {
    const state = this.load();
    const next = mutator(structuredClone(state)) || state;
    return this.save(next);
  }
}

function unfinishedState(state) {
  const active = new Set(['pending', 'running', 'waiting', 'review', 'approved', 'validating']);
  const hasWork = state.plans.length || state.tasks.length || state.agents.length || state.inbox.length || state.events.length;
  return {
    // A newly activated run with no durable work is idle, not recoverable work.
    runs: hasWork ? state.runs.filter((item) => active.has(item.status)) : [],
    tasks: state.tasks.filter((item) => active.has(item.status)),
    agents: state.agents.filter((item) => active.has(item.status)),
    inbox: state.inbox.filter((item) => item.status === 'open')
  };
}

function recoveryOptions(state) {
  const unfinished = unfinishedState(state);
  const count = Object.values(unfinished).reduce((sum, rows) => sum + rows.length, 0);
  return count ? { required: true, choices: ['resume', 'inspect', 'archive', 'cancel'], unfinished } : { required: false };
}

module.exports = { StateStore, initialState, unfinishedState, recoveryOptions };
