'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { execFileSync } = require('node:child_process');
const { loadSettings, saveSettings } = require('../core/settings');
const { validateModelSpec } = require('../core/model-spec');
const { PlanStore, diffLines } = require('../core/plans');
const { taskLabel, taskSummary } = require('../core/tasks');
const { ProjectCoordinator, RUNNING } = require('../core/coordinator');
const { StateStore, recoveryOptions } = require('../state/store');

const COMMANDS = Object.freeze(['status', 'models', 'plans', 'tasks', 'agents', 'help']);
const INSTRUCTIONS = `BDFL acts only when the user's request explicitly contains BDFL as a standalone term. Copy that request verbatim into the request field for management and dispatch calls. Plan approval, task complexity, and a splittable request are never authorization by themselves. "BDFL plan this" authorizes planning or plan management only, not execution. "BDFL execute…" or an equally explicit request to BDFL authorizes one workflow and remains valid through that workflow's later approval and review turns. Dispatch only when there are at least two useful atomic tasks; keep small single-stream work native. A valid dispatch automatically creates its run and must never be mixed into unfinished work. Use status for unfinished runs and present Continue, Manage tasks, Archive run, and Cancel run without choosing for the user. Once a workflow is explicitly started, use continue for its questions, permissions, reviews, retries, and integration decisions without requiring the user to repeat BDFL. Plan capture is automatic while this host's MCP process is live. Always pass the absolute Git worktree root.`;
const TOOL_TASK = {
  type: 'object',
  properties: {
    key: { type: 'string', minLength: 1 },
    title: { type: 'string', minLength: 1 },
    prompt: { type: 'string', minLength: 1 },
    objective: { type: 'string', minLength: 1 },
    context: { type: 'string' },
    allowedPaths: { type: 'array', minItems: 1, items: { type: 'string' } },
    dependencies: { type: 'array', items: { type: 'string' } },
    model: { type: 'string' },
    permissionMode: { type: 'string' },
    validationCommands: { type: 'array', items: { type: 'string' } },
    completionCriteria: { type: 'string' }
  },
  required: ['key', 'title', 'prompt', 'objective', 'context', 'allowedPaths', 'dependencies', 'model', 'permissionMode', 'validationCommands', 'completionCriteria'],
  additionalProperties: false
};

