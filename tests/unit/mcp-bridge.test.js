'use strict';

const test = require('node:test'); const assert = require('node:assert/strict'); const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path'); const { PassThrough } = require('node:stream');
const { LineageStore } = require('../../src/plans/store'); const { PlanService, WorkerService, ControlServer, ControlApplicationError, controlRequest } = require('../../src/mcp/bridge'); const { BridgeProxy } = require('../../src/mcp/proxy'); const { main: proxyMain } = require('../../bin/bdfl-mcp'); const { atomicWrite } = require('../../src/core/plans');

function source() { return `<!-- bdfl-plan:{"schema":1,"title":"Bridge"} -->
# Bridge
<!-- bdfl-shared:start -->
## Shared decisions
Keep the bridge local.
<!-- bdfl-shared:end -->
<!-- bdfl-chunk:{"id":"bridge","paths":["src/mcp/**"],"dependsOn":[],"locks":[],"checks":[["node","--test","tests/unit/mcp-bridge.test.js"]]} -->
## Bridge
### Outcome
Publish through BDFL.
### Implementation
Implement the bridge.
### Local validation
Run the approved argv check.
### Acceptance conditions
The bridge is authenticated.
<!-- bdfl-chunk:end -->
<!-- bdfl-global:{"checks":[["npm","test"]]} -->
## Global validation
Run the full suite.
<!-- bdfl-global:end -->
<!-- bdfl-plan:end -->`;
}

test('publishes idempotently within a bound workstream and rejects cross-role plan writes', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bdfl-mcp-plan-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const lineage = new LineageStore(root, { id: () => 'plan-one', now: () => new Date('2026-01-01') }); const service = new PlanService(lineage); const delegator = { role: 'delegator', sessionId: 'd', workstreamId: 'w' };
  const first = service.call(delegator, { action: 'publish', source: source() }).structuredContent; const retry = service.call(delegator, { action: 'publish', source: source() }).structuredContent;
  assert.deepEqual([first.planId, first.version, first.duplicate], ['plan-one', 1, false]); assert.equal(retry.duplicate, true); assert.equal(lineage.load('plan-one').workstreamId, 'w'); assert.deepEqual(lineage.readManifest('plan-one', 1).globalValidation.checks, [['npm', 'test']]);
  assert.throws(() => service.call({ role: 'worker', sessionId: 'x', workstreamId: 'w' }, { action: 'publish', source: source() }), /Only a delegator/);
  const revision = service.call(delegator, { action: 'current', detail: 'revision' }).structuredContent; assert.equal(revision.sections[0].kind, 'shared'); assert.match(revision.sections[1].body, /Implement the bridge/); assert.deepEqual(revision.sections[1].checks, [['node', '--test', 'tests/unit/mcp-bridge.test.js']]);
});

test('enforces role-scoped worker actions before calling the scheduler', async () => {
  const calls = []; const scheduler = { load: () => ({ workstreamId: 'w' }), status: () => ({ status: 'running' }), complete(...args) { calls.push(args); return { id: 'chunk' }; } }; const service = new WorkerService({ scheduler });
  await assert.rejects(service.call({ role: 'worker', workstreamId: 'w', executionId: 'e', chunkId: 'chunk' }, { action: 'execute', planId: 'p', version: 1 }), /cannot use/);
  await service.call({ role: 'worker', workstreamId: 'w', executionId: 'e', chunkId: 'chunk' }, { action: 'complete', state: 'pass' }); assert.equal(calls[0][1], 'chunk');
  await assert.rejects(service.call({ role: 'worker', workstreamId: 'w', executionId: 'e', chunkId: 'chunk' }, { action: 'complete', executionId: 'other', state: 'pass' }), /different execution/);
});

test('authenticates loopback bridge requests and exposes only role tools', async (t) => {
  const server = new ControlServer({ planService: { call() {} }, workerService: { call() {} } }).start(); t.after(() => server.close()); const issued = server.issue({ role: 'worker', sessionId: 's', workstreamId: 'w' });
  const listed = await controlRequest(issued.url, issued.token, { method: 'tools' }); assert.deepEqual(listed.tools.map((tool) => tool.name), ['bdfl_workers']);
  await assert.rejects(controlRequest(issued.url, 'wrong-token', { method: 'tools' }, { retries: 0 }), /Unauthorized/);
});

test('capability rotation removes stale proxies without losing a healthy replacement', () => {
  const lost = []; const server = new ControlServer({ planService: {}, workerService: {}, heartbeatTimeout: 100, onProxyLost: (...args) => lost.push(args) }); const capability = { sessionId: 'session', workstreamId: 'workstream' };
  server.proxies.set('old', { capability, lastSeen: 0, registeredAt: 0 }); server.issue(capability); assert.equal(server.proxies.size, 0);
  server.proxies.set('stale', { capability, lastSeen: 0, registeredAt: 0 }); server.proxies.set('healthy', { capability, lastSeen: 150, registeredAt: 100 }); server.checkHeartbeats(200); assert.deepEqual([...server.proxies.keys()], ['healthy']); assert.deepEqual(lost, []);
  server.checkHeartbeats(251); assert.equal(server.proxies.size, 0); assert.equal(lost.length, 1); assert.equal(lost[0][0], 'session');
});

