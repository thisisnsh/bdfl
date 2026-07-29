'use strict';

const { ISSUE_URL, REPOSITORY_URL } = require('../core/errors');

const ESC = '\u001b[';
const STYLE = {
  yellow: `${ESC}38;5;220m`, gray: `${ESC}38;5;245m`, red: `${ESC}38;5;203m`,
  black: `${ESC}38;5;16m`, bgYellow: `${ESC}48;5;220m`,
  bold: `${ESC}1m`, underline: `${ESC}4m`, dim: `${ESC}2m`, reset: `${ESC}0m`
};
const ACTIONS = ['New', 'Plans', 'Sessions', 'Reviews', 'Close'];
const DONE_STATUSES = new Set(['accepted', 'cancelled', 'closed', 'complete', 'completed', 'done', 'integrated', 'rejected', 'superseded']);
const TIP = '↑↓ scroll • Click agents to switch • Ctrl+C twice quits';
const GRAPHEME_SEGMENTER = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

function characterWidth(character) {
  if (![...character].some((value) => !/[\p{Mark}\u200d\ufe0e\ufe0f]/u.test(value))) return 0;
  return /\p{Extended_Pictographic}|\p{Regional_Indicator}|\p{Script=Han}|\p{Script=Hangul}|\p{Script=Hiragana}|\p{Script=Katakana}|[\u1100-\u115f\u2329\u232a\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe19\ufe30-\ufe6f\uff01-\uff60\uffe0-\uffe6]|[\u{20000}-\u{3fffd}]/u.test(character) ? 2 : 1;
}
function graphemes(value) { return [...GRAPHEME_SEGMENTER.segment(`${value ?? ''}`)].map(({ segment }) => segment); }
function stripAnsi(value) { return `${value ?? ''}`.replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/gu, '').replace(/\u001b\[[0-?]*[ -/]*[@-~]/gu, ''); }
function textWidth(value) { return graphemes(stripAnsi(value)).reduce((sum, character) => sum + characterWidth(character), 0); }
function cropText(value, columns, ellipsis = false) {
  const input = stripAnsi(value); if (columns <= 0) return '';
  const clipped = textWidth(input) > columns; const limit = clipped && ellipsis ? Math.max(0, columns - 1) : columns; let result = ''; let used = 0;
  for (const character of graphemes(input)) { const size = characterWidth(character); if (used + size > limit) break; result += character; used += size; }
  return `${result}${clipped && ellipsis ? '…' : ''}`;
}
function fitText(value, columns) { const cropped = cropText(value, columns); return `${cropped}${' '.repeat(Math.max(0, columns - textWidth(cropped)))}`; }
function timestamp(value) { const parsed = Date.parse(value || ''); return Number.isFinite(parsed) ? parsed : 0; }
function createdOrder(items) { return (items || []).map((item, index) => ({ item, index })).sort((a, b) => timestamp(b.item.createdAt) - timestamp(a.item.createdAt) || a.index - b.index).map(({ item }) => item); }
function childOrder(items) { return (items || []).map((item, index) => ({ item, index })).sort((a, b) => (a.item.paneNumber || 0) - (b.item.paneNumber || 0) || (a.item.roleSequence || 0) - (b.item.roleSequence || 0) || a.index - b.index).map(({ item }) => item); }
function label(value, fallback) { const normalized = `${value || fallback}`.replace(/[\u0000-\u001f\u007f-\u009f]/gu, ' ').replace(/\s+/gu, ' ').trim(); return normalized || fallback; }
function isDone(child, executionStatus) { const status = `${executionStatus || child.executionStatus || child.attemptStatus || child.status || ''}`.toLowerCase(); return Boolean(child.accepted || child.completed || child.superseded || DONE_STATUSES.has(status)); }
function hasUnseenActivity(child) { return timestamp(child.activityAt) > timestamp(child.viewedAt); }
function runningFor(child, options) {
  if (child.turnState) return child.turnState === 'working';
  if (typeof options.isRunning === 'function') return Boolean(options.isRunning(child.id, child));
  const running = options.runningSessionIds;
  return Boolean(running?.has?.(child.id) || Array.isArray(running) && running.includes(child.id) || child.activityState === 'running' || child.terminalActivity === 'running' || child.recentlyActive === true);
}
function childVisualState(child, options = {}) {
  if (child.id === options.activeSessionId) return 'active';
  if (child.turnState === 'idle') return 'idle-viewed';
  if (child.turnState === 'working') return 'working';
  const executionStatus = options.executionStatuses instanceof Map ? options.executionStatuses.get(child.id) : options.executionStatuses?.[child.id];
  if (isDone(child, executionStatus)) return 'idle-viewed';
  if (runningFor(child, options)) return 'working';
  return hasUnseenActivity(child) ? 'working' : 'idle-viewed';
}
function parentVisualState(children, options = {}) {
  const primary = (children || []).find((child) => ['delegator', 'direct'].includes(child.role)) || children?.[0];
  return primary ? childVisualState(primary, { ...options, activeSessionId: null }) : 'idle-viewed';
}
function pulsePhase() { return 0; }
function visualStyle(state) {
  if (state === 'active') return { state, ansi: `${STYLE.bgYellow}${STYLE.black}${STYLE.bold}`, inverse: true, color: 'yellow' };
  if (state === 'working' || state === 'running' || state === 'idle-unviewed') return { state, ansi: `${STYLE.yellow}${STYLE.bold}`, inverse: false, color: 'yellow' };
  return { state, ansi: STYLE.gray, inverse: false, color: 'gray' };
}
function styled(text, state, options) { return `${visualStyle(state, options).ansi}${text}${STYLE.reset}`; }
function badge(value, budget = Infinity) { if (Number.isFinite(budget) && budget < 3) return cropText(`[${value}]`, Math.max(0, budget)); const available = Math.max(1, budget - 2); return `[${cropText(value, available, textWidth(value) > available)}]`; }
function visibleWindow(items, budget, focusIndex = 0) {
  if (!items.length || budget <= 0) return [];
  const focus = Math.max(0, Math.min(focusIndex, items.length - 1)); let start = focus; let end = focus + 1; let used = textWidth(items[focus].text);
  if (used > budget) return [items[focus]];
  while (true) {
    let changed = false;
    if (start > 0) { const required = textWidth(items[start - 1].text) + 1; if (used + required <= budget) { start -= 1; used += required; changed = true; } }
    if (end < items.length) { const required = textWidth(items[end].text) + 1; if (used + required <= budget) { used += required; end += 1; changed = true; } }
    if (!changed) break;
  }
  return items.slice(start, end);
}
function frameGeometry(columns = 100, rows = 28) { const width = Math.max(4, Number(columns) || 100); const height = Math.max(5, Number(rows) || 28); return { columns: width, rows: height, inner: width - 2, top: 1, left: 1, right: width, bottom: height, actionRow: 1, childRow: height, parentRow: height }; }
function put(canvas, row, column, text) {
  if (row < 1 || row > canvas.length || column < 1) return;
  const line = canvas[row - 1]; let cell = column - 1; let previous = -1;
  for (const character of graphemes(text)) { const size = characterWidth(character); if (!size) { if (previous >= 0) line[previous] += character; continue; } if (cell + size > line.length) break; line[cell] = character; for (let offset = 1; offset < size; offset += 1) line[cell + offset] = ''; previous = cell; cell += size; }
}
function addHit(hits, item, row, start, text) { const hit = { ...item, row, start, end: start + textWidth(text) - 1 }; hits.push(hit); return hit; }
function hitAt(layout, row, column) { return layout?.hits?.findLast((hit) => hit.row === row && column >= hit.start && column <= hit.end) || null; }
function workerName(child) {
  if (child.role === 'verifier') return 'Worker: Review';
  if (child.role === 'integration') return `Worker: ${child.workerPhase || (child.executionStatus === 'verifying' ? 'Review' : 'Integration')}`;
  return `Worker: ${label(child.chunkTitle || child.workerTitle || child.taskSnippet || child.chunkId || child.name, 'Task')}`;
}
function agentName(child) {
  if (child.role === 'delegator') return label(child.name, 'Planning agent');
  if (child.role === 'direct') return label(child.name, 'Direct agent');
  return workerName(child);
}
function railBadge(item, budget) {
  const value = agentName(item.child);
  let text = badge(value, budget);
  if (textWidth(text) > budget || budget < textWidth('[Worker: ]')) text = badge(value.replace(/^Worker:/u, 'W:'), budget);
  return text;
}
function styleLine(line, row, ranges) {
  let result = ''; let active = null;
  for (let index = 0; index < line.length; index += 1) {
    const starting = ranges.find((range) => range.row === row && range.start === index + 1); const ending = ranges.find((range) => range.row === row && range.end === index + 1);
    if (starting) { result += starting.ansi; active = starting; }
    result += line[index];
    if (ending && active === ending) { result += `${STYLE.reset}${STYLE.yellow}`; active = null; }
  }
  if (active) result += STYLE.reset;
  return `${STYLE.yellow}${result}${STYLE.reset}`;
}

