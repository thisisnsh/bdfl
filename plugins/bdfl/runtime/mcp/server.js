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

const COMMANDS = Object.freeze(['on', 'off', 'models', 'plans', 'tasks', 'agents', 'help']);
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
    description: 'Run one guided BDFL command for a Git project.',
    inputSchema: {
      type: 'object',
      properties: {
        projectRoot: { type: 'string', description: 'Absolute path to the active Git project.' },
        command: { type: 'string', enum: COMMANDS },
        runId: { type: 'string' },
        page: { type: 'integer', minimum: 1 },
        pageSize: { type: 'integer', minimum: 10, maximum: 200 }
      },
      required: ['projectRoot', 'command'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false }
  },
  {
    name: 'dispatch',
    title: 'Dispatch BDFL tasks',
    description: 'Validate and start a managed BDFL task manifest.',
    inputSchema: {
      type: 'object',
      properties: {
        projectRoot: { type: 'string', description: 'Absolute path to the active Git project.' },
        host: { type: 'string', enum: ['claude', 'codex'] },
        tasks: { type: 'array', minItems: 1, items: TOOL_TASK }
      },
      required: ['projectRoot', 'host', 'tasks'],
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

  async manageModel() {
    const settings = this.settingsLoader();
    const picked = await this.choose(`Current model: ${settings.defaultModel}. Choose the exact model for future BDFL runs.`, 'Model', settings.models, settings.defaultModel);
    if (picked.unsupported) return textResult('Model choices returned.', { current: settings.defaultModel, models: settings.models });
    if (picked.cancelled) return textResult('Model selection cancelled.', { action: picked.action });
    validateModelSpec(picked.value, settings.models);
    const selected = this.settingsSaver({ ...settings, models: [...settings.models], defaultModel: picked.value });
    return textResult(`Selected model: ${selected.defaultModel}`, { selectedModel: selected.defaultModel });
  }

  async turnOn(project) {
    this.gitExcluder(project.root);
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
    const settings = this.settingsLoader();
    const run = { id: `run-${this.id()}`, title: path.basename(project.root), status: 'pending', model: settings.defaultModel, createdAt: this.now().toISOString() };
    project.store.update((value) => { value.runs.push(run); return value; });
    return textResult(`BDFL is active for ${run.title}.`, { active: true, runId: run.id, model: run.model });
  }

  turnOff(project) {
    const state = project.store.load();
    const agents = state.agents.filter((agent) => ['running', 'waiting'].includes(agent.status));
    if (agents.length) return textResult(`Resolve ${agents.length} running agent(s) before turning BDFL off.`, { active: true, blocked: true });
    project.store.update((value) => {
      for (const run of value.runs) if (RUNNING.has(run.status)) run.status = 'completed';
      return value;
    });
    return textResult('BDFL is off.', { active: false });
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

  async manageInbox(project) {
    const state = project.store.load();
    const open = state.inbox.filter((item) => item.status === 'open');
    if (!open.length) return textResult('No agent questions.', { inbox: [] });
    const labels = new Map(open.map((item) => {
      const task = state.tasks.find((candidate) => candidate.id === state.agents.find((agent) => agent.id === item.agentId)?.taskId);
      const message = typeof item.payload === 'string' ? item.payload : item.payload?.message || item.payload?.question || item.kind;
      return [`${task?.title || 'Agent'} — ${message}`, item.id];
    }));
    let item = open[0];
    if (open.length > 1) {
      const selected = await this.choose('Choose the waiting agent question.', 'Question', [...labels.keys()]);
      if (selected.unsupported) return textResult('Agent questions returned.', { inbox: [...labels.keys()] });
      if (selected.cancelled) return textResult('Inbox selection cancelled.', { action: selected.action });
      item = open.find((candidate) => candidate.id === labels.get(selected.value));
    }
    const payload = item.payload;
    const message = typeof payload === 'string' ? payload : payload?.message || payload?.question || JSON.stringify(payload);
    const raw = typeof payload === 'object' && payload ? payload.options || payload.choices : null;
    const options = item.kind === 'permission' ? ['Approve', 'Deny'] : Array.isArray(raw) ? raw.map((option) => typeof option === 'string' ? option : option.label || option.title || option.value).filter(Boolean) : [];
    const response = options.length
      ? await this.choose(message, item.kind === 'permission' ? 'Decision' : 'Answer', options)
      : await this.elicit(message, { type: 'object', properties: { selection: { type: 'string', title: 'Answer', minLength: 1 } }, required: ['selection'] });
    if (response.unsupported || response.action === 'unsupported') return textResult('Agent question returned.', { item });
    if (response.cancelled || response.action !== undefined && response.action !== 'accept') return textResult('Agent remains suspended.', { inboxId: item.id });
    const answer = response.value || response.content?.selection;
    if (!answer) throw new Error('An explicit Inbox answer is required');
    project.store.update((value) => {
      const current = value.inbox.find((candidate) => candidate.id === item.id && candidate.status === 'open');
      current.status = 'answered'; current.answer = answer; current.resolvedAt = this.now().toISOString(); current.deliveryStatus = 'pending';
      return value;
    });
    return textResult('Recorded agent answer.', { inboxId: item.id, answer, deliveryStatus: 'pending' });
  }

  async manage(args) {
    const project = this.project(args.projectRoot);
    if (args.command === 'on') return this.turnOn(project);
    if (args.command === 'off') return this.turnOff(project);
    if (args.command === 'models') return this.manageModel();
    if (args.command === 'plans') return this.managePlans(project, args);
    if (args.command === 'tasks') return this.manageTasks(project, args);
    if (args.command === 'agents') return this.manageAgents(project, args);
    if (args.command === 'help') return textResult('BDFL commands: on, off, models, plans, tasks, agents, help.');
    throw new Error(`Unknown BDFL command: ${args.command}`);
  }

  async callTool(name, args = {}) {
    if (name === 'bdfl') return this.manage(args);
    if (name === 'dispatch') {
      const project = this.project(args.projectRoot);
      const result = project.coordinator.dispatch(args);
      return textResult(`Dispatched ${result.tasks.length} task(s).`, result);
    }
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
        instructions: 'Use bdfl for guided management and plan capture; use dispatch only for validated task manifests. Always pass the active Git project root.'
      });
      return;
    }
    if (message.method === 'notifications/initialized' || message.method === 'notifications/cancelled') return;
    if (message.method === 'ping') { this.respond(message.id, {}); return; }
    if (message.method === 'tools/list') { this.respond(message.id, { tools: TOOLS }); return; }
    if (message.method === 'tools/call') {
      try { this.respond(message.id, await this.callTool(message.params?.name, message.params?.arguments || {})); }
      catch (error) { this.respond(message.id, { ...textResult(error.message), isError: true }); }
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
    return lines;
  }
}

if (require.main === module) new BdflMcpServer().start();

module.exports = { COMMANDS, TOOLS, textResult, choiceSchema, canonicalProjectRoot, ensureGitExclude, pageText, BdflMcpServer };
