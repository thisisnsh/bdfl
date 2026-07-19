'use strict';

const readline = require('node:readline');
const { loadSettings, saveSettings } = require('../core/settings');
const { validateModelSpec } = require('../core/model-spec');
const { selectPlanVersion } = require('../core/plans');
const { StateStore } = require('../state/store');

const TOOLS = Object.freeze([
  {
    name: 'models',
    title: 'Choose BDFL model',
    description: 'Show a native model selector and persist the exact BDFL run model.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false }
  },
  {
    name: 'plans',
    title: 'Choose BDFL plan',
    description: 'Show a native selector for captured BDFL plan versions, or report that no plans exist.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false }
  },
  {
    name: 'agents',
    title: 'Inspect BDFL agent',
    description: 'Show a native selector for BDFL agents and return the selected agent details, or report that no agents exist.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false }
  },
  {
    name: 'inbox',
    title: 'Answer BDFL agent',
    description: 'Show native controls for waiting agent questions and permission requests, then record the explicit response.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
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
        type: 'string',
        title,
        description: `Expand this selector to see all ${values.length} choices.`,
        enum: values,
        ...(defaultValue ? { default: defaultValue } : {})
      }
    },
    required: ['selection']
  };
}

class BdflMcpServer {
  constructor({
    input = process.stdin,
    output = process.stdout,
    projectRoot = process.cwd(),
    settingsLoader = loadSettings,
    settingsSaver = saveSettings,
    store = new StateStore(projectRoot)
  } = {}) {
    this.input = input;
    this.output = output;
    this.settingsLoader = settingsLoader;
    this.settingsSaver = settingsSaver;
    this.store = store;
    this.clientCapabilities = {};
    this.nextRequestId = 1;
    this.pending = new Map();
  }

  send(message) { this.output.write(`${JSON.stringify(message)}\n`); }

  respond(id, result) { this.send({ jsonrpc: '2.0', id, result }); }

  fail(id, code, message) { this.send({ jsonrpc: '2.0', id, error: { code, message } }); }

  supportsElicitation() { return Boolean(this.clientCapabilities.elicitation); }

  elicit(message, requestedSchema) {
    if (!this.supportsElicitation()) return Promise.resolve({ action: 'unsupported' });
    const id = `bdfl-elicitation-${this.nextRequestId++}`;
    const response = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.send({
      jsonrpc: '2.0',
      id,
      method: 'elicitation/create',
      params: { mode: 'form', message, requestedSchema }
    });
    return response;
  }

  async chooseModel() {
    const settings = this.settingsLoader();
    const response = await this.elicit(
      `Current model: ${settings.defaultModel}. The Model selector contains all ${settings.models.length} configured choices; expand it, then choose the exact model for future BDFL runs.`,
      choiceSchema('Model', settings.models, settings.defaultModel)
    );
    if (response.action === 'unsupported') {
      return textResult('This host does not expose MCP elicitation.', { current: settings.defaultModel, models: settings.models });
    }
    if (response.action !== 'accept') return textResult('Model selection cancelled.', { action: response.action });
    const model = response.content?.selection;
    validateModelSpec(model, settings.models);
    const selected = this.settingsSaver({ ...settings, models: [...settings.models], defaultModel: model });
    return textResult(`Selected model: ${selected.defaultModel}`, { selectedModel: selected.defaultModel });
  }

  async choosePlan() {
    const state = this.store.load();
    if (!state.plans.length) return textResult('No plans.', { plans: [] });
    const choices = new Map();
    for (const plan of state.plans) {
      for (const version of plan.versions || []) {
        const label = `${plan.title || plan.id} (${plan.id}) — v${version.number}`;
        choices.set(label, { planId: plan.id, version: version.number });
      }
    }
    if (!choices.size) return textResult('No plans.', { plans: [] });
    const response = await this.elicit('Choose the BDFL plan version to use for execution.', choiceSchema('Plan version', [...choices.keys()]));
    if (response.action === 'unsupported') return textResult('This host does not expose MCP elicitation.', { plans: [...choices.keys()] });
    if (response.action !== 'accept') return textResult('Plan selection cancelled.', { action: response.action });
    const chosen = choices.get(response.content?.selection);
    if (!chosen) throw new Error('Unknown plan selection');
    this.store.update((value) => {
      const index = value.plans.findIndex((plan) => plan.id === chosen.planId);
      if (index === -1) throw new Error(`Unknown plan: ${chosen.planId}`);
      value.plans[index] = selectPlanVersion(value.plans[index], chosen.version);
      return value;
    });
    return textResult(`Selected plan: ${chosen.planId} v${chosen.version}`, chosen);
  }