function layoutChrome(workspace = {}, options = {}) {
  const geometry = frameGeometry(options.columns, options.rows); const { columns, rows, inner } = geometry;
  const activeAction = ACTIONS.includes(options.activeAction) ? options.activeAction : null; const activeSessionId = activeAction ? null : options.activeSessionId || null;
  const hits = []; const links = []; const actions = []; const parents = []; const children = []; const ranges = [];
  const canvas = Array.from({ length: rows }, () => Array(columns).fill(' '));
  put(canvas, 1, 1, `┌${'─'.repeat(inner)}┐`); for (let row = 2; row < rows; row += 1) { put(canvas, row, 1, '│'); put(canvas, row, columns, '│'); } put(canvas, rows, 1, `└${'─'.repeat(inner)}┘`);

  const left = [{ type: 'title', text: `bdfl${options.title ? ` - ${label(options.title, 'Session')}` : ''}` }, { type: 'link', link: 'repository', url: REPOSITORY_URL, text: '[Star]' }, { type: 'link', link: 'report', url: ISSUE_URL, text: '[Report issues]' }];
  let column = 3; const actionItems = ACTIONS.filter((action) => action !== 'Close' || options.showClose !== false).map((action) => ({ type: 'action', action, text: `[${action}]` }));
  const actionWidth = actionItems.reduce((sum, item) => sum + textWidth(item.text), Math.max(0, actionItems.length - 1)); const leftBudget = Math.min(inner, Math.max(Math.min(4, inner), inner - actionWidth - 3)); const visibleLeft = [];
  if (leftBudget > 0) visibleLeft.push({ ...left[0], text: cropText(left[0].text, leftBudget, true) });
  for (const item of left.slice(1)) { const used = visibleLeft.reduce((sum, value) => sum + textWidth(value.text), Math.max(0, visibleLeft.length - 1)); const needed = textWidth(item.text) + (visibleLeft.length ? 1 : 0); if (used + needed <= leftBudget) visibleLeft.push(item); }
  for (const item of visibleLeft) { if (column > 3) { put(canvas, 1, column, ' '); column += 1; } put(canvas, 1, column, item.text); if (item.type === 'link') { const hit = addHit(hits, item, 1, column, item.text); links.push({ ...item, ...hit }); ranges.push({ ...hit, ansi: STYLE.yellow }); } column += textWidth(item.text); }
  let actionColumn = columns - 1 - actionWidth;
  if (actionColumn <= column) { const available = Math.max(0, columns - column - 2); const focus = Math.max(0, actionItems.findIndex((item) => item.action === activeAction)); const visible = visibleWindow(actionItems, available, focus); const used = visible.reduce((sum, item) => sum + textWidth(item.text), Math.max(0, visible.length - 1)); actionColumn = columns - 1 - used; actionItems.splice(0, actionItems.length, ...visible); }
  for (const [index, item] of actionItems.entries()) { put(canvas, 1, actionColumn, item.text); const state = item.action === activeAction ? 'active' : 'top'; const hit = addHit(hits, item, 1, actionColumn, item.text); actions.push({ ...item, ...hit, state }); ranges.push({ ...hit, ansi: state === 'active' ? `${STYLE.bgYellow}${STYLE.black}${STYLE.bold}` : STYLE.yellow }); actionColumn += textWidth(item.text); if (index < actionItems.length - 1) { put(canvas, 1, actionColumn, ' '); actionColumn += 1; } }

  const streams = createdOrder(workspace.workstreams || []); const candidates = [];
  for (const stream of streams) {
    const group = childOrder((workspace.sessions || []).filter((session) => session.workstreamId === stream.id));
    for (const child of group) if (child.id === activeSessionId || options.isOpen?.(child.id, child) || !child.explicitlyClosed && ['running', 'bridge-reconnecting', 'bridge-error'].includes(child.status)) candidates.push({ kind: 'agent', stream, child, text: badge(agentName(child)) });
  }
  const focusIndex = Math.max(0, candidates.findIndex((item) => item.child.id === activeSessionId)); let visible = visibleWindow(candidates, Math.max(0, inner - 2), focusIndex);
  if (visible.length === 1 && textWidth(visible[0].text) > inner - 2) visible = [{ ...visible[0], text: railBadge(visible[0], Math.max(0, inner - 2)) }];
  column = 3;
  for (const item of visible) {
    if (column > 3) { put(canvas, rows, column, ' '); column += 1; }
    const text = item.text; put(canvas, rows, column, text);
    const state = childVisualState(item.child, { ...options, activeSessionId }); const hit = addHit(hits, { type: 'child', sessionId: item.child.id, workstreamId: item.stream.id }, rows, column, text); children.push({ child: item.child, text, ...hit, state }); ranges.push({ ...hit, ansi: visualStyle(state).ansi });
    column += textWidth(text);
  }

  const tip = cropText(options.tip === undefined ? TIP : options.tip, Math.max(0, inner - 4), true); const tipRow = tip ? rows - 1 : null;
  if (tip) put(canvas, tipRow, Math.max(3, columns - 1 - textWidth(tip)), tip);
  const plainLines = canvas.map((line) => line.join('')); const lines = canvas.map((line, index) => styleLine(line, index + 1, ranges));
  return { ...geometry, activeAction, activeSessionId, phase: 0, plainLines, lines, output: lines.join('\n'), actions, links, parents, children, hits, frame: { top: 1, left: 1, right: columns, bottom: rows }, tipRow };
}

function renderChrome(workspace, options) { return layoutChrome(workspace, options).output; }
class Chrome { constructor(options = {}) { this.options = { ...options }; this.lastLayout = null; } layout(workspace, options = {}) { this.lastLayout = layoutChrome(workspace, { ...this.options, ...options }); return this.lastLayout; } render(workspace, options = {}) { return this.layout(workspace, options).output; } }

module.exports = { STYLE, ACTIONS, DONE_STATUSES, TIP, characterWidth, stripAnsi, textWidth, cropText, fitText, createdOrder, childOrder, visibleWindow, childVisualState, sessionVisualState: childVisualState, parentVisualState, aggregateVisualState: parentVisualState, pulsePhase, visualStyle, frameGeometry, hitAt, layoutChrome, renderChrome, Chrome, workerName, agentName };
