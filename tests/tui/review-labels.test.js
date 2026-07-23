'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { Navigation, TerminalRenderer, TerminalSupervisor } = require('../../src/tui/supervisor');
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
    chunks: [{ id: 'build-bash-lookup', status: 'review', summary: 'Added strict validation for every argument before producing any output from the lookup script.', diff: ['diff --git a/planet.sh b/planet.sh', '--- a/planet.sh', '+++ b/planet.sh', '-previous lookup implementation that should be removed cleanly', '+replacement lookup implementation that should be added cleanly', ...Array.from({ length: 24 }, (_, index) => ` context line ${index + 1}`)].join('\n'), changedPaths: ['planet.sh'], attempts: [{ sessionId: 'w' }] }]
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
    output: { columns: 48, rows: 32, write() {} },
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
  assert.match(content, /↑\/↓ scroll • a accept • f feedback • Esc\nback/);
  assert.doesNotMatch(content, /a accept · f feedback · Esc back/);

  assert.equal(supervisor.topPage.detail.scroll, 0);
  handlers.get('data')('\u001b[B');
  assert.equal(supervisor.topPage.detail.scroll, 1);
  handlers.get('data')('\u001b[<65;10;5M');
  assert.equal(supervisor.topPage.detail.scroll, 4);
  handlers.get('data')('\u001b[5~');
  assert.equal(supervisor.topPage.detail.scroll, 0);

  handlers.get('data')('fFix the script');
  const feedbackLines = supervisor.actionPageLines();
  assert.ok(feedbackLines.some((line) => line === '\u001b[38;5;220mFeedback: Fix the script\u001b[0m'));
  assert.match(plain(), /Enter send • Esc cancel/);
  handlers.get('data')('\r');
  assert.deepEqual(workerWrites, [['w', '\u001b[200~Fix the script\u001b[201~'], ['w', '\r']]);
  supervisor.stop();
});

test('Review retains accepted workers only while their sessions remain open and shows their squashed diff', () => {
  const state = {
    schema: 2,
    activeWorkstreamId: 'one',
    workstreams: [{ id: 'one', status: 'active', delegatorProfile: { provider: 'claude' } }],
    sessions: [
      { id: 'd', workstreamId: 'one', role: 'delegator', paneNumber: 1, name: 'Planner', explicitlyClosed: false },
      { id: 'open', workstreamId: 'one', role: 'worker', paneNumber: 2, name: 'W 1', explicitlyClosed: false },
      { id: 'closed', workstreamId: 'one', role: 'worker', paneNumber: 3, name: 'W 2', explicitlyClosed: true },
      { id: 'waiting', workstreamId: 'one', role: 'worker', paneNumber: 4, name: 'W 3', explicitlyClosed: false },
      { id: 'question', workstreamId: 'one', role: 'worker', paneNumber: 5, name: 'W 4', attention: true, explicitlyClosed: false }
    ]
  };
  const execution = { id: 'execution', planId: 'plan', workstreamId: 'one', chunks: [
    { id: 'open-result', status: 'accepted', commit: 'head', diff: '+latest commit only', attempts: [{ sessionId: 'open', base: 'base' }] },
    { id: 'closed-result', status: 'accepted', commit: 'closed-head', attempts: [{ sessionId: 'closed', base: 'base' }] },
    { id: 'waiting-result', status: 'waiting', summary: 'Which output format should I use?', attempts: [{ sessionId: 'waiting', base: 'base' }] },
    { id: 'question-result', status: 'running', attempts: [{ sessionId: 'question', base: 'base' }] }
  ] };
  const diffs = [];
  const supervisor = new TerminalSupervisor('/tmp/bdfl-accepted-review-test', {
    store: { load: () => state },
    lineage: { list: () => [{ planId: 'plan', title: 'Plan', workstreamId: 'one', originSessionId: 'd' }] },
    sessions: {},
    scheduler: { list: () => [execution] },
    integration: {},
    bridge: {},
    git: { resultDiff(chunk) { diffs.push(chunk.id); return 'diff --git a/result b/result\n-old combined result\n+new combined result'; } }
  });
  const items = supervisor.reviewItems(state);
  assert.deepEqual(items.map((item) => item.id), ['open-result', 'waiting-result', 'question-result']);
  assert.deepEqual(diffs, ['open-result', 'waiting-result', 'question-result']);
  assert.match(items[0].diff, /new combined result/);
  assert.doesNotMatch(items[0].diff, /latest commit only/);

  supervisor.workspace = state;
  supervisor.topPage = { action: 'Review', index: 0, detail: { executionId: 'execution', id: 'open-result' } };
  const detail = supervisor.actionPageLines().join('\n').replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '');
  assert.match(detail, /Accepted • Esc back/);
  assert.doesNotMatch(detail, /a accept|f feedback/);

  supervisor.topPage.detail = { executionId: 'execution', id: 'waiting-result' };
  const question = supervisor.actionPageLines().join('\n').replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '');
  assert.match(question, /Which output format should I use\?/);
  assert.match(question, /f respond • Esc back/);
});