  async inspectAgent() {
    const state = this.store.load();
    if (!state.agents.length) return textResult('No agents.', { agents: [] });
    const choices = new Map(state.agents.map((agent) => [
      `${agent.title || agent.id} (${agent.id}) — ${agent.status || 'unknown'}`,
      agent.id
    ]));
    const response = await this.elicit('Choose a BDFL agent to inspect.', choiceSchema('Agent', [...choices.keys()]));
    if (response.action === 'unsupported') return textResult('This host does not expose MCP elicitation.', { agents: [...choices.keys()] });
    if (response.action !== 'accept') return textResult('Agent selection cancelled.', { action: response.action });
    const agentId = choices.get(response.content?.selection);
    const agent = this.store.load().agents.find((candidate) => candidate.id === agentId);
    if (!agent) throw new Error('Unknown agent selection');
    return textResult(`Selected agent: ${agent.id}\n${JSON.stringify(agent, null, 2)}`, { agent });
  }

  async answerInbox() {
    const state = this.store.load();
    const open = state.inbox.filter((item) => item.status === 'open');
    if (!open.length) return textResult('No agent questions.', { inbox: [] });
    let item = open[0];
    if (open.length > 1) {
      const choices = new Map(open.map((candidate) => {
        const summary = typeof candidate.payload === 'string'
          ? candidate.payload
          : candidate.payload?.message || candidate.payload?.question || candidate.kind;
        return [`${candidate.agentId} — ${summary} (${candidate.id})`, candidate.id];
      }));
      const picked = await this.elicit('Choose the waiting BDFL Inbox item to answer.', choiceSchema('Inbox item', [...choices.keys()]));
      if (picked.action === 'unsupported') return textResult('This host does not expose MCP elicitation.', { inbox: [...choices.keys()] });
      if (picked.action !== 'accept') return textResult('Inbox selection cancelled.', { action: picked.action });
      item = open.find((candidate) => candidate.id === choices.get(picked.content?.selection));
      if (!item) throw new Error('Unknown Inbox selection');
    }

    const payload = item.payload;
    const message = typeof payload === 'string'
      ? payload
      : payload?.message || payload?.question || JSON.stringify(payload);
    const rawOptions = typeof payload === 'object' && payload
      ? payload.options || payload.choices
      : null;
    const options = Array.isArray(rawOptions)
      ? rawOptions.map((option) => typeof option === 'string' ? option : option.label || option.title || option.value).filter(Boolean)
      : [];
    const requestedSchema = item.kind === 'permission'
      ? choiceSchema('Decision', ['Approve', 'Deny'])
      : options.length
        ? choiceSchema('Answer', options)
        : {
            type: 'object',
            properties: { selection: { type: 'string', title: 'Answer', minLength: 1 } },
            required: ['selection']
          };
    const response = await this.elicit(`${item.agentId} asks: ${message}`, requestedSchema);
    if (response.action === 'unsupported') return textResult('This host does not expose MCP elicitation.', { item });
    if (response.action !== 'accept') return textResult('Agent remains suspended.', { action: response.action, inboxId: item.id });
    const answer = response.content?.selection;
    if (!answer) throw new Error('An explicit Inbox answer is required');
    this.store.update((value) => {
      const current = value.inbox.find((candidate) => candidate.id === item.id && candidate.status === 'open');
      if (!current) throw new Error(`Open Inbox item not found: ${item.id}`);
      current.status = 'answered';
      current.answer = answer;
      current.resolvedAt = new Date().toISOString();
      current.deliveryStatus = 'pending';
      return value;
    });
    return textResult(`Recorded answer for ${item.agentId}: ${answer}`, {
      inboxId: item.id,
      agentId: item.agentId,
      answer,
      deliveryStatus: 'pending'
    });
  }

  async callTool(name) {
    if (name === 'models') return this.chooseModel();
    if (name === 'plans') return this.choosePlan();
    if (name === 'agents') return this.inspectAgent();
    if (name === 'inbox') return this.answerInbox();
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
        instructions: 'Use models, plans, and agents for native BDFL management selectors.'
      });
      return;
    }
    if (message.method === 'notifications/initialized' || message.method === 'notifications/cancelled') return;
    if (message.method === 'ping') { this.respond(message.id, {}); return; }
    if (message.method === 'tools/list') { this.respond(message.id, { tools: TOOLS }); return; }
    if (message.method === 'tools/call') {
      try {
        this.respond(message.id, await this.callTool(message.params?.name));
      } catch (error) {
        this.respond(message.id, { ...textResult(error.message), isError: true });
      }
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

module.exports = { TOOLS, textResult, choiceSchema, BdflMcpServer };
