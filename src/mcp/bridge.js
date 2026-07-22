'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const { URL } = require('node:url');
const { sha256 } = require('../core/plans');

const PLAN_ACTIONS = ['current', 'publish'];
const WORKER_ACTIONS = ['execute', 'status', 'wait', 'complete', 'feedback', 'send'];
const ROLE_ACTIONS = {
  delegator: new Set(['execute', 'status', 'wait', 'feedback', 'send']),
  worker: new Set(['status', 'wait', 'complete']),
  verifier: new Set(['status', 'complete']),
  integration: new Set(['status', 'complete'])
};

const PLAN_TOOL = { name: 'bdfl_plan', title: 'Publish a durable BDFL plan', description: 'Read or publish the marker-bearing plan for this BDFL workstream.', inputSchema: { type: 'object', properties: { action: { type: 'string', enum: PLAN_ACTIONS }, source: { type: 'string' }, planId: { type: 'string' }, convert: { type: 'boolean' } }, required: ['action'], additionalProperties: false } };
const WORKERS_TOOL = { name: 'bdfl_workers', title: 'Coordinate BDFL-managed workers', description: 'Execute and monitor an approved BDFL plan without provider-native delegation.', inputSchema: { type: 'object', properties: { action: { type: 'string', enum: WORKER_ACTIONS }, planId: { type: 'string' }, version: { type: 'integer' }, executionId: { type: 'string' }, chunkId: { type: 'string' }, cursor: { type: 'integer' }, state: { type: 'string', enum: ['pass', 'blocked', 'fail'] }, summary: { type: 'string', maxLength: 800 }, affectedChunkIds: { type: 'array', items: { type: 'string' } }, message: { type: 'string', maxLength: 800 } }, required: ['action'], additionalProperties: false } };

