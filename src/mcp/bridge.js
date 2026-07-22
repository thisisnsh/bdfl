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

const PLAN_TOOL = { name: 'bdfl_plan', title: 'Publish a durable BDFL plan', description: 'Read or publish the marker-bearing plan for this BDFL workstream.', inputSchema: { type: 'object', properties: { action: { type: 'string', enum: PLAN_ACTIONS }, detail: { type: 'string', enum: ['summary', 'revision'] }, source: { type: 'string' }, planId: { type: 'string' }, convert: { type: 'boolean' } }, required: ['action'], additionalProperties: false } };
const WORKERS_TOOL = { name: 'bdfl_workers', title: 'Coordinate BDFL-managed workers', description: 'Execute and monitor an approved BDFL plan without provider-native delegation.', inputSchema: { type: 'object', properties: { action: { type: 'string', enum: WORKER_ACTIONS }, planId: { type: 'string' }, version: { type: 'integer' }, executionId: { type: 'string' }, chunkId: { type: 'string' }, cursor: { type: 'integer' }, state: { type: 'string', enum: ['pass', 'blocked', 'fail'] }, summary: { type: 'string', maxLength: 800 }, affectedChunkIds: { type: 'array', items: { type: 'string' } }, message: { type: 'string', maxLength: 800 } }, required: ['action'], additionalProperties: false } };

