'use strict';

const test = require('node:test'); const assert = require('node:assert/strict');
const { ISSUE_URL, REPOSITORY_URL } = require('../../src/core/errors');
const { STYLE, characterWidth, stripAnsi, textWidth, childVisualState, parentVisualState, visualStyle, hitAt, layoutChrome, renderChrome } = require('../../src/tui/chrome');

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
function displaySlice(value, start, end) {
  let column = 1; let result = '';
  for (const { segment } of segmenter.segment(value)) {
    const next = column + characterWidth(segment) - 1;
    if (next >= start && column <= end) result += segment;
    column = next + 1;
  }
  return result;
}

function fixture() {
  return {
    planCount: 2, reviewCount: 4, activeWorkstreamId: 'one',
    workstreams: [
      { id: 'one', title: 'Alpha', createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'two', title: 'Beta', createdAt: '2026-01-02T00:00:00.000Z' }
    ],
    sessions: [
      { id: 'lead', workstreamId: 'one', name: 'Claude 1', role: 'delegator', paneNumber: 1, status: 'running', activityAt: '2026-01-03T00:00:00.000Z', viewedAt: '2026-01-03T00:00:00.000Z' },
      { id: 'worker', workstreamId: 'one', name: 'Worker 1', role: 'worker', paneNumber: 2, status: 'running', activityAt: '2026-01-04T00:00:00.000Z', viewedAt: '2026-01-03T00:00:00.000Z' },
      { id: 'verifier', workstreamId: 'one', name: 'Verifier 1', role: 'verifier', paneNumber: 3, status: 'completed', activityAt: '2026-01-05T00:00:00.000Z' },
      { id: 'other', workstreamId: 'two', name: 'Codex 2', role: 'direct', paneNumber: 4, status: 'running' }
    ]
  };
}

test('classifies every child state and aggregates parents without active styling', () => {
  const state = fixture(); const [lead, worker, verifier] = state.sessions;
  assert.equal(childVisualState(lead, { activeSessionId: 'lead' }), 'active');
  assert.equal(childVisualState(lead, { runningSessionIds: new Set(['lead']) }), 'running');
  assert.equal(childVisualState(worker), 'idle-unviewed');
  assert.equal(childVisualState(lead), 'idle-viewed');
  assert.equal(childVisualState(verifier), 'done');
  assert.equal(parentVisualState([lead, worker], { runningSessionIds: new Set(['lead']), activeSessionId: 'lead' }), 'running');
  assert.equal(parentVisualState([lead, worker]), 'idle-unviewed');
  assert.equal(parentVisualState([lead, verifier]), 'idle-viewed');
});

test('failed attempts remain feedback-capable and use active worker visual states', () => {
  const failed = { id: 'failed', status: 'running', attemptStatus: 'failed', activityAt: '2026-01-04T00:00:00.000Z', viewedAt: '2026-01-03T00:00:00.000Z' };
  assert.equal(childVisualState(failed, { activeSessionId: failed.id }), 'active');
  assert.equal(childVisualState(failed, { runningSessionIds: new Set([failed.id]) }), 'running');
  assert.equal(childVisualState(failed), 'idle-unviewed');
  assert.equal(childVisualState({ ...failed, viewedAt: '2026-01-05T00:00:00.000Z' }), 'idle-viewed');
});

test('running pulse is deterministic and reduced motion remains steady bold yellow', () => {
  assert.notEqual(visualStyle('running', { phase: 0 }).ansi, visualStyle('running', { phase: 1 }).ansi);
  assert.equal(visualStyle('running', { phase: 0, reducedMotion: true }).ansi, visualStyle('running', { phase: 1, reducedMotion: true }).ansi);
  assert.match(visualStyle('running', { phase: 1, reducedMotion: true }).ansi, new RegExp(STYLE.bold.replace('[', '\\[')));
});

