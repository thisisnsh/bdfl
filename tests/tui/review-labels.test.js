'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { TerminalSupervisor } = require('../../src/tui/supervisor');
const { COLORS } = require('../../src/tui/review-view');

function fixture(overrides = {}) {
  const state = {
    activeWorkstreamId: 'one', workstreams: [{ id: 'one', status: 'active', createdAt: '2026-01-01' }],
    sessions: [
      { id: 'd', workstreamId: 'one', role: 'delegator', paneNumber: 1, name: 'Make Bash Script', profile: { provider: 'claude' }, status: 'running', explicitlyClosed: false },
      { id: 'w', workstreamId: 'one', role: 'worker', paneNumber: 2, name: 'Worker #1', profile: { provider: 'codex' }, status: 'running', explicitlyClosed: false }
    ]
  };
  const execution = { id: 'execution-private-id', planId: 'plan-private-id', workstreamId: 'one', status: 'running', chunks: [{ id: 'build-bash-lookup', status: 'review', summary: 'Added strict validation for every argument.', diff: 'diff --git a/planet.sh b/planet.sh\n--- a/planet.sh\n+++ b/planet.sh\n@@ -1 +1 @@\n-previous lookup\n+replacement lookup', attempts: [{ sessionId: 'w' }] }] };
  const handlers = new Map(); const writes = []; const feedback = [];
  const scheduler = { list: () => [execution], resume() {}, feedback(_executionId, _chunkId, payload) { feedback.push(payload); execution.chunks[0].status = 'running'; execution.chunks[0].feedback = [{ ...payload, at: 'now' }]; return execution.chunks[0]; }, ...overrides.scheduler };
  const supervisor = new TerminalSupervisor('/tmp/bdfl-review-labels', {
    store: { load: () => state, setSessionAttention() {} },
    lineage: { list: () => [{ planId: 'plan-private-id', title: 'Planet lookup scripts', workstreamId: 'one', originSessionId: 'd' }] },
    git: {}, scheduler, integration: overrides.integration || {}, bridge: { start() {}, close() {} },
    sessions: { restore: () => ({ opened: [], errors: [] }), open() {}, focus() {}, screen: () => [], shutdown() {}, write() {} },
    input: { on(event, fn) { handlers.set(event, fn); }, off() {}, setRawMode() {}, resume() {}, pause() {} },
    output: { columns: overrides.columns || 48, rows: overrides.rows || 28, write(value) { writes.push(value); } }, setInterval: () => ({ unref() {} }), clearInterval() {}
  });
  supervisor.acquire = () => {}; supervisor.release = () => {}; return { supervisor, handlers, writes, feedback, execution, state };
}

test('Review uses human plan and agent labels while hiding internal IDs', () => {
  const { supervisor, handlers } = fixture(); supervisor.start(); supervisor.activate('Review'); handlers.get('data')('\r');
  const plain = supervisor.actionPageLines().join('\n').replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '');
  assert.match(plain, /Make Bash Script \(Worker #1\) · Planet lookup\n\s*scripts/);
  assert.match(plain, /Added strict validation for every argument/);
  assert.doesNotMatch(plain, /build-bash-lookup|plan-private-id|execution-private-id/);
  supervisor.stop();
});

test('Review retains durable accepted workers and shows their squashed diff', () => {
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
  assert.deepEqual(items.map((item) => item.id), ['open-result', 'closed-result', 'waiting-result', 'question-result']);
  assert.deepEqual(diffs, ['open-result', 'closed-result', 'waiting-result', 'question-result']);
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
  assert.match(question, /Waiting for response/);
  assert.match(question, /f feedback • Esc back/);

  supervisor.topPage.detail = { executionId: 'execution', id: 'question-result' };
  const attention = supervisor.actionPageLines().join('\n').replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '');
  assert.match(attention, /Needs response/);
  assert.match(attention, /f feedback • Esc back/);
});

