'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Navigation, TerminalRenderer, TerminalSupervisor, availableActions, executionStateLabel } = require('../../src/tui/supervisor');
const { stripAnsi } = require('../../src/tui/chrome');

function workspace() {
  return {
    schema: 2,
    activeWorkstreamId: 'one',
    workstreams: [
      { id: 'one', status: 'active', createdAt: '2026-01-01T00:00:00.000Z', delegatorProfile: { provider: 'claude' } },
      { id: 'two', status: 'active', createdAt: '2026-01-02T00:00:00.000Z', delegatorProfile: { provider: 'codex' } }
    ],
    sessions: [
      { id: 'd', workstreamId: 'one', role: 'delegator', paneNumber: 1, name: 'Planner', profile: { provider: 'claude' }, status: 'running', explicitlyClosed: false, activityAt: '2026-01-01T00:00:00.000Z', viewedAt: '2026-01-01T00:00:00.000Z' },
      { id: 'w', workstreamId: 'one', role: 'worker', paneNumber: 2, name: 'Worker #1', profile: { provider: 'codex' }, status: 'running', explicitlyClosed: false, activityAt: '2026-01-02T00:00:00.000Z' },
      { id: 'v', workstreamId: 'one', role: 'verifier', paneNumber: 3, name: 'Verifier #1', profile: { provider: 'codex' }, status: 'completed', explicitlyClosed: false },
      { id: 'c', workstreamId: 'two', role: 'direct', paneNumber: 1, name: 'Direct', profile: { provider: 'codex' }, status: 'running', explicitlyClosed: false }
    ]
  };
}

function harness(state, overrides = {}) {
  const handlers = new Map(); const writes = []; const opened = []; const viewed = []; const paused = [];
  const input = { on(event, handler) { handlers.set(event, handler); }, off() {}, setRawMode() {}, resume() {}, pause() {} };
  const sessions = {
    restore: () => ({ opened: [], errors: [] }),
    open(id) { opened.push(id); },
    resume(id) { opened.push(id); const session = state.sessions.find((item) => item.id === id); session.explicitlyClosed = false; session.status = 'running'; },
    pause(id) { paused.push(id); const session = state.sessions.find((item) => item.id === id); session.explicitlyClosed = true; session.status = 'paused'; },
    focus(id) { viewed.push(id); const session = state.sessions.find((item) => item.id === id); if (session) session.viewedAt = '2026-01-03T00:00:00.000Z'; },
    write() {}, screen: () => [], shutdown() {}, ...overrides.sessions
  };
  const store = {
    load: () => state,
    activateWorkstream(id) { state.activeWorkstreamId = id; },
    setSessionAttention() {},
    pauseSession(id) { const session = state.sessions.find((item) => item.id === id); session.explicitlyClosed = true; session.status = 'paused'; },
    ...overrides.store
  };
  const supervisor = new TerminalSupervisor('/tmp/bdfl-supervisor-test', {
    store, sessions, lineage: overrides.lineage || { list: () => [] }, git: overrides.git || {},
    scheduler: overrides.scheduler || { list: () => [], resume() {} }, integration: overrides.integration || {}, bridge: overrides.bridge || { start() {}, close() {} },
    input, output: { columns: overrides.columns || 100, rows: overrides.rows || 22, write(value) { writes.push(value); } },
    linkOpener: overrides.linkOpener, setInterval: overrides.setInterval || (() => ({ unref() {} })), clearInterval: overrides.clearInterval || (() => {}),
    setTimeout: overrides.setTimeout, clearTimeout: overrides.clearTimeout
  });
  supervisor.acquire = () => {}; supervisor.release = () => {};
  return { supervisor, handlers, writes, opened, viewed, paused };
}

function click(handlers, hit, final = 'M') { handlers.get('data')(`\u001b[<0;${hit.start};${hit.row}${final}`); }
function clickContent(handlers, hit, final = 'M') { handlers.get('data')(`\u001b[<0;${hit.start + 2};${hit.row + 2}${final}`); }

test('chrome renders the session title and creation-stable open agent tabs', () => {
  const state = workspace(); const navigation = new Navigation(state); navigation.selectSession('w');
  const renderer = new TerminalRenderer({ version: '1.2.3' }); const output = renderer.render(state, navigation, { columns: 100, rows: 12, content: ['Plans'] }); const layout = renderer.lastLayout; const plain = stripAnsi(output);
  assert.deepEqual(layout.parents, []);
  assert.deepEqual(layout.children.map((item) => item.sessionId), ['c', 'd', 'w']);
  assert.equal(layout.children.find((item) => item.sessionId === 'w').state, 'active');
  assert.match(plain, /bdfl - Planner.*\[Star\].*\[Report issues\].*\[New\].*\[Plans\].*\[Sessions\].*\[Reviews\].*\[Close\]/);
  assert.match(plain.split('\n')[1], /^│ Plans/);
  assert.doesNotMatch(plain, /Quit|\*|✓/);
});

test('native action and child highlights are exclusive across redraws', () => {
  const state = workspace(); const navigation = new Navigation(state); navigation.selectSession('w'); navigation.activeAction = 'Reviews';
  const renderer = new TerminalRenderer(); renderer.render(state, navigation, { columns: 90, rows: 12 });
  assert.equal(renderer.lastLayout.actions.find((item) => item.action === 'Reviews').state, 'active');
  assert.equal(renderer.lastLayout.children.some((item) => item.state === 'active'), false);
  navigation.activeAction = null; renderer.render(state, navigation, { columns: 90, rows: 12 });
  assert.equal(renderer.lastLayout.actions.some((item) => item.state === 'active'), false);
  assert.equal(renderer.lastLayout.children.find((item) => item.sessionId === 'w').state, 'active');
  assert.deepEqual(availableActions(state), ['New', 'Plans', 'Sessions', 'Reviews', 'Close']);
});

