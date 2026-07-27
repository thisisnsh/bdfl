'use strict';

const { ISSUE_URL, REPOSITORY_URL } = require('../core/errors');

const ESC = '\u001b[';
const STYLE = {
  yellow: `${ESC}38;5;220m`, gray: `${ESC}38;5;245m`, red: `${ESC}38;5;203m`, black: `${ESC}38;5;16m`,
  bgYellow: `${ESC}48;5;220m`, bold: `${ESC}1m`, dim: `${ESC}2m`, reset: `${ESC}0m`
};
const ACTIONS = ['New', 'Plans', 'Sessions', 'Review', 'Close'];
const DONE_STATUSES = new Set(['accepted', 'cancelled', 'closed', 'complete', 'completed', 'done', 'integrated', 'paused', 'rejected', 'superseded']);
const TIP = 'Ctrl+C twice quits · Click a session to expand its agents';
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

function isDone(child, executionStatus) {
  const status = `${executionStatus || child.executionStatus || child.attemptStatus || child.status || ''}`.toLowerCase();
  return Boolean(child.explicitlyClosed || child.accepted || child.completed || child.superseded || DONE_STATUSES.has(status));
}
function hasUnseenActivity(child) { return timestamp(child.activityAt) > timestamp(child.viewedAt); }
function runningFor(child, options) {
  if (typeof options.isRunning === 'function') return Boolean(options.isRunning(child.id, child));
  const running = options.runningSessionIds;
  return Boolean(running?.has?.(child.id) || Array.isArray(running) && running.includes(child.id) || child.activityState === 'running' || child.terminalActivity === 'running' || child.recentlyActive === true);
}
function childVisualState(child, options = {}) {
  if (child.id === options.activeSessionId) return 'active';
  const executionStatus = options.executionStatuses instanceof Map ? options.executionStatuses.get(child.id) : options.executionStatuses?.[child.id];
  if (isDone(child, executionStatus)) return 'done';
  if (runningFor(child, options)) return 'running';
  return hasUnseenActivity(child) ? 'idle-unviewed' : 'idle-viewed';
}
function parentVisualState(children, options = {}) {
  const states = (children || []).map((child) => childVisualState(child, { ...options, activeSessionId: null }));
  if (states.includes('running')) return 'running';
  if (states.includes('idle-unviewed')) return 'idle-unviewed';
  return 'idle-viewed';
}
function pulsePhase(now = Date.now(), interval = 240) { return Math.floor(Number(now) / interval) % 2; }
function visualStyle(state, { reducedMotion = false, phase = 0 } = {}) {
  if (state === 'active') return { state, ansi: `${STYLE.black}${STYLE.bgYellow}${STYLE.bold}`, inverse: true, color: 'yellow' };
  if (state === 'running') return { state, ansi: reducedMotion || phase % 2 === 0 ? `${STYLE.yellow}${STYLE.bold}` : `${STYLE.yellow}${STYLE.dim}`, inverse: false, color: 'yellow' };
  if (state === 'idle-unviewed') return { state, ansi: `${STYLE.yellow}${STYLE.bold}`, inverse: false, color: 'yellow' };
  return { state, ansi: STYLE.gray, inverse: false, color: 'gray' };
}
function styled(text, state, options) { return `${visualStyle(state, options).ansi}${text}${STYLE.reset}`; }
function label(value, fallback) { const normalized = `${value || fallback}`.replace(/[\u0000-\u001f\u007f-\u009f]/gu, ' ').replace(/\s+/gu, ' ').trim(); return normalized || fallback; }
function badge(value, budget = Infinity) { if (Number.isFinite(budget) && budget < 3) return cropText(`[${value}]`, Math.max(0, budget)); const available = Math.max(1, budget - 2); return `[${cropText(value, available, textWidth(value) > available)}]`; }
function actionItems(workspace, showClose) {
  const counts = { Plans: workspace.planCount ?? workspace.plans?.length ?? 0, Sessions: workspace.sessionCount ?? workspace.workstreams?.length ?? 0, Review: workspace.reviewCount ?? workspace.reviews?.length ?? 0 };
  return ACTIONS.filter((action) => action !== 'Close' || showClose).map((action) => ({ type: 'action', action, text: `[${counts[action] === undefined ? action : `${counts[action]} ${action}`}]` }));
}
function childrenFor(workspace, workstreamId) { return childOrder((workspace.sessions || []).filter((child) => child.workstreamId === workstreamId)); }
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
function frameGeometry(columns = 100, rows = 28) { const width = Math.max(4, Number(columns) || 100); const height = Math.max(6, Number(rows) || 28); return { columns: width, rows: height, inner: width - 2, top: 1, left: 1, right: width, bottom: height, actionRow: 2, childRow: height - 2, parentRow: height - 1 }; }
function put(canvas, row, column, text) {
  if (row < 1 || row > canvas.length || column < 1) return;
  const line = canvas[row - 1]; let cell = column - 1; let previous = -1;
  for (const character of graphemes(text)) {
    const size = characterWidth(character);
    if (!size) { if (previous >= 0) line[previous] += character; continue; }
    if (cell + size > line.length) break;
    line[cell] = character;
    for (let offset = 1; offset < size; offset += 1) line[cell + offset] = '';
    previous = cell; cell += size;
  }
}
function addHit(hits, item, row, start, text) { const hit = { ...item, row, start, end: start + textWidth(text) - 1 }; hits.push(hit); return hit; }
function hitAt(layout, row, column) { return layout?.hits?.find((hit) => hit.row === row && column >= hit.start && column <= hit.end) || null; }

