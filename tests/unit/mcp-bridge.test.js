'use strict';

const test = require('node:test'); const assert = require('node:assert/strict'); const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const { LineageStore } = require('../../src/plans/store'); const { PlanService, WorkerService, ControlServer, controlRequest } = require('../../src/mcp/bridge');

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