const TOOLS = Object.freeze([
  {
    name: 'bdfl',
    title: 'Manage BDFL',
    description: 'Manage BDFL only after the user explicitly names BDFL. Copy the user request verbatim. Plan approval alone is not authorization. Natural requests such as "BDFL plans" are valid.',
    inputSchema: {
      type: 'object',
      properties: {
        projectRoot: { type: 'string', description: 'Absolute path to the active Git project.' },
        request: { type: 'string', minLength: 1, description: 'The user request copied verbatim; it must contain BDFL as a standalone term.' },
        command: { type: 'string', enum: COMMANDS },
        host: { type: 'string', enum: ['claude', 'codex'], description: 'Invoking host for default model selection.' },
        runId: { type: 'string' },
        page: { type: 'integer', minimum: 1 },
        pageSize: { type: 'integer', minimum: 10, maximum: 200 }
      },
      required: ['projectRoot', 'request', 'command'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false }
  },
  {
    name: 'dispatch',
    title: 'Dispatch BDFL tasks',
    description: 'Start one explicitly authorized BDFL workflow. Copy the authorizing user request verbatim. Approval or complexity alone never authorizes dispatch. Use at least two useful atomic tasks; small single-stream work stays native. A valid dispatch creates its own run and refuses unfinished work.',
    inputSchema: {
      type: 'object',
      properties: {
        projectRoot: { type: 'string', description: 'Absolute path to the active Git project.' },
        request: { type: 'string', minLength: 1, description: 'The user request copied verbatim; it must contain BDFL as a standalone term and authorize this workflow.' },
        host: { type: 'string', enum: ['claude', 'codex'] },
        tasks: { type: 'array', minItems: 2, items: TOOL_TASK }
      },
      required: ['projectRoot', 'request', 'host', 'tasks'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false }
  },
  {
    name: 'continue',
    title: 'Continue BDFL workflow',
    description: 'Continue an already authorized BDFL workflow through questions, permissions, reviews, retries, and integration. The original authorization remains valid, so later answers need not repeat BDFL. Never infer a decision.',
    inputSchema: {
      type: 'object',
      properties: {
        projectRoot: { type: 'string', description: 'Absolute path to the active Git project.' },
        runId: { type: 'string' },
        decisions: {
          type: 'array', items: {
            type: 'object',
            properties: {
              eventId: { type: 'string' }, action: { type: 'string' }, answer: { type: 'string' }, feedback: { type: 'string' }
            },
            required: ['eventId', 'action'], additionalProperties: false
          }
        },
        page: { type: 'integer', minimum: 1 },
        pageSize: { type: 'integer', minimum: 10, maximum: 200 }
      },
      required: ['projectRoot'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false }
  }
]);

function textResult(text, structuredContent = {}) {
  return { content: [{ type: 'text', text }], structuredContent };
}

function choiceSchema(title, values, defaultValue) {
  return {
    type: 'object',
    properties: {
      selection: {
        type: 'string', title, enum: values,
        description: `Choose one of ${values.length} options.`,
        ...(defaultValue ? { default: defaultValue } : {})
      }
    },
    required: ['selection']
  };
}

function canonicalProjectRoot(projectRoot, run = execFileSync, io = fs) {
  if (!projectRoot || !path.isAbsolute(projectRoot)) throw new Error('BDFL requires an absolute Git worktree path. Open an existing repository or run git init first.');
  let root;
  try {
    root = `${run('git', ['-C', projectRoot, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })}`.trim();
  } catch {
    throw new Error(`BDFL requires a Git repository at ${projectRoot}. Run git init or open an existing repository; BDFL will not initialize Git automatically.`);
  }
  return io.realpathSync(root);
}

function ensureGitExclude(projectRoot, io = fs) {
  const gitDirectory = path.join(projectRoot, '.git');
  let exclude = path.join(gitDirectory, 'info', 'exclude');
  if (io.existsSync(gitDirectory) && io.statSync(gitDirectory).isFile()) {
    const pointer = io.readFileSync(gitDirectory, 'utf8').match(/^gitdir:\s*(.+)\s*$/i)?.[1];
    if (!pointer) throw new Error(`Invalid Git worktree metadata: ${gitDirectory}`);
    exclude = path.join(path.resolve(projectRoot, pointer), 'info', 'exclude');
  }
  io.mkdirSync(path.dirname(exclude), { recursive: true });
  const existing = io.existsSync(exclude) ? io.readFileSync(exclude, 'utf8') : '';
  const lines = existing.split(/\r?\n/);
  if (!lines.includes('.bdfl/')) io.appendFileSync(exclude, `${existing && !existing.endsWith('\n') ? '\n' : ''}.bdfl/\n`);
  return exclude;
}

function pageText(value, page = 1, pageSize = 80) {
  const lines = `${value || ''}`.split('\n');
  const size = Math.max(10, Math.min(200, pageSize));
  const pages = Math.max(1, Math.ceil(lines.length / size));
  const current = Math.max(1, Math.min(pages, page));
  return { text: lines.slice((current - 1) * size, current * size).join('\n'), page: current, pages, pageSize: size };
}

function duplicateLabel(title, id, rows, titleFor) {
  return rows.filter((row) => titleFor(row) === title).length > 1 ? `${title} (${`${id}`.slice(-8)})` : title;
}

function requireExplicitRequest(request) {
  if (typeof request !== 'string' || !/(?:^|[^A-Za-z0-9_])BDFL(?:$|[^A-Za-z0-9_])/i.test(request)) {
    throw new Error('BDFL must be explicitly named as a standalone term in the verbatim user request. Plan approval or task complexity alone is not authorization.');
  }
  return request;
}

function requireDispatchAuthorization(request) {
  requireExplicitRequest(request);
  const planningOnly = /\bBDFL\s+(?:please\s+)?plan(?:s|ning)?\b/i.test(request)
    && !/\b(?:execute|implement|build|fix|change|update|run|dispatch|delegate|split|do)\b/i.test(request);
  if (planningOnly) throw new Error('"BDFL plan this" authorizes planning only, not execution. Ask BDFL to execute or delegate when ready.');
  return request;
}

class BdflMcpServer {
  constructor({
    input = process.stdin,
    output = process.stdout,
    settingsLoader = loadSettings,
    settingsSaver = saveSettings,
    rootResolver = canonicalProjectRoot,
    gitExcluder = ensureGitExclude,
    storeFactory = (root) => new StateStore(root),
    id = () => crypto.randomUUID(),
    now = () => new Date(),
    planStoreFactory = (root) => new PlanStore(root, { id, now }),
    coordinatorFactory
  } = {}) {
    this.input = input;
    this.output = output;
    this.settingsLoader = settingsLoader;
    this.settingsSaver = settingsSaver;
    this.rootResolver = rootResolver;
    this.gitExcluder = gitExcluder;
    this.storeFactory = storeFactory;
    this.planStoreFactory = planStoreFactory;
    this.coordinatorFactory = coordinatorFactory || ((root, store) => new ProjectCoordinator(root, { store, settingsLoader, id, now }));
    this.id = id;
    this.now = now;
    this.projects = new Map();
    this.clientCapabilities = {};
    this.nextRequestId = 1;
    this.pending = new Map();
    this.activeCalls = new Map();
  }

  send(message) { this.output.write(`${JSON.stringify(message)}\n`); }
  respond(id, result) { this.send({ jsonrpc: '2.0', id, result }); }
  fail(id, code, message) { this.send({ jsonrpc: '2.0', id, error: { code, message } }); }
  supportsElicitation() { return Boolean(this.clientCapabilities.elicitation); }

  project(projectRoot) {
    const root = this.rootResolver(projectRoot);
    if (!this.projects.has(root)) {
      const store = this.storeFactory(root);
      const plans = this.planStoreFactory(root);
      if (store.exists?.()) {
        const migrated = plans.migrateStatePlans(store.load());
        if (migrated.migrated || store.load().plans?.length) store.save(migrated.state);
      }
      this.projects.set(root, { root, store, plans, coordinator: this.coordinatorFactory(root, store) });
    }
    return this.projects.get(root);
  }

  elicit(message, requestedSchema) {
    if (!this.supportsElicitation()) return Promise.resolve({ action: 'unsupported' });
    const id = `bdfl-elicitation-${this.nextRequestId++}`;
    const response = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.send({ jsonrpc: '2.0', id, method: 'elicitation/create', params: { mode: 'form', message, requestedSchema } });
    return response;
  }

  async choose(message, title, values, defaultValue) {
    const response = await this.elicit(message, choiceSchema(title, values, defaultValue));
    if (response.action === 'unsupported') return { unsupported: true, values };
    if (response.action !== 'accept') return { cancelled: true, action: response.action };
    if (!values.includes(response.content?.selection)) throw new Error(`Unknown ${title} selection`);
    return { value: response.content.selection };
  }

  async manageModel(host) {
    const settings = this.settingsLoader(undefined, { invokingHost: host });
    if (!settings.models.length) return textResult('No supported models discovered. Install or configure Claude Code or Codex.', { current: null, models: [] });
    const byModel = new Map();
    for (const entry of settings.modelCatalog || []) byModel.set(`${entry.provider}:${entry.model}`, entry);
    for (const specification of settings.customModels || []) {
      const parsed = validateModelSpec(specification, settings.models);
      const key = `${parsed.provider}:${parsed.model}`;
      if (!byModel.has(key)) byModel.set(key, { provider: parsed.provider, model: parsed.model, efforts: [parsed.effort], defaultEffort: parsed.effort, custom: true });
    }
    const current = settings.defaultModel ? settings.defaultModel.slice(0, settings.defaultModel.lastIndexOf(':')) : null;
    const picked = await this.choose(`Current model: ${settings.defaultModel || 'none'}. Choose a model for future BDFL runs.`, 'Model', [...byModel.keys()], current);
    if (picked.unsupported) return textResult('Model choices returned.', { current: settings.defaultModel, models: [...byModel.keys()] });
    if (picked.cancelled) return textResult('Model selection cancelled.', { action: picked.action });
    const entry = byModel.get(picked.value);
    const effort = await this.choose(`Choose the supported effort for ${picked.value}.`, 'Effort', entry.efforts, entry.defaultEffort);
    if (effort.unsupported) return textResult('Effort choices returned.', { model: picked.value, efforts: entry.efforts });
    if (effort.cancelled) return textResult('Model selection cancelled.', { action: effort.action });
    const specification = `${picked.value}:${effort.value}`;
    validateModelSpec(specification, settings.models);
    const selected = this.settingsSaver({ ...settings, models: [...settings.models], discoveredModels: [...settings.discoveredModels], customModels: [...settings.customModels], modelCatalog: settings.modelCatalog.map((item) => ({ ...item, efforts: [...item.efforts] })), defaultModel: specification });
    return textResult(`Selected model: ${selected.defaultModel}`, { selectedModel: selected.defaultModel });
  }

  async manageStatus(project) {
    const state = project.store.load();
    const recovery = recoveryOptions(state);
    if (recovery.required) {
      const options = ['Continue', 'Manage tasks', 'Archive run', 'Cancel run'];
      const picked = await this.choose('BDFL has unfinished work. Choose what to do with it.', 'Recovery action', options);
      if (picked.unsupported) return textResult('Unfinished BDFL work found.', { recovery: options, unfinished: recovery.unfinished });
      if (picked.cancelled) return textResult('Recovery cancelled.', { action: picked.action });
      if (picked.value === 'Manage tasks') return this.manageTasks(project, {});
      const status = picked.value === 'Archive run' ? 'archived' : picked.value === 'Cancel run' ? 'cancelled' : 'running';
      if (picked.value === 'Continue') project.coordinator.recoverStaleProcesses();
      project.store.update((value) => {
        for (const run of value.runs) if (RUNNING.has(run.status)) run.status = status;
        if (status !== 'running') {
          for (const task of value.tasks) if (RUNNING.has(task.status)) task.status = status;
          for (const agent of value.agents) if (RUNNING.has(agent.status)) agent.status = status;
          for (const item of value.inbox) if (item.status === 'open') item.status = status;
        }
        return value;
      });
      return textResult(`BDFL recovery: ${picked.value}.`, { active: status === 'running', action: picked.value });
    }
    const active = [...state.runs].reverse().find((run) => RUNNING.has(run.status));
    return active
      ? textResult(`BDFL run ${active.title || active.id}: ${active.status}.`, { active: true, run: active })
      : textResult('No unfinished BDFL run.', { active: false });
  }

  async managePlans(project, args) {
    const plans = project.plans.list();
    if (!plans.length) return textResult('No plans.', { plans: [] });
    const planChoices = new Map(plans.map((plan) => {
      const title = duplicateLabel(plan.title || plan.id, plan.id, plans, (row) => row.title || row.id);
      return [`${title} — ${plan.versions?.length || 0} version(s)`, plan.id];
    }));
    const planPick = await this.choose('Choose a captured BDFL plan.', 'Plan', [...planChoices.keys()]);
    if (planPick.unsupported) return textResult('Plan choices returned.', { plans: [...planChoices.keys()] });
    if (planPick.cancelled) return textResult('Plan selection cancelled.', { action: planPick.action });
    const plan = plans.find((candidate) => candidate.id === planChoices.get(planPick.value));
    const versions = new Map(plan.versions.map((version) => [`v${version.number} — ${version.createdAt || 'unknown time'}`, version.number]));
    const versionPick = await this.choose(`Choose a version of ${plan.title}.`, 'Version', [...versions.keys()], [...versions.keys()].at(-1));
    if (versionPick.cancelled) return textResult('Plan selection cancelled.', { action: versionPick.action });
    if (versionPick.unsupported) return textResult('Plan versions returned.', { plan: plan.title, versions: [...versions.keys()] });
    const number = versions.get(versionPick.value);
    const actionPick = await this.choose('Choose what to do with this plan version.', 'Action', ['View diff', 'View full', 'Approve']);
    if (actionPick.cancelled) return textResult('Plan action cancelled.', { action: actionPick.action });
    if (actionPick.unsupported) return textResult('Plan actions returned.', { actions: actionPick.values });
    if (actionPick.value === 'Approve') {
      project.plans.select(plan.id, number);
      return textResult(`Approved ${plan.title} v${number}.`, { planId: plan.id, version: number, approved: true });
    }
    const content = project.plans.content(plan.id, number);
    const before = number > 1 ? project.plans.content(plan.id, number - 1) : '';
    const full = actionPick.value === 'View full'
      ? content
      : diffLines(before, content).map((line) => `${line.type === 'addition' ? '+' : line.type === 'removal' ? '-' : ' '} ${line.text}`).join('\n');
    const page = pageText(full, args.page, args.pageSize);
    return textResult(`${plan.title} v${number} (${actionPick.value}, page ${page.page}/${page.pages})\n${page.text}`, {
      planId: plan.id, version: number, view: actionPick.value, ...page
    });
  }

  async manageTasks(project, args) {
    const state = project.store.load();
    if (!state.tasks.length) return textResult('No tasks.', { tasks: [] });
    const choices = new Map(state.tasks.map((task) => [`${taskLabel(task, state.tasks)} — ${task.status || 'pending'}`, task.id]));
    const picked = await this.choose('Choose a BDFL task.', 'Task', [...choices.keys()]);
    if (picked.unsupported) return textResult('Task choices returned.', { tasks: state.tasks.map((task) => taskSummary(task, state.tasks)) });
    if (picked.cancelled) return textResult('Task selection cancelled.', { action: picked.action });
    const task = state.tasks.find((candidate) => candidate.id === choices.get(picked.value));
    const actions = ['View summary', 'View prompt'];
    if (task.status === 'review') actions.push('Approve');
    if (RUNNING.has(task.status) || task.status === 'interrupted') actions.push('Cancel');
    const action = await this.choose(`Choose an action for ${taskLabel(task, state.tasks)}.`, 'Action', actions.slice(0, 4));
    if (action.cancelled) return textResult('Task action cancelled.', { action: action.action });
    if (action.unsupported) return textResult('Task actions returned.', { actions });
    if (action.value === 'Approve') {
      project.coordinator.approveTask(task.id);
      return textResult(`Approved task: ${taskLabel(task, state.tasks)}.`, { taskId: task.id, approved: true });
    }
    if (action.value === 'Cancel') {
      project.coordinator.cancelTask(task.id);
      return textResult(`Cancelled task: ${taskLabel(task, state.tasks)}.`, { taskId: task.id, cancelled: true });
    }
    if (action.value === 'View prompt') {
      const page = pageText(task.prompt || task.objective || '', args.page, args.pageSize);
      return textResult(`${taskLabel(task, state.tasks)} prompt (page ${page.page}/${page.pages})\n${page.text}`, { taskId: task.id, ...page });
    }
    return textResult(`${taskLabel(task, state.tasks)} — ${task.status || 'pending'}`, { task: taskSummary(task, state.tasks) });
  }

  async manageAgents(project, args) {
    const state = project.store.load();
    if (!state.agents.length) return textResult('No agents.', { agents: [] });
    const titleFor = (agent) => state.tasks.find((task) => task.id === agent.taskId)?.title || agent.title || agent.id;
    const choices = new Map(state.agents.map((agent) => {
      const title = duplicateLabel(titleFor(agent), agent.id, state.agents, titleFor);
      return [`${title} — ${agent.status || 'unknown'}`, agent.id];
    }));
    const picked = await this.choose('Choose a BDFL agent.', 'Agent', [...choices.keys()]);
    if (picked.unsupported) return textResult('Agent choices returned.', { agents: [...choices.keys()] });
    if (picked.cancelled) return textResult('Agent selection cancelled.', { action: picked.action });
    const agent = state.agents.find((candidate) => candidate.id === choices.get(picked.value));
    const actions = ['View summary', 'View logs'];
    if (['running', 'waiting'].includes(agent.status)) actions.push('Cancel');
    const action = await this.choose(`Choose an action for ${titleFor(agent)}.`, 'Action', actions);
    if (action.cancelled) return textResult('Agent action cancelled.', { action: action.action });
    if (action.unsupported) return textResult('Agent actions returned.', { actions });
    if (action.value === 'Cancel') {
      project.coordinator.cancelTask(agent.taskId);
      return textResult(`Cancelled agent for ${titleFor(agent)}.`, { agentId: agent.id, cancelled: true });
    }
    if (action.value === 'View logs') {
      const logs = state.events.filter((event) => event.agentId === agent.id).map((event) => `${event.createdAt || ''} ${event.type}: ${event.text || event.message || JSON.stringify(event.result || event.raw || '')}`).join('\n');
      const page = pageText(logs || 'No logs.', args.page, args.pageSize);
      return textResult(`${titleFor(agent)} logs (page ${page.page}/${page.pages})\n${page.text}`, { agentId: agent.id, ...page });
    }
    return textResult(`${titleFor(agent)} — ${agent.status || 'unknown'}`, { agentId: agent.id, taskId: agent.taskId, status: agent.status });
  }

  eventForm(events) {
    const properties = {};
    const required = [];
    events.forEach((event, index) => {
      const key = `event_${index + 1}`;
      required.push(key);
      if (event.type === 'permission') properties[key] = { type: 'string', title: `${event.title}: permission`, description: event.message, enum: ['Approve', 'Deny'] };
      else if (event.type === 'question' && event.choices?.length) properties[key] = { type: 'string', title: event.title, description: event.message, enum: event.choices };
      else if (event.type === 'question') properties[key] = { type: 'string', title: event.title, description: event.message, minLength: 1 };
      else if (['completion', 'integration'].includes(event.type)) properties[key] = { type: 'string', title: `${event.title}: review`, enum: ['View', 'Accept', 'Decline'] };
      else properties[key] = { type: 'string', title: `${event.title}: recovery`, description: event.message, enum: ['Retry', 'Cancel'] };
    });
    return { type: 'object', properties, required };
  }

  async collectDecisions(events) {
    const response = await this.elicit(`${events.length} BDFL event(s) need attention.`, this.eventForm(events));
    if (response.action === 'unsupported') return null;
    if (response.action !== 'accept') return [];
    return events.map((event, index) => {
      const value = response.content?.[`event_${index + 1}`];
      return event.type === 'question'
        ? { eventId: event.id, action: 'Answer', answer: value }
        : { eventId: event.id, action: value };
    });
  }

  async continueWorkflow(project, args, signal) {
    const runId = args.runId || project.coordinator.activeRun()?.id;
    let events = project.broker?.attention?.(runId) || project.coordinator.broker?.attention(runId) || [];
    if (!events.length) events = await project.coordinator.waitForAttention(runId, signal);
    const decisions = args.decisions || await this.collectDecisions(events);
    if (decisions === null) return textResult(`${events.length} workflow event(s) need attention.`, { runId, events });
    if (!decisions.length) return textResult('BDFL workflow remains paused for explicit decisions.', { runId, events });
    const byId = new Map(events.map((event) => [event.id, event]));
    const views = [];
    for (const decision of decisions) {
      const event = byId.get(decision.eventId);
      if (!event) throw new Error(`Unknown workflow event: ${decision.eventId}`);
      if (event.type === 'question') project.coordinator.answerEvent(event.id, decision.answer || decision.action);
      else if (event.type === 'permission') project.coordinator.answerEvent(event.id, decision.action === 'Approve' ? 'Approve' : 'Deny');
      else if (event.type === 'completion' && decision.action === 'Accept') project.coordinator.approveTask(event.taskId);
      else if (event.type === 'completion' && decision.action === 'View') views.push(project.coordinator.reviewTask(event.taskId));
      else if (event.type === 'completion' && decision.action === 'Decline') {
        let feedback = decision.feedback;
        if (!feedback) {
          const response = await this.elicit(`Feedback for ${event.title}`, { type: 'object', properties: { feedback: { type: 'string', title: 'Feedback', minLength: 1 } }, required: ['feedback'] });
          if (response.action !== 'accept') return textResult('Decline cancelled; review remains open.', { runId, events });
          feedback = response.content?.feedback;
        }
        project.coordinator.declineTask(event.taskId, feedback);
      } else if (event.type === 'integration' && decision.action === 'View') views.push(project.coordinator.reviewIntegration(event.integrationId));
      else if (event.type === 'integration' && decision.action === 'Accept') project.coordinator.acceptIntegration(event.integrationId);
      else if (event.type === 'integration' && decision.action === 'Decline') {
        let feedback = decision.feedback;
        if (!feedback) {
          const response = await this.elicit('Feedback for integrated workflow', { type: 'object', properties: { feedback: { type: 'string', title: 'Feedback', minLength: 1 } }, required: ['feedback'] });
          if (response.action !== 'accept') return textResult('Decline cancelled; integration review remains open.', { runId, events });
          feedback = response.content?.feedback;
        }
        project.coordinator.declineIntegration(event.integrationId, feedback);
      } else if (event.type === 'failure' && decision.action === 'Cancel' && event.taskId) project.coordinator.cancelTask(event.taskId);
      else if (event.type === 'failure' && decision.action === 'Retry' && event.taskId) project.coordinator.retryTask(event.taskId);
      else throw new Error(`Invalid ${event.type} action: ${decision.action}`);
    }
    if (views.length) {
      const rendered = views.map((review) => {
        const page = pageText(review.patch, args.page, args.pageSize);
        return { ...review, patch: page.text, page: page.page, pages: page.pages, pageSize: page.pageSize };
      });
      return textResult(`Showing ${views.length} task diff(s). Review remains open.`, { runId, reviews: rendered, events: project.coordinator.broker.attention(runId) });
    }
    const run = project.store.load().runs.find((candidate) => candidate.id === runId);
    if (run?.status === 'completed') return textResult('BDFL workflow completed and integration was accepted.', { runId, completed: true, integrationCommit: run.integrationCommit });
    const next = await project.coordinator.waitForAttention(runId, signal);
    return textResult(`${next.length} workflow event(s) need attention.`, { runId, events: next });
  }

  async manage(args) {
    requireExplicitRequest(args.request);
    const project = this.project(args.projectRoot);
    if (args.command === 'status') return this.manageStatus(project);
    if (args.command === 'models') return this.manageModel(args.host);
    if (args.command === 'plans') return this.managePlans(project, args);
    if (args.command === 'tasks') return this.manageTasks(project, args);
    if (args.command === 'agents') return this.manageAgents(project, args);
    if (args.command === 'help') return textResult('BDFL commands: status, models, plans, tasks, agents, help.', { commands: [...COMMANDS], protocolTools: ['dispatch', 'continue'] });
    throw new Error(`Invalid BDFL command: ${args.command}. Commands: ${COMMANDS.join(', ')}.`);
  }

  async callTool(name, args = {}, signal) {
    if (name === 'bdfl') return this.manage(args);
    if (name === 'dispatch') {
      requireDispatchAuthorization(args.request);
      if (!Array.isArray(args.tasks) || args.tasks.length < 2) throw new Error('BDFL dispatch requires at least two useful atomic tasks; keep small single-stream work native.');
      const project = this.project(args.projectRoot);
      const recovery = recoveryOptions(project.store.load());
      if (recovery.required) throw new Error('BDFL has unfinished work. Use status to Continue, Manage tasks, Archive run, or Cancel run before dispatching new work.');
      this.gitExcluder(project.root);
      const result = project.coordinator.dispatchAndWait
        ? await project.coordinator.dispatchAndWait(args, signal)
        : project.coordinator.dispatch(args);
      return textResult(`${result.events?.length || 0} workflow event(s) need attention.`, result);
    }
    if (name === 'continue') return this.continueWorkflow(this.project(args.projectRoot), args, signal);
    throw new Error(`Unknown tool: ${name}`);
  }

  async handleMessage(message) {
    if (!message || message.jsonrpc !== '2.0') return;
    if (!message.method && message.id !== undefined) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message || 'Elicitation failed'));
      else pending.resolve(message.result);
      return;
    }
    if (message.method === 'initialize') {
      this.clientCapabilities = message.params?.capabilities || {};
      this.respond(message.id, {
        protocolVersion: message.params?.protocolVersion || '2025-11-25',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'bdfl', version: '1.0.0' },
        instructions: INSTRUCTIONS
      });
      return;
    }
    if (message.method === 'notifications/initialized') return;
    if (message.method === 'notifications/cancelled') {
      const id = message.params?.requestId;
      this.activeCalls.get(id)?.abort();
      this.activeCalls.delete(id);
      for (const project of this.projects.values()) project.coordinator.recoverStaleProcesses();
      return;
    }
    if (message.method === 'ping') { this.respond(message.id, {}); return; }
    if (message.method === 'tools/list') { this.respond(message.id, { tools: TOOLS }); return; }
    if (message.method === 'tools/call') {
      const controller = new AbortController();
      this.activeCalls.set(message.id, controller);
      try { this.respond(message.id, await this.callTool(message.params?.name, message.params?.arguments || {}, controller.signal)); }
      catch (error) { if (error.name !== 'AbortError') this.respond(message.id, { ...textResult(error.message), isError: true }); }
      finally { this.activeCalls.delete(message.id); }
      return;
    }
    if (message.id !== undefined) this.fail(message.id, -32601, `Method not found: ${message.method}`);
  }

  start() {
    const lines = readline.createInterface({ input: this.input, crlfDelay: Infinity });
    lines.on('line', (line) => {
      if (!line.trim()) return;
      try { void this.handleMessage(JSON.parse(line)); }
      catch (error) { this.send({ jsonrpc: '2.0', error: { code: -32700, message: error.message } }); }
    });
    lines.on('close', () => { for (const project of this.projects.values()) project.coordinator.recoverStaleProcesses(); });
    return lines;
  }
}

if (require.main === module) new BdflMcpServer().start();

module.exports = { COMMANDS, INSTRUCTIONS, TOOLS, textResult, choiceSchema, canonicalProjectRoot, ensureGitExclude, pageText, requireExplicitRequest, requireDispatchAuthorization, BdflMcpServer };