function layoutChrome(workspace = {}, options = {}) {
  const geometry = frameGeometry(options.columns, options.rows); const { columns, rows, inner } = geometry;
  const version = label(options.version, 'unknown'); const expandedWorkstreamId = options.expandedWorkstreamId || options.activeWorkstreamId || workspace.activeWorkstreamId || null;
  const activeAction = ACTIONS.includes(options.activeAction) ? options.activeAction : null; const activeSessionId = activeAction ? null : options.activeSessionId || null;
  const phase = options.phase ?? pulsePhase(options.now); const motion = { phase, reducedMotion: Boolean(options.reducedMotion) };
  const hits = []; const links = []; const actions = []; const parents = []; const children = [];
  const canvas = Array.from({ length: rows }, () => Array(columns).fill(' '));
  put(canvas, 1, 1, `┌${'─'.repeat(inner)}┐`); for (let row = 2; row < rows; row += 1) { put(canvas, row, 1, '│'); put(canvas, row, columns, '│'); } put(canvas, rows, 1, `└${'─'.repeat(inner)}┘`);

  const headerCandidates = [
    { type: 'link', link: 'report', url: ISSUE_URL, text: '[Report Issue]' },
    { type: 'link', link: 'repository', url: REPOSITORY_URL, text: '[Star on GitHub]' },
    { type: 'version', text: `bdfl ${version}` }
  ];
  const versionItem = headerCandidates.at(-1); versionItem.text = cropText(versionItem.text, Math.max(0, inner - 2), true); const visibleHeader = versionItem.text ? [versionItem] : []; let headerWidth = textWidth(versionItem.text);
  for (let index = headerCandidates.length - 2; index >= 0; index -= 1) { const candidate = headerCandidates[index]; const required = textWidth(candidate.text) + 1; if (headerWidth + required <= inner - 2) { visibleHeader.unshift(candidate); headerWidth += required; } }
  let headerColumn = columns - 1 - headerWidth;
  for (const [index, item] of visibleHeader.entries()) { if (index) { put(canvas, 1, headerColumn, ' '); headerColumn += 1; } put(canvas, 1, headerColumn, item.text); if (item.type === 'link') links.push(addHit(hits, item, 1, headerColumn, item.text)); headerColumn += textWidth(item.text); }

  let column = 3; const allActions = actionItems(workspace, options.showClose !== false); const actionFocus = Math.max(0, allActions.findIndex((item) => item.action === activeAction)); const visibleActions = visibleWindow(allActions, columns - 4, actionFocus);
  if (visibleActions.length === 1 && textWidth(visibleActions[0].text) > columns - 4) visibleActions[0] = { ...visibleActions[0], text: badge(visibleActions[0].text.slice(1, -1), columns - 4) };
  for (const item of visibleActions) {
    const gap = actions.length ? 1 : 0; column += gap; put(canvas, 2, column, item.text); const state = item.action === activeAction ? 'active' : item.action === 'Close' ? 'close' : 'idle-viewed'; const hit = addHit(hits, item, 2, column, item.text); actions.push({ ...item, ...hit, state }); column += textWidth(item.text);
  }

  const workstreams = createdOrder(workspace.workstreams || []); const parentRow = rows - 1; const childRow = rows - 2; column = 3;
  const parentCandidates = workstreams.map((stream) => ({ stream, text: badge(label(stream.name || stream.title, 'Session')) })); const parentFocus = Math.max(0, parentCandidates.findIndex(({ stream }) => stream.id === expandedWorkstreamId)); const visibleParents = visibleWindow(parentCandidates, columns - 4, parentFocus);
  if (visibleParents.length === 1 && textWidth(visibleParents[0].text) > columns - 4) visibleParents[0] = { ...visibleParents[0], text: badge(label(visibleParents[0].stream.name || visibleParents[0].stream.title, 'Session'), columns - 4) };
  for (const candidate of visibleParents) {
    const { stream, text } = candidate; const allChildren = childrenFor(workspace, stream.id); const state = parentVisualState(allChildren, { ...options, activeSessionId: null }); const gap = parents.length ? 1 : 0;
    column += gap; const connectorColumn = stream.id === expandedWorkstreamId ? column - 1 : null; if (connectorColumn) put(canvas, parentRow, connectorColumn, '│'); put(canvas, parentRow, column, text);
    const hit = addHit(hits, { type: 'parent', workstreamId: stream.id }, parentRow, column, text); parents.push({ stream, text, ...hit, state, connectorColumn }); column += textWidth(text);
  }
  const expanded = parents.find((item) => item.workstreamId === expandedWorkstreamId);
  if (expanded) {
    const candidates = childrenFor(workspace, expandedWorkstreamId).map((child) => ({ child, text: badge(label(child.name, child.role || 'Agent')) }));
    const rightBudget = columns - expanded.connectorColumn - 2; const leftBudget = expanded.connectorColumn - 3; const onRight = rightBudget >= leftBudget; const budget = Math.max(0, onRight ? rightBudget : leftBudget); const childFocus = Math.max(0, candidates.findIndex(({ child }) => child.id === activeSessionId)); const visible = visibleWindow(candidates, budget, childFocus); let used = visible.reduce((sum, item) => sum + textWidth(item.text), Math.max(0, visible.length - 1));
    if (visible.length === 1 && textWidth(visible[0].text) > budget) { visible[0] = { ...visible[0], text: badge(label(visible[0].child.name, visible[0].child.role || 'Agent'), budget) }; used = textWidth(visible[0].text); }
    let childColumn = onRight ? expanded.connectorColumn + 2 : expanded.connectorColumn - 1 - used;
    if (visible.length) { put(canvas, childRow, expanded.connectorColumn, onRight ? '├' : '┤'); put(canvas, childRow, expanded.connectorColumn + (onRight ? 1 : -1), '─'); }
    for (const [index, candidate] of visible.entries()) {
      if (index) { put(canvas, childRow, childColumn, '─'); childColumn += 1; }
      const state = childVisualState(candidate.child, { ...options, activeSessionId }); put(canvas, childRow, childColumn, candidate.text); const hit = addHit(hits, { type: 'child', sessionId: candidate.child.id, workstreamId: expandedWorkstreamId }, childRow, childColumn, candidate.text); children.push({ child: candidate.child, text: candidate.text, ...hit, state }); childColumn += textWidth(candidate.text);
    }
  }

  const tip = cropText(options.tip === undefined ? TIP : options.tip, Math.max(0, inner - 4), true); if (tip && rows > 6) put(canvas, rows - 3, 3, tip);
  const plainLines = canvas.map((line) => line.join('')); const styles = new Map();
  for (const item of [...actions, ...parents, ...children]) styles.set(`${item.row}:${item.start}:${item.end}`, item.state === 'close' ? `${STYLE.red}${STYLE.bold}` : visualStyle(item.state, motion).ansi);
  for (const item of links) styles.set(`${item.row}:${item.start}:${item.end}`, STYLE.yellow);
  const lines = canvas.map((line, rowIndex) => {
    let result = ''; let active = null;
    for (let index = 0; index < line.length; index += 1) {
      const ending = [...styles.entries()].find(([key]) => { const [row, , end] = key.split(':').map(Number); return row === rowIndex + 1 && end === index + 1; });
      const starting = [...styles.entries()].find(([key]) => { const [row, start] = key.split(':').map(Number); return row === rowIndex + 1 && start === index + 1; });
      if (starting) { result += starting[1]; active = starting[0]; }
      result += line[index];
      if (ending && active === ending[0]) { result += `${STYLE.reset}${STYLE.yellow}`; active = null; }
    }
    if (active) result += STYLE.reset;
    return `${STYLE.yellow}${result}${STYLE.reset}`;
  });
  return { ...geometry, activeAction, activeSessionId, phase, plainLines, lines, output: lines.join('\n'), actions, links, parents, children, hits, frame: { top: 1, left: 1, right: columns, bottom: rows }, tipRow: tip ? rows - 3 : null };
}

function renderChrome(workspace, options) { return layoutChrome(workspace, options).output; }

class Chrome {
  constructor(options = {}) { this.options = { ...options }; this.lastLayout = null; }
  layout(workspace, options = {}) { this.lastLayout = layoutChrome(workspace, { ...this.options, ...options }); return this.lastLayout; }
  render(workspace, options = {}) { return this.layout(workspace, options).output; }
}

module.exports = { STYLE, ACTIONS, DONE_STATUSES, TIP, characterWidth, stripAnsi, textWidth, cropText, fitText, createdOrder, childOrder, visibleWindow, childVisualState, sessionVisualState: childVisualState, parentVisualState, aggregateVisualState: parentVisualState, pulsePhase, visualStyle, frameGeometry, hitAt, layoutChrome, renderChrome, Chrome };
