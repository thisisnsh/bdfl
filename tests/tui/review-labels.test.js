'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { TerminalSupervisor } = require('../../src/tui/supervisor');
const { LineageStore } = require('../../src/plans/store');

test('Review shows plan and agent names, hides internal IDs, and wraps result text', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bdfl-review-labels-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const state = {
    schema: 2,
    activeWorkstreamId: 'one',
    workstreams: [{ id: 'one', status: 'active', delegatorProfile: { provider: 'claude' }, workerProfile: { provider: 'codex' }, workerCapacity: 1 }],
    sessions: [
      { id: 'd', workstreamId: 'one', role: 'delegator', paneNumber: 1, roleSequence: 1, name: 'Make Bash Script', profile: { provider: 'claude' }, status: 'running', explicitlyClosed: false },
      { id: 'w', workstreamId: 'one', role: 'worker', paneNumber: 2, roleSequence: 1, name: 'W 1', profile: { provider: 'codex' }, status: 'running', explicitlyClosed: false }
    ]
  };
  const lineage = new LineageStore(root, { id: () => 'plan-private-id' });
  lineage.create(`<!-- bdfl-plan:{"schema":1,"title":"Planet lookup scripts"} -->
# Planet lookup scripts
<!-- bdfl-shared:start -->
## Shared decisions
One.
<!-- bdfl-shared:end -->
<!-- bdfl-chunk:{"id":"build-bash-lookup","paths":["planet.sh"],"dependsOn":[],"locks":[]} -->
## Bash lookup
### Outcome
Done.
### Implementation
Build it.
### Local validation
Test.
### Acceptance conditions
Pass.
<!-- bdfl-chunk:end -->
<!-- bdfl-global:start -->
## Global validation
Test.
<!-- bdfl-global:end -->
<!-- bdfl-plan:end -->`, { workstreamId: 'one', sessionId: 'd' });
  const execution = {
    id: 'execution-private-id',
    planId: 'plan-private-id',
    workstreamId: 'one',
    status: 'running',
    chunks: [{ id: 'build-bash-lookup', status: 'review', summary: 'Added strict validation for every argument before producing any output from the lookup script.', diff: '+done', changedPaths: ['planet.sh'], attempts: [{ sessionId: 'w' }] }]
  };
  const handlers = new Map();
  const supervisor = new TerminalSupervisor(root, {
    lineage,
    store: { load: () => state, setSessionAttention() {} },
    sessions: { restore: () => ({ opened: [], errors: [] }), shutdown() {} },
    scheduler: { list: () => [execution], load: () => execution },
    integration: {},
    bridge: { start() {}, close() {} },
    input: { on(event, fn) { handlers.set(event, fn); }, off() {}, setRawMode() {}, resume() {}, pause() {} },
    output: { columns: 48, rows: 24, write() {} },
    setInterval: () => ({ unref() {} }),
    clearInterval() {}
  });
  supervisor.acquire = () => {};
  supervisor.release = () => {};
  supervisor.start();
  supervisor.activate('Review');

  const plain = () => supervisor.actionPageLines().join('\n').replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '');
  let content = plain();
  assert.match(content, /Make Bash Script \(W 1\) · Planet lookup\n\s+scripts/);
  assert.doesNotMatch(content, /build-bash-lookup|plan-private-id|execution-private-id/);
  assert.match(content, /Added strict validation for every\n\s+argument before producing any output from\n\s+the lookup script/);

  handlers.get('data')('\r');
  content = plain();
  assert.match(content, /Make Bash Script \(W 1\) · Planet lookup/);
  assert.doesNotMatch(content, /build-bash-lookup|plan-private-id|execution-private-id/);
  assert.match(content, /Added strict validation for every argument\nbefore producing any output from the lookup\nscript/);
  supervisor.stop();
});