test('Review can accept or amend verifier remedies and keeps override separate', () => {
  const state = {
    schema: 2,
    activeWorkstreamId: 'one',
    workstreams: [{ id: 'one', status: 'active', delegatorProfile: { provider: 'claude' } }],
    sessions: [{ id: 'd', workstreamId: 'one', role: 'delegator', paneNumber: 1, name: 'Planner', explicitlyClosed: false }]
  };
  const execution = { id: 'execution', planId: 'plan', workstreamId: 'one', status: 'verification-failed', verification: { state: 'fail', summary: 'Tests failed' }, integration: { finalDiff: '+result', checkResults: [] }, chunks: [] };
  const handlers = new Map();
  const finalized = [];
  const remedies = [];
  const supervisor = new TerminalSupervisor('/tmp/bdfl-override-review-test', {
    store: { load: () => state, setSessionAttention() {} },
    lineage: { list: () => [{ planId: 'plan', title: 'Plan', workstreamId: 'one', originSessionId: 'd' }] },
    sessions: { restore: () => ({ opened: [], errors: [] }), shutdown() {} },
    scheduler: { list: () => [execution], resume() {} },
    integration: { finalize(...args) { finalized.push(args); }, remedy(...args) { remedies.push(args); } },
    bridge: { start() {}, close() {} },
    input: { on(event, fn) { handlers.set(event, fn); }, off() {}, setRawMode() {}, resume() {}, pause() {} },
    output: { columns: 80, rows: 22, write() {} },
    setInterval: () => ({ unref() {} }),
    clearInterval() {}
  });
  supervisor.acquire = () => {};
  supervisor.release = () => {};
  supervisor.start();
  supervisor.activate('Review');
  handlers.get('data')('\r');
  assert.match(supervisor.actionPageLines().join('\n'), /r accept remedies/);
  assert.match(supervisor.actionPageLines().join('\n'), /f suggest repair/);
  assert.match(supervisor.actionPageLines().join('\n'), /o override/);
  handlers.get('data')('r');
  assert.match(supervisor.actionPageLines().join('\n'), /Continue the execution agent with the accepted verifier remedies/);
  assert.deepEqual(remedies, []);
  handlers.get('data')('\r');
  assert.deepEqual(remedies, [['execution']]);
  supervisor.activate('Review'); handlers.get('data')('\r'); handlers.get('data')('fPreserve the active terminal\r');
  assert.deepEqual(remedies, [['execution'], ['execution', 'Preserve the active terminal']]);
  supervisor.activate('Review'); handlers.get('data')('\r');
  handlers.get('data')('o');
  assert.match(supervisor.actionPageLines().join('\n'), /Override failed global verification/);
  assert.deepEqual(finalized, []);
  handlers.get('data')('\r');
  assert.deepEqual(finalized, [['execution', {}, { override: true }]]);
  supervisor.stop();
});

test('Review colors file metadata, hunks, removals, and additions through narrow wrapping', () => {
  const { supervisor, handlers } = fixture({ columns: 30 }); supervisor.start(); supervisor.activate('Review'); handlers.get('data')('\r');
  const lines = supervisor.actionPageLines();
  assert.ok(lines.some((line) => line.startsWith(COLORS.blue)));
  assert.ok(lines.some((line) => line.startsWith(COLORS.cyan) && line.includes('@@')));
  assert.ok(lines.some((line) => line.startsWith(COLORS.red) && line.includes('-previous')));
  assert.ok(lines.some((line) => line.startsWith(COLORS.green) && line.includes('+replacement')));
  supervisor.stop();
});