function mcpResult(value) { return { content: [{ type: 'text', text: value.message || 'BDFL state updated.' }], structuredContent: value }; }
function sectionLabel(id) { if (id === 'shared') return 'Shared'; if (id === 'global-validation') return 'Global validation'; return id; }
function nativePlan(source) {
  const body = `${source || ''}`.trim(); if (!body) throw new Error('Native plan source is required for conversion');
  const title = (body.match(/^#\s+(.+)$/mu)?.[1] || 'Converted native plan').replace(/-->|[\u0000-\u001f]/gu, '').trim() || 'Converted native plan';
  return `<!-- bdfl-plan:${JSON.stringify({ schema: 1, title })} -->\n# ${title}\n<!-- bdfl-shared:start -->\n## Shared decisions\nThis plan was explicitly converted from a provider-native plan.\n<!-- bdfl-shared:end -->\n<!-- bdfl-chunk:${JSON.stringify({ id: 'native-plan', paths: ['**'], dependsOn: [], locks: [], checks: [] })} -->\n## Implement converted native plan\n### Outcome\nComplete the adopted native plan.\n### Implementation\n${body}\n### Local validation\nRun the checks described by the adopted plan.\n### Acceptance conditions\nThe adopted plan is implemented and its stated validation passes.\n<!-- bdfl-chunk:end -->\n<!-- bdfl-global:${JSON.stringify({ checks: [] })} -->\n## Global validation\nReview the combined result against the adopted native plan.\n<!-- bdfl-global:end -->\n<!-- bdfl-plan:end -->\n`;
}

class PlanService {
  constructor(lineage) { this.lineage = lineage; }
  call(capability, args) {
    if (capability.role !== 'delegator') throw new Error('Only a delegator can access durable plans');
    if (args.action === 'current') {
      const current = this.lineage.current({ workstreamId: capability.workstreamId }); if (!current) return mcpResult({ plan: null, message: 'No BDFL plan has been published for this workstream.' });
      const manifest = this.lineage.readManifest(current.planId, current.currentVersion); const sections = [manifest.shared, ...manifest.chunks, manifest.globalValidation]; const approvals = Object.fromEntries(sections.map((section) => [section.id, manifest.approvals[section.id]?.sectionSha === section.sha]));
      const base = { planId: current.planId, version: current.currentVersion, title: current.title, approved: Object.values(approvals).filter(Boolean).length, sectionCount: sections.length, approvals };
      if ((args.detail || 'summary') === 'revision') base.sections = sections.map((section) => ({ id: section.id, kind: section.id === 'shared' ? 'shared' : section.id === 'global-validation' ? 'global-validation' : 'chunk', sha: section.sha, approved: approvals[section.id], body: this.lineage.readSection(current.planId, current.currentVersion, section.id), paths: section.paths || [], dependsOn: section.dependsOn || [], locks: section.locks || [], checks: section.checks || [] }));
      return mcpResult({ ...base, message: `Current plan is v${current.currentVersion}; ${base.approved}/${base.sectionCount} approval sections approved.` });
    }
    if (args.action !== 'publish') throw new Error(`Unknown plan action: ${args.action}`);
    let source = args.source; if (args.convert && !/<!--\s*bdfl-plan(?::|-patch:)/.test(source || '')) source = nativePlan(source);
    if (!/<!--\s*bdfl-plan(?::|-patch:)/.test(source || '')) throw new Error('Plan publication requires BDFL markers; use convert only after an explicit user request');
    const published = this.lineage.publish(source, { planId: args.planId, workstreamId: capability.workstreamId, sessionId: capability.sessionId });
    const changed = published.changedSections || []; const preserved = published.preservedSections || []; const preservedApprovals = published.preservedApprovals || []; let message;
    if (published.duplicate) message = `Reused v${published.manifest.version}.`;
    else if (published.manifest.version === 1) message = 'Published v1.';
    else message = `Published v${published.manifest.version}; changed ${changed.map(sectionLabel).join(', ') || 'no sections'}${preserved.length ? `; preserved ${preserved.map(sectionLabel).join(', ')}` : ''}.`;
    return mcpResult({ planId: published.lineage.planId, version: published.manifest.version, duplicate: Boolean(published.duplicate), sourceSha: sha256(source), changedSections: changed, preservedSections: preserved, preservedApprovals, message });
  }
}

class WorkerService {
  constructor({ scheduler, integration, sender } = {}) { this.scheduler = scheduler; this.integration = integration; this.sender = sender; }
  assert(capability, args) { if (!ROLE_ACTIONS[capability.role]?.has(args.action)) throw new Error(`${capability.role} cannot use worker action ${args.action}`); if (capability.executionId && args.executionId && capability.executionId !== args.executionId) throw new Error('Capability belongs to a different execution'); if (capability.chunkId && args.chunkId && capability.chunkId !== args.chunkId) throw new Error('Capability belongs to a different chunk'); }
  async call(capability, args) {
    this.assert(capability, args);
    if (args.action === 'execute') { const execution = this.scheduler.freeze(args.planId, args.version, capability.workstreamId); return mcpResult({ executionId: execution.id, duplicate: Boolean(execution.duplicate), workload: execution.workload, message: execution.duplicate ? `Execution for v${execution.version} already exists.` : `Execution v${execution.version} started: ${execution.workload.implementationWorkers} implementation worker${execution.workload.implementationWorkers === 1 ? '' : 's'} + 1 verifier · max ${execution.capacity} concurrent.` }); }
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
  constructor({ planService, workerService, host = '127.0.0.1', port = 41000 + crypto.randomInt(20000), heartbeatTimeout = 15000, heartbeatCheck = 5000, onProxyLost = null } = {}) { this.planService = planService; this.workerService = workerService; this.host = host; this.port = port; this.heartbeatTimeout = heartbeatTimeout; this.heartbeatCheck = heartbeatCheck; this.onProxyLost = onProxyLost; this.capabilities = new Map(); this.proxies = new Map(); }
  setProxyLossHandler(handler) { this.onProxyLost = handler; return this; }
  setProxyRegistrationHandler(handler) { this.onProxyRegistered = handler; return this; }
  issue(scope) { for (const [existing, capability] of this.capabilities) if (capability.sessionId === scope.sessionId) this.capabilities.delete(existing); for (const [proxyId, proxy] of this.proxies) if (proxy.capability.sessionId === scope.sessionId) this.proxies.delete(proxyId); const token = crypto.randomBytes(32).toString('base64url'); this.capabilities.set(token, Object.freeze({ ...scope })); return { schema: 1, url: `http://${this.host}:${this.port}/rpc`, token, scope: { ...scope }, issuedAt: new Date().toISOString() }; }
  tools(capability) { const tools = []; if (capability.role === 'delegator') tools.push(PLAN_TOOL); if (ROLE_ACTIONS[capability.role]) tools.push(WORKERS_TOOL); return tools; }
  async dispatch(capability, name, args) { if (name === 'bdfl_plan') return this.planService.call(capability, args); if (name === 'bdfl_workers') return this.workerService.call(capability, args); throw new Error(`Unknown BDFL tool: ${name}`); }
  start() {
    if (this.server) return this;
    this.server = http.createServer((request, response) => { void this.handle(request, response); });
    this.server.on('error', (error) => { this.error = error; }); this.server.listen(this.port, this.host); this.heartbeatTimer = setInterval(() => this.checkHeartbeats(), this.heartbeatCheck); this.heartbeatTimer.unref?.(); return this;
  }
  checkHeartbeats(now = Date.now()) { const expired = []; for (const [proxyId, proxy] of this.proxies) if (now - proxy.lastSeen > this.heartbeatTimeout) { this.proxies.delete(proxyId); expired.push([proxyId, proxy]); } const reported = new Set(); for (const [proxyId, proxy] of expired) { const sessionId = proxy.capability.sessionId; const replacement = [...this.proxies.values()].some((candidate) => candidate.capability.sessionId === sessionId && now - candidate.lastSeen <= this.heartbeatTimeout); if (!replacement && !reported.has(sessionId)) { reported.add(sessionId); this.onProxyLost?.(sessionId, { proxyId, lastSeen: proxy.lastSeen }); } } }
  async handle(request, response) {
    const token = `${request.headers.authorization || ''}`.replace(/^Bearer\s+/i, ''); const capability = this.capabilities.get(token);
    if (request.method !== 'POST' || new URL(request.url, `http://${this.host}`).pathname !== '/rpc' || !capability) { response.writeHead(401).end(JSON.stringify({ error: 'Unauthorized BDFL capability' })); return; }
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    try { const body = JSON.parse(Buffer.concat(chunks).toString('utf8')); let value; if (body.method === 'tools') value = { tools: this.tools(capability) }; else if (body.method === 'proxy.register' || body.method === 'proxy.heartbeat') { if (typeof body.proxyId !== 'string' || !body.proxyId) throw new Error('proxyId is required'); const previous = this.proxies.get(body.proxyId); this.proxies.set(body.proxyId, { capability, lastSeen: Date.now(), registeredAt: previous?.registeredAt || Date.now(), lost: false }); if (body.method === 'proxy.register' && (!previous || previous.capability !== capability)) this.onProxyRegistered?.(capability.sessionId, { proxyId: body.proxyId }); value = { registered: true }; } else value = await this.dispatch(capability, body.name, body.arguments || {}); response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(value)); }
    catch (error) { response.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: error.message })); }
  }
  close() { this.capabilities.clear(); this.proxies.clear(); if (this.heartbeatTimer) clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; this.server?.close(); this.server = null; }
}