test('New has no body Back button while top and bottom chrome remains clickable', () => {
  const state = workspace(); const openedLinks = []; const { supervisor, handlers } = harness(state, { linkOpener(url) { openedLinks.push(url); } });
  supervisor.start(); let layout = supervisor.renderer.lastLayout; click(handlers, layout.actions.find((item) => item.action === 'New'));
  layout = supervisor.renderer.lastLayout; assert.equal(layout.hits.some((item) => item.type === 'back'), false); assert.ok(supervisor.wizard);
  click(handlers, layout.actions.find((item) => item.action === 'Plans')); assert.equal(supervisor.topPage.action, 'Plans');
  supervisor.activate('New'); layout = supervisor.renderer.lastLayout; click(handlers, layout.links.find((item) => item.link === 'report')); assert.equal(openedLinks.length, 1); assert.ok(supervisor.wizard);
  click(handlers, layout.children.find((item) => item.sessionId === 'd')); assert.equal(supervisor.navigation.activeAction, null); assert.equal(supervisor.navigation.sessionId, 'd');
  supervisor.activate('New'); handlers.get('data')('\u001b'); assert.equal(supervisor.wizard, null); assert.equal(supervisor.navigation.sessionId, 'd');
  supervisor.stop();
});

test('frame shortcuts are retired while terminal arrows scroll or are safely ignored', () => {
  const state = workspace(); const forwarded = []; const scrolled = []; const { supervisor, handlers } = harness(state, { sessions: { write(id, value) { forwarded.push([id, value]); }, scroll(id, lines) { scrolled.push([id, lines]); } } });
  supervisor.start(); for (const value of ['\u001bp', '\u001b3', '\u001b[6;5~', '\u001b[A', '\u001b[D']) handlers.get('data')(value);
  assert.equal(supervisor.topPage, undefined); assert.equal(supervisor.navigation.sessionId, 'd');
  assert.deepEqual(forwarded.map((entry) => entry[1]), ['\u001bp', '\u001b3', '\u001b[6;5~']); assert.deepEqual(scrolled, [['d', -1]]); supervisor.stop();
});

test('clicking a Sessions parent only toggles it while its planning row opens history', () => {
  const state = workspace(); const { supervisor, handlers, opened } = harness(state); supervisor.start(); supervisor.focusAgent('w'); supervisor.activate('Sessions');
  let header = supervisor.contentHits.find((item) => item.header && item.workstreamId === 'one'); clickContent(handlers, header); assert.equal(supervisor.sessionPicker.expanded.has('one'), false); assert.equal(supervisor.navigation.sessionId, 'w');
  header = supervisor.contentHits.find((item) => item.header && item.workstreamId === 'one'); clickContent(handlers, header); assert.equal(supervisor.sessionPicker.expanded.has('one'), true);
  const planning = supervisor.contentHits.find((item) => item.sessionId === 'd'); clickContent(handlers, planning); assert.equal(supervisor.navigation.sessionId, 'd'); assert.equal(supervisor.sessionPicker, null); assert.deepEqual(opened, []); supervisor.stop();
});

test('focusing marks only that child viewed and starts no animation timer', () => {
  const state = workspace(); let active = false; const intervals = []; const cleared = [];
  const { supervisor, viewed } = harness(state, { sessions: { isSessionActive(id) { return active && id === 'w'; } }, setInterval(fn, ms) { const timer = { fn, ms, unref() {} }; intervals.push(timer); return timer; }, clearInterval(timer) { cleared.push(timer); } }); supervisor.renderer.reducedMotion = false; supervisor.renderer.chrome.options.reducedMotion = false;
  supervisor.start(); viewed.length = 0; supervisor.focusAgent('w'); assert.deepEqual(viewed, ['w']); assert.equal(intervals.length, 0);
  active = true; supervisor.draw(); assert.equal(intervals.length, 0);
  active = false; supervisor.draw(); assert.equal(cleared.length, 0); supervisor.stop();
});