test('bottom bar checks only unchanged accepted workers and never combines approval with attention', () => {
  const state = {
    schema: 2,
    activeWorkstreamId: 'one',
    workstreams: [{ id: 'one', status: 'active', delegatorProfile: { provider: 'claude' } }],
    sessions: [
      { id: 'd', workstreamId: 'one', role: 'delegator', paneNumber: 1, name: 'Planner', explicitlyClosed: false },
      { id: 'accepted', workstreamId: 'one', role: 'worker', paneNumber: 2, name: 'W 1', updatedAt: '2026-07-22T12:00:00.000Z', attention: true, explicitlyClosed: false },
      { id: 'review', workstreamId: 'one', role: 'worker', paneNumber: 3, name: 'W 2', explicitlyClosed: false }
    ]
  };
  const execution = { chunks: [{ status: 'accepted', acceptedAt: '2026-07-22T12:01:00.000Z', attempts: [{ sessionId: 'accepted' }] }, { status: 'review', attempts: [{ sessionId: 'review' }] }] };
  const supervisor = new TerminalSupervisor('/tmp/bdfl-approved-worker-test', { store: { load: () => state }, lineage: { list: () => [] }, sessions: {}, scheduler: { list: () => [execution] }, integration: {}, bridge: {} });
  const decorated = supervisor.decorateWorkspace(state);
  let navigation = new Navigation(decorated);
  let plain = new TerminalRenderer().render(decorated, navigation, { columns: 100, rows: 8 }).replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '');
  assert.match(plain, /\[Planner\]-\(W 1✓\)-\(W 2\)/);
  assert.doesNotMatch(plain, /W 1✓\*/);
  assert.doesNotMatch(plain, /W 2✓/);

  decorated.sessions.find((session) => session.id === 'accepted').name = 'Approved Worker With A Long Name';
  navigation = new Navigation(decorated); navigation.selectSession('accepted');
  plain = new TerminalRenderer().render(decorated, navigation, { columns: 20, rows: 8 }).replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '');
  assert.match(plain, /\(Approved Wor…✓\)/);

  state.sessions.find((session) => session.id === 'accepted').updatedAt = '2026-07-22T12:02:00.000Z';
  let active = supervisor.decorateWorkspace(state);
  navigation = new Navigation(active); navigation.selectSession('accepted');
  plain = new TerminalRenderer().render(active, navigation, { columns: 100, rows: 8 }).replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '');
  assert.match(plain, /\(W 1✓\)/);
  assert.doesNotMatch(plain, /W 1\*/);

  state.sessions.find((session) => session.id === 'accepted').conversationAt = '2026-07-22T12:03:00.000Z';
  active = supervisor.decorateWorkspace(state);
  navigation = new Navigation(active); navigation.selectSession('accepted');
  plain = new TerminalRenderer().render(active, navigation, { columns: 100, rows: 8 }).replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '');
  assert.match(plain, /\(W 1\*\)/);
  assert.doesNotMatch(plain, /W 1✓/);
});
