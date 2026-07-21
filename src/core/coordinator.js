'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const { compileManifest, scheduleWaves, taskSummary } = require('./tasks');
const { parseModelSpec } = require('./model-spec');
const { EventBroker } = require('../broker/events');
const { AgentRunner } = require('../broker/runner');
const { WorktreeManager } = require('../worktrees/manager');
const { IntegrationBatch } = require('../worktrees/integration');

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
    this.runner = runner || new AgentRunner(store, this.broker, { onCompletion: (agent, event) => this.finishAgent(agent, event) });
    this.integrations = new Map();
  }

  activeRun() {
    return [...this.store.load().runs].reverse().find((run) => RUNNING.has(run.status));
  }

  recoverStaleProcesses() {
    this.runner.interruptAll?.();
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
    if (this.activeRun()) throw new Error('BDFL has an unresolved run; resolve it before dispatching new work');
    const run = {
      id: `run-${this.id()}`,
      title: input.title || path.basename(this.root),
      status: 'pending',
      model: settings.defaultModel,
      request: input.request,
      createdAt: this.now().toISOString()
    };
    const manifest = compileManifest({ runId: run.id, tasks: input.tasks }, settings, { id: this.id });
    const waves = scheduleWaves(manifest.tasks, settings.maxAgents);
    const waveById = new Map(waves.flatMap((wave, index) => wave.map((taskId) => [taskId, index])));
    const createdAt = this.now().toISOString();
    this.store.update((state) => {
      state.runs.push(run);
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

  async dispatchAndWait(input, signal) {
    const result = this.dispatch(input);
    return { ...result, events: await this.waitForAttention(result.runId, signal) };
  }

  waitForAttention(runId, signal) { return this.broker.waitForAttention(runId, signal); }

  startEligible(host) {
    const state = this.store.load();
    const run = [...state.runs].reverse().find((candidate) => RUNNING.has(candidate.status));
    const pending = state.tasks.filter((task) => task.status === 'pending' && task.runId === run?.id);
    if (!pending.length) return [];
    const ready = pending.filter((task) => task.dependencies.every((dependency) => {
      const upstream = state.tasks.find((candidate) => candidate.id === dependency);
      return upstream?.status === 'approved';
    }));
    if (!ready.length) return [];
    const firstWave = Math.min(...ready.map((task) => task.wave));
    const started = [];
    for (const task of ready.filter((candidate) => candidate.wave === firstWave)) {
      started.push(this.startTask(task, 1, host));
    }
    return started;
  }

  startTask(task, attemptNumber, host, feedback) {
    const attempt = this.worktrees.create(task.id, attemptNumber);
      const parsed = parseModelSpec(task.model);
      const agent = {
        id: this.id(),
        runId: task.runId,
        taskId: task.id,
        title: task.title,
        provider: parsed.provider,
        model: task.model,
        attempt: attemptNumber,
        branch: attempt.branch,
        worktree: attempt.worktree,
        createdAt: this.now().toISOString()
      };
      this.store.update((value) => {
        const current = value.tasks.find((candidate) => candidate.id === task.id);
        current.status = 'running';
        current.agentId = agent.id;
        current.attempts = [...(current.attempts || []), { number: attemptNumber, agentId: agent.id, branch: attempt.branch, worktree: attempt.worktree, base: attempt.base, createdAt: agent.createdAt }];
        return value;
      });
      const result = this.runner.start(agent, task.model, {
        host: host || parsed.provider,
        permissionMode: task.permissionMode,
        prompt: feedback ? `${task.prompt}\n\nUser feedback on the previous attempt:\n${feedback}` : task.prompt,
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
    return agent.id;
  }

  finishAgent(agent, event) {
    try {
      const state = this.store.load();
      const task = state.tasks.find((candidate) => candidate.id === agent.taskId);
      const attempt = task?.attempts?.find((candidate) => candidate.agentId === agent.id);
      if (!task || !attempt) throw new Error(`Task attempt is unavailable: ${agent.taskId}`);
      const commit = this.worktrees.checkpoint(attempt.worktree, `Complete ${task.title}`);
      const changedFiles = this.worktrees.assertAllowedChanges(attempt.base, commit, task.allowedPaths);
      const validation = this.worktrees.validate(attempt.worktree, task.validationCommands);
      const failure = validation.find((result) => !result.ok);
      if (failure) throw new Error(`Task validation failed: ${failure.command}`);
      this.store.update((value) => {
        const current = value.tasks.find((candidate) => candidate.id === task.id);
        const currentAttempt = current.attempts.find((candidate) => candidate.agentId === agent.id);
        Object.assign(currentAttempt, { commit, changedFiles, validation, completedAt: this.now().toISOString() });
        return value;
      });
      this.broker.publish(agent.id, event);
    } catch (error) { this.broker.publish(agent.id, { type: 'error', message: error.message }); }
  }

  answerEvent(eventId, answer) {
    const state = this.store.load();
    const item = state.inbox.find((candidate) => candidate.id === eventId && candidate.status === 'open');
    if (!item) throw new Error(`Open agent event not found: ${eventId}`);
    const agent = state.agents.find((candidate) => candidate.id === item.agentId);
    const task = state.tasks.find((candidate) => candidate.id === agent?.taskId);
    this.runner.answer(agent.id, item.id, answer, task.model, {
      host: task.host || agent.provider, permissionMode: task.permissionMode, cwd: agent.worktree,
      ollamaBaseUrl: this.settingsLoader().ollamaBaseUrl
    });
  }

  declineTask(taskId, feedback) {
    if (!feedback?.trim()) throw new Error('Declining a task requires feedback');
    const task = this.store.load().tasks.find((candidate) => candidate.id === taskId);
    if (!task || task.status !== 'review') throw new Error(`Task is not ready for review: ${taskId}`);
    const attemptNumber = (task.attempts?.at(-1)?.number || 0) + 1;
    this.store.update((state) => {
      const current = state.tasks.find((candidate) => candidate.id === taskId);
      const previous = current.attempts.at(-1);
      previous.status = 'declined'; previous.feedback = feedback; previous.declinedAt = this.now().toISOString();
      current.status = 'pending';
      return state;
    });
    return this.startTask(this.store.load().tasks.find((candidate) => candidate.id === taskId), attemptNumber, task.host, feedback);
  }

  retryTask(taskId) {
    const task = this.store.load().tasks.find((candidate) => candidate.id === taskId);
    if (!task || !['failed', 'interrupted'].includes(task.status)) throw new Error(`Task is not recoverable: ${taskId}`);
    const attemptNumber = (task.attempts?.at(-1)?.number || 0) + 1;
    this.store.update((state) => {
      const current = state.tasks.find((candidate) => candidate.id === taskId);
      current.attempts.at(-1).status = current.status;
      current.status = 'pending'; current.attentionAcknowledged = true;
      return state;
    });
    return this.startTask(this.store.load().tasks.find((candidate) => candidate.id === taskId), attemptNumber, task.host, 'Resume this task after the previous provider session was interrupted.');
  }

  reviewTask(taskId) {
    const task = this.store.load().tasks.find((candidate) => candidate.id === taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);
    const attempt = task.attempts?.at(-1);
    const base = attempt?.base;
    const commit = attempt?.commit;
    if (!base || !commit) throw new Error(`Task diff is unavailable: ${taskId}`);
    const fileList = this.worktrees.git(['diff', '--name-only', `${base}..${commit}`]).split('\n').filter(Boolean);
    const diffstat = this.worktrees.git(['diff', '--stat', `${base}..${commit}`]);
    const patch = this.worktrees.git(['diff', '--no-ext-diff', `${base}..${commit}`]);
    return { taskId, title: task.title, fileList, diffstat, patch };
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
    this.prepareIntegration(task.runId);
  }

  prepareIntegration(runId) {
    const state = this.store.load();
    const tasks = state.tasks.filter((task) => task.runId === runId);
    if (!tasks.length || tasks.some((task) => task.status !== 'approved')) return null;
    if ((state.integrations || []).some((integration) => integration.runId === runId && ['review', 'accepted'].includes(integration.status))) return null;
    const attemptNumber = (state.integrations || []).filter((integration) => integration.runId === runId).length + 1;
    const batch = new IntegrationBatch(this.root, `${runId}-${attemptNumber}`);
    const started = batch.start(tasks[0].attempts[0].base);
    try {
      for (const task of tasks) {
        const attempt = task.attempts.at(-1);
        batch.apply(attempt.commit, attempt.changedFiles);
      }
      const commands = [...new Set(tasks.flatMap((task) => task.validationCommands || []))];
      const validation = batch.validate(commands);
      if (validation.some((result) => !result.ok)) throw new Error('Batch integration validation failed');
      const integration = {
        id: this.id(), runId, attempt: attemptNumber, taskIds: tasks.map((task) => task.id), status: 'review', ...started,
        commit: batch.head(), changedFiles: batch.files(), validation, createdAt: this.now().toISOString()
      };
      this.store.update((value) => { value.integrations ||= []; value.integrations.push(integration); return value; });
      this.integrations.set(integration.id, batch);
      this.broker.emitter.emit('attention');
      return integration;
    } catch (error) {
      this.store.update((value) => {
        value.integrations ||= [];
        value.integrations.push({ id: this.id(), runId, attempt: attemptNumber, taskIds: tasks.map((task) => task.id), status: 'failed', ...started, exitState: error.message, createdAt: this.now().toISOString() });
        return value;
      });
      this.broker.emitter.emit('attention');
      return null;
    }
  }

  integrationBatch(integration) {
    if (this.integrations.has(integration.id)) return this.integrations.get(integration.id);
    const batch = new IntegrationBatch(this.root, integration.runId);
    Object.assign(batch, { branch: integration.branch, worktree: integration.worktree, base: integration.base, validated: true });
    this.integrations.set(integration.id, batch);
    return batch;
  }

  reviewIntegration(id) {
    const integration = (this.store.load().integrations || []).find((candidate) => candidate.id === id);
    if (!integration) throw new Error(`Integration not found: ${id}`);
    const batch = this.integrationBatch(integration);
    return { integrationId: id, title: 'Integrated BDFL workflow', fileList: batch.files(), diffstat: batch.diffstat(), patch: batch.diff() };
  }

  acceptIntegration(id) {
    const integration = (this.store.load().integrations || []).find((candidate) => candidate.id === id);
    if (!integration || integration.status !== 'review') throw new Error(`Integration is not ready: ${id}`);
    const commit = this.integrationBatch(integration).accept();
    this.store.update((state) => {
      const current = state.integrations.find((candidate) => candidate.id === id);
      current.status = 'accepted'; current.acceptedAt = this.now().toISOString();
      const run = state.runs.find((candidate) => candidate.id === integration.runId);
      if (run) { run.status = 'completed'; run.integrationCommit = commit; }
      return state;
    });
    return commit;
  }

  declineIntegration(id, feedback) {
    if (!feedback?.trim()) throw new Error('Declining integration requires feedback');
    let runId;
    this.store.update((state) => {
      const integration = state.integrations.find((candidate) => candidate.id === id);
      if (!integration || integration.status !== 'review') throw new Error(`Integration is not ready: ${id}`);
      integration.status = 'declined'; integration.feedback = feedback; integration.declinedAt = this.now().toISOString();
      runId = integration.runId;
      return state;
    });
    return this.prepareIntegration(runId);
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