class ControlApplicationError extends Error { constructor(message, statusCode) { super(message); this.name = 'ControlApplicationError'; this.statusCode = statusCode; this.retryable = false; } }
function transportError(error) { return !(error instanceof ControlApplicationError) && ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'ENOTFOUND'].includes(error?.code) || error?.name === 'TimeoutError'; }
async function controlRequest(url, token, body, { request = http.request, retries = 20 } = {}) {
  const target = new URL(url); let last;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try { return await new Promise((resolve, reject) => { const outgoing = request({ hostname: target.hostname, port: target.port, path: target.pathname, method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' } }, (response) => { const chunks = []; response.on('data', (chunk) => chunks.push(chunk)); response.on('end', () => { let value; try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (error) { reject(error); return; } if (response.statusCode >= 400) reject(new ControlApplicationError(value.error || 'BDFL control request failed', response.statusCode)); else resolve(value); }); }); outgoing.on('error', reject); outgoing.setTimeout?.(2000, () => { const error = new Error('BDFL control request timed out'); error.code = 'ETIMEDOUT'; outgoing.destroy(error); }); outgoing.end(JSON.stringify(body)); }); }
    catch (error) { last = error; if (!transportError(error) || attempt === retries) break; await new Promise((resolve) => setTimeout(resolve, Math.min(400, 25 * 2 ** attempt))); }
  }
  throw last || new Error('BDFL control server unavailable');
}

module.exports = { PLAN_ACTIONS, WORKER_ACTIONS, ROLE_ACTIONS, PLAN_TOOL, WORKERS_TOOL, PlanService, WorkerService, ControlServer, ControlApplicationError, transportError, controlRequest, nativePlan, mcpResult };
