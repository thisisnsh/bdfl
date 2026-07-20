'use strict';

const crypto = require('node:crypto');
const { compileManifest, scheduleWaves, taskSummary } = require('./tasks');
const { parseModelSpec } = require('./model-spec');
const { EventBroker } = require('../broker/events');
const { AgentRunner } = require('../broker/runner');
const { WorktreeManager } = require('../worktrees/manager');

const RUNNING = new Set(['pending', 'running', 'waiting', 'review', 'approved', 'validating']);

class ProjectCoordinator {
  constructor(root, {
    store,
    settingsLoader,
    id = () => crypto.randomUUID(),
    now = () => new Date(),
    worktrees = new WorktreeManager(root),
    broker,
    runner
  }) {
    this.root = root;
    this.store = store;
    this.settingsLoader = settingsLoader;
    this.id = id;
    this.now = now;
    this.worktrees = worktrees;
    this.broker = broker || new EventBroker(store, { id, now });
    this.runner = runner || new AgentRunner(store, this.broker);
  }

  activeRun() {
    return [...this.store.load().runs].reverse().find((run) => RUNNING.has(run.status));
  }

  recoverStaleProcesses() {
    return this.store.update((state) => {
      for (const agent of state.agents) {
        if (['running', 'waiting'].includes(agent.status)) {
          agent.status = 'interrupted';
          agent.exitState = 'BDFL host session ended before the agent completed';
        }
      }
      for (const task of state.tasks) {
        if (['running', 'waiting'].includes(task.status)) task.status = 'interrupted';
      }
      return state;
    });
  }

  dispatch(input) {
    const settings = this.settingsLoader();
    const run = this.activeRun();
    if (!run) throw new Error('Turn BDFL on before dispatching tasks');
    const manifest = compileManifest({ runId: run.id, tasks: input.tasks }, settings, { id: this.id });
    const waves = scheduleWaves(manifest.tasks, settings.maxAgents);
    const waveById = new Map(waves.flatMap((wave, index) => wave.map((taskId) => [taskId, index])));
    const createdAt = this.now().toISOString();
    this.store.update((state) => {
      for (const task of manifest.tasks) state.tasks.push({ ...task, runId: run.id, host: input.host, wave: waveById.get(task.id), status: 'pending', createdAt });
      const current = state.runs.find((candidate) => candidate.id === run.id);
      if (current) current.status = 'running';
      return state;
    });
    this.startEligible(input.host);
    const state = this.store.load();
    const tasks = state.tasks.filter((task) => task.runId === run.id && manifest.tasks.some((item) => item.id === task.id));
    return { runId: run.id, tasks: tasks.map((task) => taskSummary(task, tasks)), waves };
  }

  startEligible(host) {
    const state = this.store.load();
    const run = [...state.runs].reverse().find((candidate) => RUNNING.has(candidate.status));
    const pending = state.tasks.filter((task) => task.status === 'pending' && task.runId === run?.id);
    if (!pending.length) return [];
    const ready = pending.filter((task) => task.dependencies.every((dependency) => {
      const upstream = state.tasks.find((candidate) => candidate.id === dependency);
      return upstream?.status === 'approved';
    }));
    const firstWave = Math.min(...ready.map((task) => task.wave));
    const started = [];
    for (const task of ready.filter((candidate) => candidate.wave === firstWave)) {
      const attempt = this.worktrees.create(task.id, 1);
      const parsed = parseModelSpec(task.model);
      const agent = {
        id: this.id(),
        runId: task.runId,
        taskId: task.id,
        title: task.title,
        provider: parsed.provider,
        model: task.model,
        attempt: 1,
        branch: attempt.branch,
        worktree: attempt.worktree,
        createdAt: this.now().toISOString()
      };
      this.store.update((value) => {
        const current = value.tasks.find((candidate) => candidate.id === task.id);
        current.status = 'running';
        current.agentId = agent.id;
        current.attempts = [...(current.attempts || []), { number: 1, agentId: agent.id, branch: attempt.branch, worktree: attempt.worktree, createdAt: agent.createdAt }];
        return value;
      });
      const result = this.runner.start(agent, task.model, {
        host: host || parsed.provider,
        permissionMode: task.permissionMode,
        prompt: task.prompt,
        cwd: attempt.worktree,
        ollamaBaseUrl: this.settingsLoader().ollamaBaseUrl
      });
      if (!result.started) {
        this.store.update((value) => {
          const current = value.tasks.find((candidate) => candidate.id === task.id);
          current.status = 'failed';
          current.exitState = result.preflight?.message || 'Provider preflight failed';
          return value;
        });
      }
      started.push(agent.id);
    }
    return started;
  }

  approveTask(taskId, host) {
    this.store.update((state) => {
      const task = state.tasks.find((candidate) => candidate.id === taskId);
      if (!task) throw new Error(`Task not found: ${taskId}`);
      if (task.status !== 'review') throw new Error(`Task is not ready for approval: ${taskId}`);
      task.status = 'approved';
      task.approvedAt = this.now().toISOString();
      return state;
    });
    const task = this.store.load().tasks.find((candidate) => candidate.id === taskId);
    this.startEligible(host || task?.host);
  }

  cancelTask(taskId) {
    const task = this.store.load().tasks.find((candidate) => candidate.id === taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);
    if (task.agentId) this.runner.stop(task.agentId);
    this.store.update((state) => {
      const current = state.tasks.find((candidate) => candidate.id === taskId);
      current.status = 'cancelled';
      current.stoppedAt = this.now().toISOString();
      return state;
    });
  }
}

module.exports = { RUNNING, ProjectCoordinator };