test('hidden output does not draw, visible bursts coalesce, and unchanged rows are not rewritten', () => {
  const state = workspace(); const timers = []; const { supervisor, writes } = harness(state, { sessions: { presentation() { return { lines: ['native'], cursor: { row: 1, column: 2 } }; } }, setTimeout(fn, ms) { const timer = { fn, ms, unref() {} }; timers.push(timer); return timer; }, clearTimeout() {} }); supervisor.start(); const initialWrites = writes.length; supervisor.sessions.onOutput('c'); assert.equal(timers.length, 0); assert.equal(writes.length, initialWrites); supervisor.sessions.onOutput('d'); supervisor.sessions.onOutput('d'); supervisor.sessions.onOutput('d'); assert.equal(timers.length, 1); assert.equal(timers[0].ms, 50); timers[0].fn(); assert.equal(writes.length, initialWrites + 1); assert.match(writes.at(-1), /\u001b\[\?25h\u001b\[3;5H/); assert.doesNotMatch(writes.at(-1), /\u001b\[\d+;1H/); supervisor.stop();
});

test('Close pauses only the focused child and selects a sibling fallback', () => {
  const state = workspace(); const { supervisor, paused } = harness(state); supervisor.start(); supervisor.focusAgent('w'); supervisor.activate('Close');
  assert.deepEqual(paused, ['w']); assert.equal(state.sessions.find((item) => item.id === 'w').status, 'paused');
  assert.equal(state.sessions.find((item) => item.id === 'd').explicitlyClosed, false); assert.equal(state.workstreams.find((item) => item.id === 'one').status, 'active');
  assert.equal(supervisor.navigation.sessionId, 'd'); supervisor.stop();
});

test('Close selects a sibling fallback without starting it', () => {
  const state = workspace(); const { supervisor, paused, opened } = harness(state); supervisor.start(); supervisor.focusAgent('d'); opened.length = 0; supervisor.activate('Close'); assert.deepEqual(paused, ['d']); assert.equal(state.sessions.find((item) => item.id === 'd').status, 'paused'); assert.equal(supervisor.navigation.sessionId, 'w'); assert.deepEqual(opened, []); supervisor.stop();
});

test('Sessions opens saved history first and resumes the selected child only after Enter', () => {
  const state = workspace(); state.sessions.find((item) => item.id === 'w').explicitlyClosed = true; state.sessions.find((item) => item.id === 'w').status = 'paused';
  const { supervisor, handlers, opened } = harness(state); supervisor.start(); supervisor.activate('Sessions');
  const rows = supervisor.sessionPickerRows(); const index = rows.findIndex((row) => row.session.id === 'w'); supervisor.sessionPicker.index = index; supervisor.sessionPicker.sessionId = 'w'; handlers.get('data')('\r');
  assert.equal(supervisor.navigation.sessionId, 'w'); assert.deepEqual(opened, []); assert.equal(state.sessions.find((item) => item.id === 'w').explicitlyClosed, true); handlers.get('data')('\r'); assert.deepEqual(opened, ['w']); assert.equal(state.sessions.find((item) => item.id === 'w').explicitlyClosed, false); supervisor.stop();
});

test('Sessions arrows select exact agents and left/right collapse or expand their group', () => {
  const state = workspace(); const { supervisor, handlers, opened } = harness(state); supervisor.start(); supervisor.activate('Sessions');
  assert.equal(supervisor.sessionPicker.sessionId, 'd'); handlers.get('data')('\u001b[B'); assert.equal(supervisor.sessionPicker.sessionId, 'w'); handlers.get('data')('\r'); assert.equal(supervisor.navigation.sessionId, 'w'); assert.deepEqual(opened, []);
  supervisor.activate('Sessions'); handlers.get('data')('\u001b[D'); assert.equal(supervisor.sessionPicker.selectedKey, 'group:one'); assert.equal(supervisor.sessionPicker.sessionId, null); assert.equal(supervisor.sessionPicker.expanded.has('one'), false); assert.doesNotMatch(stripAnsi(supervisor.sessionPickerLines().join('\n')), /Worker #1/); handlers.get('data')('\u001b[C'); assert.equal(supervisor.sessionPicker.expanded.has('one'), true); assert.match(stripAnsi(supervisor.sessionPickerLines().join('\n')), /Worker #1/); handlers.get('data')('\r'); assert.equal(supervisor.sessionPicker.expanded.has('one'), false); assert.equal(supervisor.navigation.sessionId, 'w'); handlers.get('data')('\u001b[C'); handlers.get('data')('\u001b[B'); assert.equal(supervisor.sessionPicker.sessionId, 'd'); handlers.get('data')('\r'); assert.equal(supervisor.navigation.sessionId, 'd'); assert.deepEqual(opened, []); supervisor.stop();
});

test('Sessions keeps legacy explicitly closed non-terminal children resumable on explicit Enter', () => {
  const state = workspace(); const worker = state.sessions.find((item) => item.id === 'w'); worker.explicitlyClosed = true; worker.status = 'closed'; const { supervisor, handlers, opened } = harness(state); supervisor.start(); supervisor.activate('Sessions'); const rows = supervisor.sessionPickerRows(); const index = rows.findIndex((row) => row.session.id === 'w'); supervisor.sessionPicker.index = index; supervisor.sessionPicker.sessionId = 'w'; handlers.get('data')('\r'); assert.deepEqual(opened, []); handlers.get('data')('\r'); assert.deepEqual(opened, ['w']); assert.equal(worker.status, 'running'); supervisor.stop();
});

test('a never-started agent stays inert when opened and starts on the next Enter', () => {
  const state = workspace(); const planning = state.sessions.find((item) => item.id === 'd'); planning.status = 'closed'; planning.explicitlyClosed = false; const { supervisor, handlers, opened } = harness(state); supervisor.start(); supervisor.activate('Sessions'); const rows = supervisor.sessionPickerRows(); const index = rows.findIndex((row) => row.session.id === 'd'); supervisor.sessionPicker.index = index; supervisor.sessionPicker.sessionId = 'd'; handlers.get('data')('\r'); assert.deepEqual(opened, []); assert.match(supervisor.footerPresentation().message, /Press Enter to start/); handlers.get('data')('\r'); assert.deepEqual(opened, ['d']); supervisor.stop();
});

test('Sessions focuses accepted and completed history without resuming either provider', () => {
  const state = workspace(); const worker = state.sessions.find((item) => item.id === 'w'); Object.assign(worker, { executionId: 'e', explicitlyClosed: true, status: 'paused' }); const verifier = state.sessions.find((item) => item.id === 'v'); Object.assign(verifier, { executionId: 'e', explicitlyClosed: true, status: 'paused' }); const execution = { id: 'e', status: 'integration-review', chunks: [{ id: 'chunk', status: 'accepted', attempts: [{ sessionId: 'w' }] }], integration: { verifier: { sessionId: 'v' }, verifierAttempts: [{ sessionId: 'v', result: 'pass', completedAt: '2026-01-03T00:00:00.000Z' }] } }; const { supervisor, handlers, opened } = harness(state, { scheduler: { list: () => [execution], resume() {} } }); supervisor.start();
  for (const sessionId of ['w', 'v']) { supervisor.activate('Sessions'); const rows = supervisor.sessionPickerRows(supervisor.decorateWorkspace(state)); const index = rows.findIndex((row) => row.session.id === sessionId); supervisor.sessionPicker.index = index; supervisor.sessionPicker.sessionId = sessionId; handlers.get('data')('\r'); assert.equal(supervisor.navigation.sessionId, sessionId); }
  assert.deepEqual(opened, []); assert.equal(worker.status, 'paused'); assert.equal(verifier.status, 'paused'); supervisor.stop();
});

test('bottom rail excludes paused and completed history until an agent is selected', () => {
  const state = workspace(); const worker = state.sessions.find((item) => item.id === 'w'); worker.explicitlyClosed = true; worker.status = 'paused'; const verifier = state.sessions.find((item) => item.id === 'v'); verifier.explicitlyClosed = true; verifier.status = 'completed';
  const { supervisor, handlers, opened } = harness(state); supervisor.start(); supervisor.navigation.workstreamId = 'one'; supervisor.draw(); let layout = supervisor.renderer.lastLayout;
  assert.equal(layout.children.some((item) => ['w', 'v'].includes(item.sessionId)), false); supervisor.activate('Sessions'); const rows = supervisor.sessionPickerRows(); const index = rows.findIndex((row) => !row.header && row.session.id === 'w'); supervisor.sessionPicker.index = index; supervisor.sessionPicker.sessionId = 'w'; handlers.get('data')('\r'); layout = supervisor.renderer.lastLayout; assert.equal(layout.children.some((item) => item.sessionId === 'w'), true); assert.equal(worker.status, 'paused'); assert.deepEqual(opened, []); handlers.get('data')('\r'); assert.equal(worker.status, 'running'); assert.deepEqual(opened, ['w']); supervisor.stop();
});

test('Plans and Sessions remain ordered by immutable creation time', () => {
  const state = workspace(); const plans = [{ planId: 'old', createdAt: '2026-01-01', updatedAt: '2099-01-01' }, { planId: 'new', createdAt: '2026-01-02', updatedAt: '2026-01-02' }];
  const { supervisor } = harness(state, { lineage: { list: () => plans } });
  assert.deepEqual(supervisor.planItems().map((item) => item.planId), ['new', 'old']); assert.deepEqual(supervisor.sessionPickerItems(state).map((item) => item.id), ['two', 'one']);
  state.workstreams[0].updatedAt = '2100-01-01'; state.sessions[0].updatedAt = '2100-01-01'; assert.deepEqual(supervisor.sessionPickerItems(state).map((item) => item.id), ['two', 'one']);
});

test('Plans and Reviews are keyboard-only grouped views without body buttons or hit targets', () => {
  const state = workspace(); state.workstreams[0].name = 'Build API'; state.workstreams[1].name = 'Fix CLI';
  const plans = [{ planId: 'p1', title: 'API plan', workstreamId: 'one', originSessionId: 'd', currentVersion: 1, createdAt: '2026-01-01' }, { planId: 'p2', title: 'CLI plan', workstreamId: 'two', originSessionId: 'c', currentVersion: 1, createdAt: '2026-01-02' }];
  const manifests = { p1: { title: 'API plan', version: 1, workstreamId: 'one', shared: { id: 'shared', sha: 's' }, chunks: [{ id: 'api', title: 'Implement API', sha: 'c' }], globalValidation: { id: 'global-validation', sha: 'g' }, approvals: {} }, p2: { title: 'CLI plan', version: 1, workstreamId: 'two', shared: { id: 'shared', sha: 's' }, chunks: [], globalValidation: { id: 'global-validation', sha: 'g' }, approvals: {} } };
  const execution = { id: 'e', planId: 'p1', version: 1, workstreamId: 'one', status: 'complete', profile: { provider: 'codex', model: 'gpt-5', effort: 'high' }, chunks: [{ id: 'api', title: 'Implement API', status: 'accepted', summary: 'Done', attempts: [{ sessionId: 'w' }] }], integration: { finalDiff: '', checkResults: [] } };
  const legacyExecution = { id: 'legacy', planId: 'legacy-plan', version: 1, workstreamId: 'two', status: 'running', chunks: [{ id: 'cli', title: 'Fix command', status: 'review', summary: 'CLI ready', attempts: [{ sessionId: 'c' }] }] };
  const lineage = { list: () => plans, load: (id) => plans.find((item) => item.planId === id), readManifest: (id) => manifests[id], readSection: (_id, _version, sectionId) => `## ${sectionId}` };
  const { supervisor, handlers } = harness(state, { lineage, scheduler: { list: () => [execution, legacyExecution], resume() {} } }); supervisor.start(); supervisor.activate('Plans');
  let plain = stripAnsi(supervisor.actionPageLines().join('\n')); assert.match(plain, /▾ Build API \(1\)/); assert.match(plain, /API plan.*Complete/); assert.match(plain, /▸ Fix CLI \(1\)/); assert.doesNotMatch(plain, /CLI plan.*Awaiting|Expand all|Collapse all|Planning agent|Worker agent/); assert.equal(supervisor.renderer.lastLayout.hits.some((item) => ['group-toggle', 'groups-expand', 'groups-collapse', 'plan-item', 'page-action'].includes(item.type)), false);
  handlers.get('data')('\r'); plain = stripAnsi(supervisor.actionPageLines().join('\n')); assert.match(plain, /Worker: Codex gpt-5 · high effort/); assert.match(plain, /Execution: Complete/); assert.match(plain, /Worker chunk · Implement API/);
  handlers.get('data')('\u001b[B'); assert.equal(supervisor.topPage.detail.sectionIndex, 1); handlers.get('data')('\r'); assert.equal(supervisor.topPage.detail.reader, true);
  supervisor.activate('Reviews'); plain = stripAnsi(supervisor.actionPageLines().join('\n')); assert.match(plain, /▾ Build API \(2\)/); assert.match(plain, /▸ Fix CLI \(1\)/); assert.doesNotMatch(plain, /CLI ready/); handlers.get('data')('\u001b[B'); handlers.get('data')('\u001b[B'); handlers.get('data')('\u001b[C'); assert.match(stripAnsi(supervisor.actionPageLines().join('\n')), /CLI ready/); supervisor.stop();
});

test('grouped pages use only left and right arrows for collapse and expansion', () => {
  const state = workspace(); state.workstreams[0].name = 'Alpha'; state.workstreams[1].name = 'Beta'; const plans = [{ planId: 'alpha', title: 'Alpha plan', workstreamId: 'one', currentVersion: 1 }, { planId: 'beta', title: 'Beta plan', workstreamId: 'two', currentVersion: 1 }]; const manifest = (id) => ({ title: `${id} plan`, version: 1, workstreamId: id === 'alpha' ? 'one' : 'two', shared: { id: 'shared', sha: 's' }, chunks: [], globalValidation: { id: 'global-validation', sha: 'g' }, approvals: {} }); const lineage = { list: () => plans, readManifest: (id) => manifest(id) };
  const { supervisor, handlers } = harness(state, { lineage }); supervisor.start(); supervisor.activate('Plans'); const page = supervisor.groupPageState('Plans'); assert.match(page.selectedKey, /^item:alpha/);
  handlers.get('data')('\u001b[A'); assert.equal(page.selectedKey, 'group:one'); handlers.get('data')('\r'); assert.equal(page.expanded.has('one'), false); handlers.get('data')('\u001b[C'); assert.equal(page.expanded.has('one'), true); handlers.get('data')('\u001b[B'); assert.match(page.selectedKey, /^item:alpha/);
  for (const retired of ['c', 'e', 'C', 'E']) handlers.get('data')(retired); assert.deepEqual([...page.expanded], ['one']); handlers.get('data')('\u001b[D'); assert.equal(page.expanded.has('one'), false); handlers.get('data')('\u001b[C'); assert.equal(page.expanded.has('one'), true); supervisor.stop();
});

test('execution state labels cover durable planning and execution phases', () => {
  assert.deepEqual([executionStateLabel(null, false), executionStateLabel(null, true), executionStateLabel('complete'), executionStateLabel('failed'), executionStateLabel('verifying'), executionStateLabel('integration-conflict'), executionStateLabel('integration-review'), executionStateLabel('running')], ['Awaiting approval', 'Not started', 'Complete', 'Failed', 'Verifying', 'Integration', 'Integration', 'Working']);
});

test('Review keeps durable entries and applies feedback and acceptance without leaving detail', () => {
  const state = workspace(); const execution = { id: 'e', planId: 'p', workstreamId: 'one', status: 'running', chunks: [{ id: 'chunk', status: 'review', summary: 'Ready', diff: '+new', attempts: [{ sessionId: 'w' }] }] }; const feedback = [];
  const scheduler = { list: () => [execution], resume() {}, feedback(_e, _c, payload) { feedback.push(payload); execution.chunks[0].status = 'running'; execution.chunks[0].feedback = [{ ...payload, at: 'now' }]; return execution.chunks[0]; }, accept() { execution.chunks[0].status = 'accepted'; return execution; } };
  const { supervisor, handlers } = harness(state, { scheduler, lineage: { list: () => [{ planId: 'p', title: 'Plan', workstreamId: 'one', originSessionId: 'd' }] } }); supervisor.start(); supervisor.activate('Reviews'); handlers.get('data')('\r');
  handlers.get('data')('fFix it\r'); assert.ok(supervisor.topPage.detail); assert.equal(feedback[0].message, 'Fix it'); assert.match(stripAnsi(supervisor.actionPageLines().join('\n')), /Feedback sent · Revising/);
  execution.chunks[0].status = 'review'; supervisor.draw(); assert.match(stripAnsi(supervisor.actionPageLines().join('\n')), /Ready for review/);
  handlers.get('data')('a'); assert.ok(supervisor.topPage.detail); assert.match(stripAnsi(supervisor.actionPageLines().join('\n')), /Accepted/);
  execution.chunks[0].status = 'complete'; supervisor.draw(); assert.match(stripAnsi(supervisor.actionPageLines().join('\n')), /Complete/);
  state.sessions.find((item) => item.id === 'w').explicitlyClosed = true; assert.equal(supervisor.reviewItems().some((item) => item.id === 'chunk'), true); supervisor.stop();
});

test('feedback resumes the exact worker after Close before recording the revision', () => {
  const state = workspace(); const execution = { id: 'e', planId: 'p', workstreamId: 'one', status: 'running', chunks: [{ id: 'chunk', status: 'review', summary: 'Ready', diff: '+new', attempts: [{ sessionId: 'w' }] }], events: [] }; const writes = [];
  const scheduler = { list: () => [execution], load: () => execution, resume() {}, feedback(executionId, chunkId, payload, sender) { sender(executionId, chunkId, payload.message); execution.chunks[0].status = 'running'; execution.chunks[0].feedback = [{ ...payload, at: 'now' }]; } };
  const { supervisor, handlers, opened } = harness(state, { scheduler, sessions: { isOpen(id) { return state.sessions.find((item) => item.id === id)?.status === 'running'; }, write(id, value) { assert.equal(state.sessions.find((item) => item.id === id).status, 'running'); writes.push([id, value]); } }, lineage: { list: () => [{ planId: 'p', title: 'Plan', workstreamId: 'one', originSessionId: 'd' }] } }); supervisor.start(); supervisor.focusAgent('w'); supervisor.activate('Close'); assert.equal(state.sessions.find((item) => item.id === 'w').status, 'paused'); supervisor.activate('Reviews'); handlers.get('data')('\r'); handlers.get('data')('fResume this\r');
  assert.deepEqual(opened.filter((id) => id === 'w'), ['w']); assert.deepEqual(writes, [['w', '\u001b[200~Resume this\u001b[201~'], ['w', '\r']]); assert.equal(execution.chunks[0].status, 'running'); assert.equal(supervisor.topPage.feedback, null); supervisor.stop();
});

test('failed closed-worker feedback stays visible and can be retried', () => {
  const state = workspace(); const execution = { id: 'e', planId: 'p', workstreamId: 'one', status: 'running', chunks: [{ id: 'chunk', status: 'review', summary: 'Ready', diff: '+new', attempts: [{ sessionId: 'w' }] }] }; let resumes = 0; const scheduler = { list: () => [execution], load: () => execution, resume() {}, feedback(executionId, chunkId, payload, sender) { sender(executionId, chunkId, payload.message); execution.chunks[0].status = 'running'; execution.chunks[0].feedback = [{ ...payload, at: 'now' }]; } }; const sessions = { isOpen(id) { return state.sessions.find((item) => item.id === id)?.status === 'running'; }, resume(id) { resumes += 1; if (resumes === 1) throw new Error('provider resume failed'); const session = state.sessions.find((item) => item.id === id); session.explicitlyClosed = false; session.status = 'running'; }, write() {} };
  const { supervisor, handlers } = harness(state, { scheduler, sessions, lineage: { list: () => [{ planId: 'p', title: 'Plan', workstreamId: 'one', originSessionId: 'd' }] } }); supervisor.start(); supervisor.focusAgent('w'); supervisor.activate('Close'); supervisor.activate('Reviews'); handlers.get('data')('\r'); handlers.get('data')('fRetry me\r'); assert.equal(execution.chunks[0].status, 'review'); assert.match(supervisor.topPage.feedback.error, /provider resume failed/); assert.match(stripAnsi(supervisor.actionPageLines().join('\n')), /Enter retry/); handlers.get('data')('\r'); assert.equal(execution.chunks[0].status, 'running'); assert.equal(supervisor.topPage.feedback, null); assert.equal(resumes, 2); supervisor.stop();
});

test('long Review diffs keep every action visible inside narrow and normal rendered frames', () => {
  for (const dimensions of [{ columns: 52, rows: 14 }, { columns: 100, rows: 22 }]) {
    const state = workspace(); const diff = ['diff --git a/a.js b/a.js', '--- a/a.js', '+++ b/a.js', '@@ -1 +1,80 @@', ...Array.from({ length: 80 }, (_, index) => `+line ${index}`)].join('\n'); const execution = { id: 'e', planId: 'p', workstreamId: 'one', status: 'running', chunks: [{ id: 'chunk', status: 'review', summary: 'Ready', diff, attempts: [{ sessionId: 'w' }] }] };
    const { supervisor, handlers } = harness(state, { ...dimensions, scheduler: { list: () => [execution], resume() {} }, lineage: { list: () => [{ planId: 'p', title: 'Plan', workstreamId: 'one', originSessionId: 'd' }] } }); supervisor.start(); supervisor.activate('Reviews'); handlers.get('data')('\r'); const rendered = stripAnsi(supervisor.renderer.lastLayout.output); assert.match(rendered, /a accept/); assert.match(rendered, /f feedback/); assert.match(rendered, /Esc back/); assert.match(rendered, /of \d+/); supervisor.stop();
    const finalState = workspace(); const finalExecution = { id: 'e', planId: 'p', workstreamId: 'one', status: 'verification-failed', verification: { state: 'fail', summary: 'Verifier rejected this result' }, integration: { finalDiff: diff, checkResults: [] }, chunks: [] }; const finalHarness = harness(finalState, { ...dimensions, scheduler: { list: () => [finalExecution], resume() {} }, lineage: { list: () => [{ planId: 'p', title: 'Plan', workstreamId: 'one', originSessionId: 'd' }] } }); finalHarness.supervisor.start(); finalHarness.supervisor.activate('Reviews'); finalHarness.handlers.get('data')('\r'); const finalRendered = stripAnsi(finalHarness.supervisor.renderer.lastLayout.output); assert.match(finalRendered, /r accept remedies/); assert.match(finalRendered, /f suggest/); assert.match(finalRendered, /o override/); assert.match(finalRendered, /Esc back/); assert.match(finalRendered, /of \d+/); finalHarness.supervisor.stop();
  }
});

test('durable transitions close accepted workers and finished verifier and integration attempts', () => {
  const state = workspace(); Object.assign(state.sessions.find((item) => item.id === 'w'), { executionId: 'e', status: 'running' }); Object.assign(state.sessions.find((item) => item.id === 'v'), { executionId: 'e', status: 'running' }); state.sessions.push({ id: 'i', executionId: 'e', workstreamId: 'one', role: 'integration', paneNumber: 4, name: 'Integration #1', profile: { provider: 'codex' }, status: 'running', explicitlyClosed: false }); const execution = { id: 'e', planId: 'p', workstreamId: 'one', status: 'integration-review', chunks: [{ id: 'chunk', status: 'accepted', attempts: [{ sessionId: 'w' }] }], integration: { verifier: { sessionId: 'v' }, verifierAttempts: [{ number: 1, sessionId: 'v', result: 'pass', completedAt: '2026-01-02T00:00:00.000Z' }], worker: { sessionId: 'i' }, repairAttempts: [{ number: 1, sessionId: 'i', phase: 'target', result: 'pass', summary: 'fixed', completedAt: '2026-01-02T00:00:00.000Z' }] } }; const scheduler = { list: () => [execution], resume() {} }; const integration = {}; const closed = []; const { supervisor } = harness(state, { scheduler, integration, sessions: { close(id, explicit) { closed.push([id, explicit]); const session = state.sessions.find((item) => item.id === id); session.explicitlyClosed = true; session.status = 'paused'; } } }); const decorated = supervisor.decorateWorkspace(state); assert.equal(decorated.sessions.find((item) => item.id === 'i').completed, true); scheduler.onChange(); assert.deepEqual(closed, [['w', true], ['v', true], ['i', true]]); assert.ok(state.sessions.filter((item) => ['w', 'v', 'i'].includes(item.id)).every((item) => item.status === 'paused')); integration.onChange(); assert.equal(closed.length, 3);
});

test('managed-session reconciliation preserves only current interactive attempts', () => {
  const state = workspace(); state.sessions.push({ id: 'wa', executionId: 'ew', workstreamId: 'one', role: 'worker', paneNumber: 4, profile: { provider: 'codex' }, status: 'running', explicitlyClosed: false }, { id: 'va', executionId: 'ev', workstreamId: 'one', role: 'verifier', paneNumber: 5, profile: { provider: 'codex' }, status: 'running', explicitlyClosed: false }, { id: 'ia', executionId: 'ei', workstreamId: 'one', role: 'integration', paneNumber: 6, profile: { provider: 'codex' }, status: 'running', explicitlyClosed: false }); const executions = [{ id: 'ew', status: 'running', chunks: [{ status: 'review', attempts: [{ sessionId: 'wa' }] }] }, { id: 'ev', status: 'verifying', chunks: [], integration: { verifier: { sessionId: 'va' }, verifierAttempts: [{ sessionId: 'va', startedAt: 'now' }] } }, { id: 'ei', status: 'integration-conflict', chunks: [], integration: { worker: { sessionId: 'ia' }, repairAttempts: [{ sessionId: 'ia', startedAt: 'now' }] } }]; const closed = []; const { supervisor } = harness(state, { scheduler: { list: () => executions, resume() {} }, sessions: { close(id) { closed.push(id); } } }); assert.deepEqual(supervisor.reconcileManagedSessions(), []); assert.deepEqual(closed, []);
});

test('one durable execution agent spans verification, accepted repair, and reconciliation', () => {
  const state = workspace(); const created = []; const continuations = []; const opened = [];
  const store = { load: () => state, createSession(workstreamId, role, profile, fields) { const session = { id: `execution-${created.length + 1}`, workstreamId, role, profile, status: 'running', explicitlyClosed: false, ...fields }; state.sessions.push(session); created.push(session); return session; }, setSessionAttention() {} };
  const { supervisor } = harness(state, { store, sessions: { open(id) { opened.push(id); }, isOpen: () => true, continueWhenReady(...args) { continuations.push(args); } } });
  const execution = { id: 'execution', planId: 'plan', workstreamId: 'one', repositoryRoot: '/tmp/repository' };
  const verified = supervisor.launchVerifier({ execution, integration: { worktree: '/tmp/integration', verificationPurpose: 'initial' }, context: '/tmp/context', profile: { provider: 'codex' } });
  const repaired = supervisor.launchIntegrationWorker({ execution, agent: verified, integration: { worktree: '/tmp/integration', context: '/tmp/context' }, result: { message: 'Fix both findings' }, allowedPaths: ['src/**'], profile: { provider: 'codex' }, phase: 'verification-remedy' });
  const reconciled = supervisor.launchIntegrationWorker({ execution, agent: repaired, integration: { worktree: '/tmp/reconcile' }, result: { message: 'Preserve both commits' }, allowedPaths: ['src/**'], profile: { provider: 'codex' }, phase: 'target' });
  assert.equal(created.length, 1); assert.equal(created[0].role, 'integration'); assert.equal(created[0].name, 'Execution 1'); assert.match(created[0].roleInstruction, /single durable BDFL execution agent/); assert.deepEqual([verified.sessionId, repaired.sessionId, reconciled.sessionId], ['execution-1', 'execution-1', 'execution-1']); assert.deepEqual(opened, ['execution-1']); assert.match(continuations[0][1], /phase: verification/); assert.match(continuations[1][1], /accepted verification remedy/); assert.match(continuations[2][1], /target reconciliation/);
});

test('managed-session reconciliation keeps a durable execution agent visible while remedies await approval', () => {
  const state = workspace(); state.sessions.push({ id: 'execution-agent', executionId: 'e', workstreamId: 'one', role: 'integration', status: 'running', explicitlyClosed: false }, { id: 'old-verifier', executionId: 'e', workstreamId: 'one', role: 'verifier', status: 'running', explicitlyClosed: false });
  const execution = { id: 'e', status: 'verification-failed', chunks: [], integration: { agent: { sessionId: 'execution-agent' }, verifier: { sessionId: 'execution-agent' }, verifierAttempts: [{ sessionId: 'execution-agent', result: 'fail', completedAt: 'done' }] } }; const closed = [];
  const { supervisor } = harness(state, { scheduler: { list: () => [execution], resume() {} }, sessions: { close(id) { closed.push(id); } } });
  assert.deepEqual(supervisor.reconcileManagedSessions(), []); assert.deepEqual(closed, ['old-verifier']);
});

test('startup reconciles terminal managed attempts before restore can relaunch them', () => {
  const state = workspace(); Object.assign(state.sessions.find((item) => item.id === 'w'), { executionId: 'e', status: 'closed', explicitlyClosed: false }); Object.assign(state.sessions.find((item) => item.id === 'v'), { executionId: 'e', status: 'closed', explicitlyClosed: false }); state.sessions.push({ id: 'i', executionId: 'e', workstreamId: 'one', role: 'integration', paneNumber: 4, name: 'Integration #1', profile: { provider: 'codex' }, status: 'closed', explicitlyClosed: false }); const execution = { id: 'e', status: 'complete', chunks: [{ id: 'chunk', status: 'accepted', attempts: [{ sessionId: 'w' }] }], integration: { verifierAttempts: [{ sessionId: 'v', result: 'pass', completedAt: 'done' }], repairAttempts: [{ sessionId: 'i', result: 'pass', completedAt: 'done' }] } }; const restored = []; const { supervisor } = harness(state, { scheduler: { list: () => [execution], resume() {} }, sessions: { close(id) { const session = state.sessions.find((item) => item.id === id); session.explicitlyClosed = true; session.status = 'paused'; }, restore() { restored.push(...state.sessions.filter((item) => !item.explicitlyClosed).map((item) => item.id)); return { opened: [], errors: [] }; } } }); supervisor.start(); assert.deepEqual(restored.sort(), ['c', 'd']); assert.ok(state.sessions.filter((item) => ['w', 'v', 'i'].includes(item.id)).every((item) => item.explicitlyClosed)); supervisor.stop();
});

test('Review keeps remedy, integration, and override confirmations separate', () => {
  const state = workspace(); const execution = { id: 'e', planId: 'p', workstreamId: 'one', status: 'verification-failed', verification: { state: 'fail', summary: 'Failed' }, integration: { finalDiff: '+result', checkResults: [] }, chunks: [] }; const remedies = []; const finalized = [];
  const { supervisor, handlers } = harness(state, { scheduler: { list: () => [execution], resume() {} }, integration: { remedy(id) { remedies.push(id); execution.status = 'integration-conflict'; }, finalize(...args) { finalized.push(args); execution.status = 'integrating'; } }, lineage: { list: () => [{ planId: 'p', title: 'Plan', workstreamId: 'one', originSessionId: 'd' }] } });
  supervisor.start(); supervisor.activate('Reviews'); handlers.get('data')('\r'); handlers.get('data')('r'); assert.equal(supervisor.reviewView.state().confirmation, 'remedy'); handlers.get('data')('\r'); assert.deepEqual(remedies, ['e']);
  assert.match(stripAnsi(supervisor.actionPageLines().join('\n')), /Integration repair/); execution.status = 'integration-checking'; supervisor.draw(); assert.match(stripAnsi(supervisor.actionPageLines().join('\n')), /Checking/); execution.status = 'verifying'; supervisor.draw(); assert.match(stripAnsi(supervisor.actionPageLines().join('\n')), /Verifying/);
  execution.status = 'verification-failed'; supervisor.draw(); handlers.get('data')('o'); assert.equal(supervisor.reviewView.state().confirmation, 'override'); handlers.get('data')('\r'); assert.equal(finalized[0][2].override, true); assert.match(stripAnsi(supervisor.actionPageLines().join('\n')), /Integrating/);
  execution.status = 'complete'; supervisor.draw(); assert.match(stripAnsi(supervisor.actionPageLines().join('\n')), /Complete/); supervisor.stop();
});

test('double Ctrl+C remains the only quit gesture', () => {
  const state = workspace(); let shutdowns = 0; let timeout; const { supervisor, handlers } = harness(state, { sessions: { shutdown() { shutdowns += 1; } }, setTimeout(fn, ms) { timeout = { fn, ms, unref() {} }; return timeout; } });
  supervisor.start(); handlers.get('data')('\u0003'); assert.equal(supervisor.running, true); assert.equal(timeout.ms, 5000); assert.match(stripAnsi(supervisor.renderer.lastLayout.output), /Press Ctrl\+C again to quit/);
  handlers.get('data')('\u0003'); assert.equal(supervisor.running, false); assert.equal(shutdowns, 1);
});