test('Review mouse selections are additive and every ordered excerpt is sent with feedback', () => {
  const { supervisor, handlers, feedback } = fixture({ columns: 60, rows: 34 }); supervisor.start(); supervisor.activate('Review'); handlers.get('data')('\r'); supervisor.draw();
  let frame = supervisor.reviewView.lastFrame; const removal = frame.rows.find((row) => row.patch && row.sourceLine === 5); const addition = frame.rows.find((row) => row.patch && row.sourceLine === 6);
  handlers.get('data')(`\u001b[<0;4;${removal.screenRow}M\u001b[<32;4;${addition.screenRow}M\u001b[<0;4;${addition.screenRow}m`);
  frame = supervisor.reviewView.lastFrame; const hunk = frame.rows.find((row) => row.patch && row.sourceLine === 4);
  handlers.get('data')(`\u001b[<0;4;${hunk.screenRow}M\u001b[<0;4;${hunk.screenRow}m`);
  handlers.get('data')('fFix both\r');
  assert.equal(feedback[0].message, 'Fix both'); assert.deepEqual(feedback[0].selections.map(({ startLine, endLine }) => [startLine, endLine]), [[5, 6], [4, 4]]);
  assert.ok(supervisor.topPage.detail); supervisor.stop();
});

test('Review exposes selection removal controls and omits removed ranges from feedback', () => {
  const { supervisor, handlers, feedback } = fixture({ columns: 60, rows: 34 }); supervisor.start(); supervisor.activate('Review'); handlers.get('data')('\r'); supervisor.draw();
  let frame = supervisor.reviewView.lastFrame; const removal = frame.rows.find((row) => row.patch && row.sourceLine === 5); const addition = frame.rows.find((row) => row.patch && row.sourceLine === 6);
  handlers.get('data')(`\u001b[<0;4;${removal.screenRow}M\u001b[<32;4;${addition.screenRow}M\u001b[<0;4;${addition.screenRow}m`);
  frame = supervisor.reviewView.lastFrame; const hunk = frame.rows.find((row) => row.patch && row.sourceLine === 4);
  handlers.get('data')(`\u001b[<0;4;${hunk.screenRow}M\u001b[<0;4;${hunk.screenRow}m`);
  let plain = supervisor.actionPageLines().join('\n').replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '');
  assert.match(plain, /u remove last\s+selection/); assert.match(plain, /c clear selections/);
  handlers.get('data')('u'); assert.deepEqual(supervisor.reviewView.selections().map(({ startLine, endLine }) => [startLine, endLine]), [[5, 6]]);
  handlers.get('data')('fFix replacement\r'); assert.deepEqual(feedback[0].selections.map(({ startLine, endLine }) => [startLine, endLine]), [[5, 6]]);
  assert.equal(feedback[0].selections.some(({ startLine }) => startLine === 4), false);
  supervisor.stop();

  const cleared = fixture({ columns: 60, rows: 34 }); cleared.supervisor.start(); cleared.supervisor.activate('Review'); cleared.handlers.get('data')('\r'); cleared.supervisor.draw();
  frame = cleared.supervisor.reviewView.lastFrame; const selected = frame.rows.find((row) => row.patch && row.sourceLine === 5);
  cleared.handlers.get('data')(`\u001b[<0;4;${selected.screenRow}M\u001b[<0;4;${selected.screenRow}m`); cleared.handlers.get('data')('c');
  assert.deepEqual(cleared.supervisor.reviewView.selections(), []); cleared.handlers.get('data')('fNo excerpt\r'); assert.deepEqual(cleared.feedback[0].selections, []); cleared.supervisor.stop();
});

test('Review scrolling is bounded after wheel, page, width, and status changes', () => {
  const { supervisor, handlers, execution } = fixture({ columns: 32, rows: 16 }); execution.chunks[0].diff += `\n${Array.from({ length: 30 }, (_, index) => ` context ${index}`).join('\n')}`;
  supervisor.start(); supervisor.activate('Review'); handlers.get('data')('\r'); handlers.get('data')('\u001b[6~\u001b[6~'); assert.ok(supervisor.reviewView.state().scroll <= supervisor.reviewView.maximumScroll());
  handlers.get('data')('\u001b[<65;10;8M'); assert.ok(supervisor.reviewView.state().scroll <= supervisor.reviewView.maximumScroll());
  execution.chunks[0].status = 'accepted'; execution.chunks[0].diff = '+short'; supervisor.draw(); assert.equal(supervisor.reviewView.state().scroll, supervisor.reviewView.maximumScroll()); supervisor.stop();
});