function mcpResult(value) { return { content: [{ type: 'text', text: value.message || 'BDFL state updated.' }], structuredContent: value }; }
function nativePlan(source) {
  const body = `${source || ''}`.trim(); if (!body) throw new Error('Native plan source is required for conversion');
  const title = (body.match(/^#\s+(.+)$/mu)?.[1] || 'Converted native plan').replace(/-->|[\u0000-\u001f]/gu, '').trim() || 'Converted native plan';
  return `<!-- bdfl-plan:${JSON.stringify({ schema: 1, title })} -->\n# ${title}\n<!-- bdfl-shared:start -->\n## Shared decisions\nThis plan was explicitly converted from a provider-native plan.\n<!-- bdfl-shared:end -->\n<!-- bdfl-chunk:${JSON.stringify({ id: 'native-plan', paths: ['**'], dependsOn: [], locks: [], checks: [] })} -->\n## Implement converted native plan\n### Outcome\nComplete the adopted native plan.\n### Implementation\n${body}\n### Local validation\nRun the checks described by the adopted plan.\n### Acceptance conditions\nThe adopted plan is implemented and its stated validation passes.\n<!-- bdfl-chunk:end -->\n<!-- bdfl-global:${JSON.stringify({ checks: [] })} -->\n## Global validation\nReview the combined result against the adopted native plan.\n<!-- bdfl-global:end -->\n<!-- bdfl-plan:end -->\n`;
}

class PlanService {
  constructor(lineage) { this.lineage = lineage; }
  call(capability, args) {
    if (capability.role !== 'delegator') throw new Error('Only a delegator can access durable plans');
    if (args.action === 'current') { const current = this.lineage.current({ workstreamId: capability.workstreamId }); if (!current) return mcpResult({ plan: null, message: 'No BDFL plan has been published for this workstream.' }); return mcpResult({ planId: current.planId, version: current.currentVersion, title: current.title, message: `Current BDFL plan is ${current.planId} v${current.currentVersion}.` }); }
    if (args.action !== 'publish') throw new Error(`Unknown plan action: ${args.action}`);
    let source = args.source; if (args.convert && !/<!--\s*bdfl-plan(?::|-patch:)/.test(source || '')) source = nativePlan(source);
    if (!/<!--\s*bdfl-plan(?::|-patch:)/.test(source || '')) throw new Error('Plan publication requires BDFL markers; use convert only after an explicit user request');
    const published = this.lineage.publish(source, { planId: args.planId, workstreamId: capability.workstreamId, sessionId: capability.sessionId });
    return mcpResult({ planId: published.lineage.planId, version: published.manifest.version, duplicate: Boolean(published.duplicate), sourceSha: sha256(source), message: `${published.duplicate ? 'Reused' : 'Published'} ${published.lineage.planId} v${published.manifest.version}.` });
  }
}

class WorkerService {
  constructor({ scheduler, integration, sender } = {}) { this.scheduler = scheduler; this.integration = integration; this.sender = sender; }
  assert(capability, args) { if (!ROLE_ACTIONS[capability.role]?.has(args.action)) throw new Error(`${capability.role} cannot use worker action ${args.action}`); if (capability.executionId && args.executionId && capability.executionId !== args.executionId) throw new Error('Capability belongs to a different execution'); if (capability.chunkId && args.chunkId && capability.chunkId !== args.chunkId) throw new Error('Capability belongs to a different chunk'); }
  async call(capability, args) {
    this.assert(capability, args);
    if (args.action === 'execute') { const execution = this.scheduler.freeze(args.planId, args.version, capability.workstreamId); return mcpResult({ executionId: execution.id, duplicate: Boolean(execution.duplicate), message: execution.duplicate ? 'Approved plan execution is already active.' : 'Approved plan execution started.' }); }
    const executionId = args.executionId || capability.executionId; if (!executionId) throw new Error('executionId is required');
    if (this.scheduler.load(executionId).workstreamId !== capability.workstreamId) throw new Error('Execution belongs to a different workstream');
    if (args.action === 'status') return mcpResult(this.scheduler.status(executionId));
    if (args.action === 'wait') return mcpResult(await this.scheduler.wait(executionId, args.cursor || 0));
    if (args.action === 'send') { this.sender?.(executionId, args.chunkId, args.message); return mcpResult({ executionId, chunkId: args.chunkId, queued: true, message: 'Message queued for the worker.' }); }
    if (args.action === 'feedback') return mcpResult({ chunk: this.scheduler.feedback(executionId, args.chunkId, args.message, this.sender), message: 'Feedback returned the worker to its active attempt.' });
    if (args.action === 'complete' && capability.role === 'verifier') return mcpResult({ verification: this.integration.verification(executionId, args), message: 'Verifier report recorded.' });
    if (args.action === 'complete' && capability.role === 'integration') return mcpResult({ integration: this.integration.repaired(executionId, args), message: 'Integration repair recorded.' });
    if (args.action === 'complete') return mcpResult({ chunk: this.scheduler.complete(executionId, capability.chunkId || args.chunkId, args), message: 'Worker completion recorded.' });
    throw new Error(`Unknown worker action: ${args.action}`);
  }
}

class ControlServer {
  constructor({ planService, workerService, host = '127.0.0.1', port = 41000 + crypto.randomInt(20000) } = {}) { this.planService = planService; this.workerService = workerService; this.host = host; this.port = port; this.capabilities = new Map(); }
  issue(scope) { const token = crypto.randomBytes(32).toString('base64url'); this.capabilities.set(token, Object.freeze({ ...scope })); return { url: `http://${this.host}:${this.port}/rpc`, token }; }
  tools(capability) { const tools = []; if (capability.role === 'delegator') tools.push(PLAN_TOOL); if (ROLE_ACTIONS[capability.role]) tools.push(WORKERS_TOOL); return tools; }
  async dispatch(capability, name, args) { if (name === 'bdfl_plan') return this.planService.call(capability, args); if (name === 'bdfl_workers') return this.workerService.call(capability, args); throw new Error(`Unknown BDFL tool: ${name}`); }
  start() {
    if (this.server) return this;
    this.server = http.createServer((request, response) => { void this.handle(request, response); });
    this.server.on('error', (error) => { this.error = error; }); this.server.listen(this.port, this.host); return this;
  }
  async handle(request, response) {
    const token = `${request.headers.authorization || ''}`.replace(/^Bearer\s+/i, ''); const capability = this.capabilities.get(token);
    if (request.method !== 'POST' || new URL(request.url, `http://${this.host}`).pathname !== '/rpc' || !capability) { response.writeHead(401).end(JSON.stringify({ error: 'Unauthorized BDFL capability' })); return; }
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    try { const body = JSON.parse(Buffer.concat(chunks).toString('utf8')); const value = body.method === 'tools' ? { tools: this.tools(capability) } : await this.dispatch(capability, body.name, body.arguments || {}); response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(value)); }
    catch (error) { response.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: error.message })); }
  }
  close() { this.capabilities.clear(); this.server?.close(); this.server = null; }
}

async function controlRequest(url, token, body, { request = http.request, retries = 20 } = {}) {
  const target = new URL(url); let last;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try { return await new Promise((resolve, reject) => { const outgoing = request({ hostname: target.hostname, port: target.port, path: target.pathname, method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' } }, (response) => { const chunks = []; response.on('data', (chunk) => chunks.push(chunk)); response.on('end', () => { let value; try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (error) { reject(error); return; } if (response.statusCode >= 400) reject(new Error(value.error || 'BDFL control request failed')); else resolve(value); }); }); outgoing.on('error', reject); outgoing.end(JSON.stringify(body)); }); }
    catch (error) { last = error; if (attempt === retries) break; await new Promise((resolve) => setTimeout(resolve, 25)); }
  }
  throw new Error(`BDFL bridge could not initialize: ${last?.message || 'control server unavailable'}`);
}

module.exports = { PLAN_ACTIONS, WORKER_ACTIONS, ROLE_ACTIONS, PLAN_TOOL, WORKERS_TOOL, PlanService, WorkerService, ControlServer, controlRequest, nativePlan, mcpResult };