test('renders framed count-first actions, exact top-right links, version, close, tips, and no Quit', () => {
  const layout = layoutChrome(fixture(), { columns: 100, rows: 12, version: '1.2.3', expandedWorkstreamId: 'one', activeAction: 'Plans' }); const plain = layout.plainLines.join('\n');
  assert.match(plain, /\[New\] \[2 Plans\] \[2 Sessions\] \[4 Review\] \[Close\]/); assert.doesNotMatch(plain, /Quit/);
  assert.match(plain, /\[Report Issue\] \[Star on GitHub\] bdfl 1\.2\.3/); assert.match(plain, /Ctrl\+C twice quits/); assert.equal(layout.tipRow < layout.frame.bottom, true);
  assert.equal(layout.links.find((item) => item.link === 'report').url, ISSUE_URL); assert.equal(layout.links.find((item) => item.link === 'repository').url, REPOSITORY_URL);
  assert.match(layout.lines[1], new RegExp(`${STYLE.black.replace('[', '\\[')}${STYLE.bgYellow.replace('[', '\\[')}`)); assert.match(layout.lines[1], new RegExp(STYLE.red.replace('[', '\\[')));
  assert.equal(renderChrome(fixture(), { columns: 100, rows: 12 }).split('\n').length, 12);
});

test('uses exclusive active highlighting and connected creation-stable parent and child rows', () => {
  const state = fixture(); const layout = layoutChrome(state, { columns: 100, rows: 10, expandedWorkstreamId: 'one', activeSessionId: 'worker', activeAction: 'Review', runningSessionIds: new Set(['lead']) });
  assert.equal(layout.activeSessionId, null); assert.equal(layout.actions.find((item) => item.action === 'Review').state, 'active'); assert.equal(layout.children.some((item) => item.state === 'active'), false);
  assert.deepEqual(layout.parents.map((item) => item.workstreamId), ['two', 'one']); assert.deepEqual(layout.children.map((item) => item.sessionId), ['lead', 'worker', 'verifier']);
  const parent = layout.parents.find((item) => item.workstreamId === 'one'); assert.equal(layout.plainLines[layout.childRow - 1][parent.connectorColumn - 1], '├'); assert.equal(layout.plainLines[layout.parentRow - 1][parent.connectorColumn - 1], '│');
  const childLayout = layoutChrome(state, { columns: 100, rows: 10, expandedWorkstreamId: 'one', activeSessionId: 'worker' }); assert.equal(childLayout.children.find((item) => item.sessionId === 'worker').state, 'active'); assert.equal(childLayout.actions.some((item) => item.state === 'active'), false); assert.notEqual(childLayout.parents.find((item) => item.workstreamId === 'one').state, 'active');
});

test('all visible badges have exact hitboxes and narrow layouts stay inside the frame', () => {
  for (const columns of [100, 42, 20, 12]) {
    const layout = layoutChrome(fixture(), { columns, rows: 8, expandedWorkstreamId: 'one', activeSessionId: 'lead' });
    assert.equal(layout.plainLines.every((line) => textWidth(line) === columns), true);
    for (const hit of layout.hits) { const line = layout.plainLines[hit.row - 1]; const value = [...line].slice(hit.start - 1, hit.end).join(''); assert.equal(textWidth(value), hit.end - hit.start + 1); assert.ok(hit.start >= 2 && hit.end < columns); }
    assert.equal(stripAnsi(layout.output).split('\n').every((line) => textWidth(line) === columns), true);
  }
});

test('CJK and combining-mark names occupy terminal cells without shifting later badges or hits', () => {
  const state = fixture();
  state.workstreams[0].title = '「会議」 e\u0301';
  state.sessions[0].name = '設計 e\u0301';
  state.sessions[1].name = '作業員';
  for (const columns of [70, 34, 20, 12]) {
    const layout = layoutChrome(state, { columns, rows: 8, expandedWorkstreamId: 'one', activeSessionId: 'lead' });
    assert.equal(layout.plainLines.every((line) => textWidth(line) === columns), true);
    assert.equal(stripAnsi(layout.output).split('\n').every((line) => textWidth(line) === columns), true);
    for (const hit of layout.hits) {
      const line = layout.plainLines[hit.row - 1];
      const rendered = [...layout.actions, ...layout.links, ...layout.parents, ...layout.children].find((item) => item.row === hit.row && item.start === hit.start && item.end === hit.end);
      assert.equal(displaySlice(line, hit.start, hit.end), rendered.text);
      assert.equal(hitAt(layout, hit.row, hit.start), hit);
      assert.equal(hitAt(layout, hit.row, hit.end), hit);
      assert.ok(hit.start >= 2 && hit.end < columns);
    }
  }
});
