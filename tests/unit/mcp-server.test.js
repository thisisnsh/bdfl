'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { initialState } = require('../../src/state/store');
const { BdflMcpServer } = require('../../src/mcp/server');

class Store {
  constructor(state = initialState()) { this.state = state; }
  load() { return structuredClone(this.state); }
  update(mutator) { this.state = mutator(structuredClone(this.state)); return this.load(); }
}

function fixture(state = initialState()) {
  const messages = [];
  const settings = {
    defaultModel: 'claude:sonnet:medium',
    models: [
      'claude:sonnet:medium',
      'claude:opus:medium',
      'claude:haiku:medium',
      'codex:gpt-5.6-sol:medium',
      'ollama:qwen3.5:medium'
    ]
  };
  let persisted = settings;
  const store = new Store(state);
  const server = new BdflMcpServer({
    output: { write: (line) => messages.push(JSON.parse(line)) },
    settingsLoader: () => structuredClone(persisted),
    settingsSaver: (value) => { persisted = structuredClone(value); return structuredClone(value); },
    store
  });
  return { messages, server, settings: () => persisted, store };
}

async function initialize(server) {
  await server.handleMessage({
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-11-25', capabilities: { elicitation: { form: {} } } }
  });
}

test('advertises native management and Inbox tools', async () => {
  const { messages, server } = fixture();
  await initialize(server);
  await server.handleMessage({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  assert.deepEqual(messages.at(-1).result.tools.map((tool) => tool.name), ['models', 'plans', 'agents', 'inbox']);
});

test('model tool elicits all options without a four-option prompt limit', async () => {
  const { messages, server, settings } = fixture();
  await initialize(server);
  const call = server.handleMessage({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'models', arguments: {} } });
  await new Promise((resolve) => setImmediate(resolve));
  const request = messages.find((message) => message.method === 'elicitation/create');
  assert.equal(request.params.requestedSchema.properties.selection.enum.length, 5);
  assert.match(request.params.message, /contains all 5 configured choices; expand it/);
  assert.equal(request.params.requestedSchema.properties.selection.description, 'Expand this selector to see all 5 choices.');
  await server.handleMessage({
    jsonrpc: '2.0', id: request.id,
    result: { action: 'accept', content: { selection: 'codex:gpt-5.6-sol:medium' } }
  });
  await call;
  assert.equal(settings().defaultModel, 'codex:gpt-5.6-sol:medium');
  assert.equal(messages.find((message) => message.id === 2).result.structuredContent.selectedModel, 'codex:gpt-5.6-sol:medium');
});

test('plan and agent tools return exact empty states without elicitation', async () => {
  const { messages, server } = fixture();
  await initialize(server);
  await server.handleMessage({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'plans', arguments: {} } });
  await server.handleMessage({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'agents', arguments: {} } });
  assert.equal(messages.find((message) => message.id === 2).result.content[0].text, 'No plans.');
  assert.equal(messages.find((message) => message.id === 3).result.content[0].text, 'No agents.');
  assert.equal(messages.some((message) => message.method === 'elicitation/create'), false);
});

test('plan tool persists the selected version', async () => {
  const state = initialState();
  state.plans.push({ id: 'p1', title: 'Release', versions: [{ number: 1, content: 'one' }, { number: 2, content: 'two' }], selectedVersion: null });
  const { messages, server, store } = fixture(state);
  await initialize(server);
  const call = server.handleMessage({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'plans', arguments: {} } });
  await new Promise((resolve) => setImmediate(resolve));
  const request = messages.find((message) => message.method === 'elicitation/create');
  await server.handleMessage({
    jsonrpc: '2.0', id: request.id,
    result: { action: 'accept', content: { selection: 'Release (p1) — v2' } }
  });
  await call;
  assert.equal(store.load().plans[0].selectedVersion, 2);
});

test('Inbox tool renders agent options and records explicit answers for delivery', async () => {
  const state = initialState();
  state.agents.push({ id: 'a1', status: 'waiting' });
  state.inbox.push({
    id: 'i1', agentId: 'a1', kind: 'question', status: 'open',
    payload: { message: 'Choose an API version', options: ['v1', 'v2'] }
  });
  const { messages, server, store } = fixture(state);
  await initialize(server);
  const call = server.handleMessage({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'inbox', arguments: {} } });
  await new Promise((resolve) => setImmediate(resolve));
  const request = messages.find((message) => message.method === 'elicitation/create');
  assert.deepEqual(request.params.requestedSchema.properties.selection.enum, ['v1', 'v2']);
  await server.handleMessage({
    jsonrpc: '2.0', id: request.id,
    result: { action: 'accept', content: { selection: 'v2' } }
  });
  await call;
  assert.equal(store.load().inbox[0].answer, 'v2');
  assert.equal(store.load().inbox[0].deliveryStatus, 'pending');
  assert.equal(store.load().agents[0].status, 'waiting');
});
