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
    chunks: [{ id: 'build-bash-lookup', status: 'review', summary: 'Added strict validation for every argument before producing any output from the lookup script.', diff: 'diff --git a/planet.sh b/planet.sh\n--- a/planet.sh\n+++ b/planet.sh\n-previous lookup implementation that should be removed cleanly\n+replacement lookup implementation that should be added cleanly', changedPaths: ['planet.sh'], attempts: [{ sessionId: 'w' }] }]
  };
  const handlers = new Map();
  const workerWrites = [];
  const supervisor = new TerminalSupervisor(root, {
    lineage,
    store: { load: () => state, setSessionAttention() {} },
    sessions: { restore: () => ({ opened: [], errors: [] }), shutdown() {}, write(sessionId, value) { workerWrites.push([sessionId, value]); } },
    scheduler: { list: () => [execution], load: () => execution, feedback(executionId, chunkId, message, sender) { sender(executionId, chunkId, message); } },
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
  const styled = supervisor.actionPageLines();
  const redRows = styled.filter((line) => line.startsWith('\u001b[38;5;203m'));
  const greenRows = styled.filter((line) => line.startsWith('\u001b[38;5;114m'));
  assert.ok(redRows.length >= 2);
  assert.ok(greenRows.length >= 2);
  assert.ok(redRows.every((line) => line.endsWith('\u001b[0m')));
  assert.ok(greenRows.every((line) => line.endsWith('\u001b[0m')));
  assert.match(redRows[0], /-previous lookup implementation/);
  assert.match(greenRows[0], /\+replacement lookup implementation/);
  assert.ok(styled.some((line) => line === '--- a/planet.sh'));
  assert.ok(styled.some((line) => line === '+++ b/planet.sh'));
  content = plain();
  assert.match(content, /Make Bash Script \(W 1\) · Planet lookup/);
  assert.doesNotMatch(content, /build-bash-lookup|plan-private-id|execution-private-id/);
  assert.match(content, /Added strict validation for every argument\nbefore producing any output from the lookup\nscript/);
  assert.match(content, /a accept • f feedback • Esc back/);
  assert.doesNotMatch(content, /a accept · f feedback · Esc back/);

  handlers.get('data')('fFix the script');
  const feedbackLines = supervisor.actionPageLines();
  assert.ok(feedbackLines.some((line) => line === '\u001b[38;5;220mFeedback: Fix the script\u001b[0m'));
  assert.match(plain(), /Enter send • Esc cancel/);
  handlers.get('data')('\r');
  assert.deepEqual(workerWrites, [['w', '\u001b[200~Fix the script\u001b[201~'], ['w', '\r']]);
  supervisor.stop();
});