function responses(stream) { const values = []; let buffer = ''; stream.on('data', (chunk) => { buffer += chunk; let newline; while ((newline = buffer.indexOf('\n')) >= 0) { values.push(JSON.parse(buffer.slice(0, newline))); buffer = buffer.slice(newline + 1); } }); return values; }
async function next(values, count) { for (let attempt = 0; attempt < 100 && values.length < count; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 5)); return values[count - 1]; }

test('keeps one MCP stdio process alive after an approved-section publication error', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bdfl-mcp-regression-')); t.after(() => fs.rmSync(root, { recursive: true, force: true })); const lineage = new LineageStore(root, { id: () => 'multiply-numbers', now: () => new Date('2026-01-01') }); const server = new ControlServer({ planService: new PlanService(lineage), workerService: { call() {} } }).start(); t.after(() => server.close()); const scope = server.issue({ role: 'delegator', sessionId: 'planning', workstreamId: 'multiply' }); const descriptor = path.join(root, '.bdfl', 'sessions', 'planning', 'capability.json'); atomicWrite(descriptor, `${JSON.stringify(scope)}\n`); fs.chmodSync(descriptor, 0o600); const input = new PassThrough(); const output = new PassThrough(); const values = responses(output); const lines = await proxyMain({ input, output, descriptor }); t.after(() => { lines.close(); input.end(); });
  const call = async (id, name, args) => { input.write(`${JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } })}\n`); return next(values, id); };
  input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })}\n`); await next(values, 1); await call(2, 'bdfl_plan', { action: 'publish', source: source() }); lineage.approve('multiply-numbers', 1, 'shared'); const patch = '<!-- bdfl-plan-patch:{"schema":1,"planId":"multiply-numbers","baseVersion":1} -->\n<!-- bdfl-shared:start -->\n## Shared decisions\nChanged.\n<!-- bdfl-shared:end -->\n<!-- bdfl-plan-patch:end -->'; const failed = await call(3, 'bdfl_plan', { action: 'publish', source: patch, planId: 'multiply-numbers' }); assert.match(failed.error.message, /Remove approval/); assert.equal(input.writableEnded, false); lineage.removeApproval('multiply-numbers', 1, 'shared'); const current = await call(4, 'bdfl_plan', { action: 'current', detail: 'revision' }); assert.equal(current.result.structuredContent.version, 1); const published = await call(5, 'bdfl_plan', { action: 'publish', source: patch, planId: 'multiply-numbers' }); assert.equal(published.result.structuredContent.version, 2); assert.equal(input.writableEnded, false);
});

test('reloads an atomically rotated endpoint descriptor after connection loss', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bdfl-mcp-rotate-')); t.after(() => fs.rmSync(root, { recursive: true, force: true })); const descriptor = path.join(root, '.bdfl', 'capability.json'); const scope = { role: 'worker', sessionId: 's', workstreamId: 'w' }; const first = new ControlServer({ planService: {}, workerService: {} }).start(); const firstCapability = first.issue(scope); atomicWrite(descriptor, `${JSON.stringify(firstCapability)}\n`); fs.chmodSync(descriptor, 0o600); const proxy = new BridgeProxy(descriptor, { heartbeatInterval: 100000 }); t.after(() => proxy.close()); await proxy.initialize(); first.close(); const second = new ControlServer({ planService: {}, workerService: {} }).start(); t.after(() => second.close()); const secondCapability = second.issue(scope); atomicWrite(descriptor, `${JSON.stringify(secondCapability)}\n`); fs.chmodSync(descriptor, 0o600); const listed = await proxy.call({ method: 'tools' }); assert.deepEqual(listed.tools.map((tool) => tool.name), ['bdfl_workers']);
});

test('classifies HTTP application failures as nonretryable', async (t) => { const server = new ControlServer({ planService: { call() { throw new Error('ordinary tool failure'); } }, workerService: {} }).start(); t.after(() => server.close()); const issued = server.issue({ role: 'delegator', sessionId: 's', workstreamId: 'w' }); await assert.rejects(controlRequest(issued.url, issued.token, { method: 'call', name: 'bdfl_plan', arguments: { action: 'current' } }, { retries: 20 }), (error) => error instanceof ControlApplicationError && error.retryable === false); });

test('isolates malformed JSON-RPC messages and fails initial missing configuration strictly', async (t) => { const input = new PassThrough(); const output = new PassThrough(); const values = responses(output); const proxy = { descriptor: { load() {} }, async call() { return { tools: [] }; }, async initialize() { return { tools: [] }; }, close() {} }; const lines = await proxyMain({ input, output, proxy }); t.after(() => { lines.close(); input.end(); }); input.write('{broken\n'); await next(values, 1); assert.equal(values[0].error.code, -32700); input.write('{"jsonrpc":"2.0","id":1,"method":"tools/list"}\n'); await next(values, 2); assert.deepEqual(values[1].result, { tools: [] }); assert.equal(input.writableEnded, false); await assert.rejects(proxyMain({ input: new PassThrough(), output: new PassThrough(), descriptor: null }), /descriptor is required/); });
