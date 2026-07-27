'use strict';

const ESC = '\u001b[';
const COLORS = Object.freeze({
  blue: `${ESC}38;5;75m`,
  cyan: `${ESC}38;5;81m`,
  green: `${ESC}38;5;114m`,
  red: `${ESC}38;5;203m`,
  yellow: `${ESC}38;5;220m`,
  gray: `${ESC}38;5;245m`,
  inverse: `${ESC}7m`,
  reset: `${ESC}0m`
});

function characterWidth(character) {
  if (/\p{Mark}/u.test(character)) return 0;
  return /\p{Extended_Pictographic}|\p{Script=Han}|\p{Script=Hangul}|\p{Script=Hiragana}|\p{Script=Katakana}|[\uFF01-\uFF60\uFFE0-\uFFE6]/u.test(character) ? 2 : 1;
}

function width(value) {
  return [...`${value}`.replace(/\u001b\[[0-9;?]*[A-Za-z]/gu, '')].reduce((total, character) => total + characterWidth(character), 0);
}

function wrapLine(value, columns) {
  const text = `${value}`;
  const limit = Math.max(1, columns);
  if (!text || width(text) <= limit) return [text];
  const rows = [];
  let row = '';
  let used = 0;
  for (const character of text) {
    const size = characterWidth(character);
    if (row && used + size > limit) { rows.push(row); row = ''; used = 0; }
    row += character;
    used += size;
  }
  if (row || !rows.length) rows.push(row);
  return rows;
}

function patchLineType(line) {
  if (/^(?:diff --git |index |similarity index |dissimilarity index |rename (?:from|to) |copy (?:from|to) |new file mode |deleted file mode |old mode |new mode |--- |\+\+\+ )/u.test(line)) return 'file';
  if (line.startsWith('@@')) return 'hunk';
  if (line.startsWith('+')) return 'addition';
  if (line.startsWith('-')) return 'removal';
  return 'context';
}

function unquotePath(value) {
  const path = `${value || ''}`.trim();
  if (path.startsWith('"') && path.endsWith('"')) {
    try { return JSON.parse(path); } catch {}
  }
  return path;
}

function displayPath(value) {
  const path = unquotePath(value);
  return path === '/dev/null' ? '' : path.replace(/^[ab]\//u, '');
}

function diffPaths(line) {
  const match = /^diff --git (?:("(?:[^"\\]|\\.)*")|(\S+)) (?:("(?:[^"\\]|\\.)*")|(\S+))$/u.exec(line);
  if (!match) return null;
  return { oldPath: displayPath(match[1] || match[2]), newPath: displayPath(match[3] || match[4]) };
}

function parsePatch(value) {
  let file = '';
  let oldPath = '';
  let newPath = '';
  let hunk = '';
  return `${value ?? ''}`.replace(/\r\n?/gu, '\n').split('\n').map((text, index) => {
    const paths = diffPaths(text);
    if (paths) { oldPath = paths.oldPath; newPath = paths.newPath; file = newPath || oldPath; hunk = ''; }
    else if (text.startsWith('rename from ') || text.startsWith('copy from ')) oldPath = displayPath(text.replace(/^(?:rename|copy) from /u, '')) || oldPath;
    else if (text.startsWith('rename to ') || text.startsWith('copy to ')) { newPath = displayPath(text.replace(/^(?:rename|copy) to /u, '')) || newPath; file = newPath || oldPath; }
    else if (text.startsWith('--- ')) { oldPath = displayPath(text.slice(4)); file = newPath || oldPath || file; }
    else if (text.startsWith('+++ ')) { newPath = displayPath(text.slice(4)); file = newPath || oldPath || file; }
    if (text.startsWith('@@')) hunk = text;
    return Object.freeze({ text, type: patchLineType(text), file, hunk, sourceLine: index + 1 });
  });
}

function selectionContains(selection, row) {
  return selection.file === row.file && selection.hunk === row.hunk && row.sourceLine >= selection.startLine && row.sourceLine <= selection.endLine;
}

function colorFor(type) {
  if (type === 'file') return COLORS.blue;
  if (type === 'hunk') return COLORS.cyan;
  if (type === 'addition') return COLORS.green;
  if (type === 'removal') return COLORS.red;
  return '';
}

function renderPatch(value, columns, selections = [], preview = []) {
  let visualLine = 0;
  return parsePatch(value).flatMap((source) => wrapLine(source.text, Math.max(8, columns)).map((text, wrapIndex) => {
    const selected = [...selections, ...preview].some((selection) => selectionContains(selection, source));
    const color = colorFor(source.type);
    const styled = `${color}${selected ? COLORS.inverse : ''}${text}${color || selected ? COLORS.reset : ''}`;
    return Object.freeze({ ...source, text, sourceText: source.text, wrapIndex, visualLine: visualLine++, selected, styled });
  }));
}

function itemKey(item) {
  return `${item?.executionId || item?.execution?.id || ''}\u0000${item?.id || item?.chunkId || ''}`;
}

function stateDescriptor(item = {}) {
  const status = item.status || 'review';
  const feedback = item.feedback || [];
  if (status === 'accepted') return { label: 'Accepted', tone: 'green', actions: [] };
  if (['complete', 'completed'].includes(status)) return { label: 'Complete', tone: 'green', actions: [] };
  if (status === 'review') return { label: 'Ready for review', tone: 'yellow', actions: ['accept', 'feedback'] };
  if (['waiting', 'blocked'].includes(status)) return { label: 'Waiting for response', tone: 'yellow', actions: ['feedback'] };
  if (status === 'running' && item.attention) return { label: 'Needs response', tone: 'yellow', actions: ['feedback'] };
  if (status === 'running' && feedback.length) return { label: 'Feedback sent · Revising', tone: 'yellow', actions: [] };
  if (['checking', 'integration-checking'].includes(status)) return { label: 'Checking', tone: 'yellow', actions: [] };
  if (status === 'verifying') return { label: 'Verifying', tone: 'yellow', actions: [] };
  if (status === 'retrying') return { label: 'Retrying', tone: 'yellow', actions: [] };
  if (['integration-queued', 'integrating'].includes(status)) return { label: 'Integrating', tone: 'yellow', actions: [] };
  if (status === 'integration-conflict') return { label: 'Integration repair', tone: 'yellow', actions: [] };
  if (status === 'integration-review') return { label: 'Ready to integrate', tone: 'yellow', actions: ['integrate'] };
  if (status === 'verification-failed') return { label: 'Verification failed', tone: 'red', actions: ['remedy', 'feedback', 'override'] };
  if (status === 'failed') return { label: 'Failed', tone: 'red', actions: ['feedback'] };
  if (status === 'running') return { label: 'Revising', tone: 'yellow', actions: [] };
  return { label: status, tone: 'gray', actions: [] };
}

function feedbackRows(history, columns) {
  if (!history?.length) return [];
  return history.flatMap((entry) => {
    const rows = ['', `${COLORS.yellow}Feedback${entry.at ? ` · ${entry.at}` : ''}${COLORS.reset}`, ...wrapLine(entry.message || '', columns)];
    for (const selection of entry.selections || []) {
      rows.push(`${COLORS.cyan}${selection.file || '(unknown file)'} · ${selection.hunk || '(unknown hunk)'} · lines ${selection.startLine}-${selection.endLine}${COLORS.reset}`);
      rows.push(...`${selection.text || ''}`.split('\n').flatMap((line) => wrapLine(line, columns)));
    }
    return rows;
  });
}

class ReviewView {
  constructor({ columns = 80, viewportHeight = 12 } = {}) {
    this.columns = Math.max(8, columns);
    this.viewportHeight = Math.max(1, viewportHeight);
    this.item = null;
    this.states = new Map();
    this.drag = null;
    this.lastFrame = null;
  }

  state() {
    const key = itemKey(this.item);
    if (!this.states.has(key)) this.states.set(key, { scroll: 0, selections: [], confirmation: null });
    return this.states.get(key);
  }

  reconcile(item, resetDrag = false) {
    const changed = itemKey(item) !== itemKey(this.item);
    this.item = item || {};
    if (resetDrag || changed) this.drag = null;
    const state = this.state();
    if (state.confirmation && !stateDescriptor(this.item).actions.includes(state.confirmation)) state.confirmation = null;
    this.clampScroll();
    return this;
  }

  open(item) { return this.reconcile(item, true); }
  update(item) { return this.reconcile(item); }
  selections() { return this.state().selections.map((selection) => ({ ...selection })); }

  previewSelections() {
    if (!this.drag) return [];
    return this.rangesForVisualSpan(this.drag.anchor, this.drag.current);
  }

  patchRows() { return renderPatch(this.item?.diff || '', this.columns, this.state().selections, this.previewSelections()); }

  bodyRows() {
    const summary = wrapLine(this.item?.summary || 'No summary supplied.', this.columns).map((text) => ({ text, styled: text }));
    const diff = this.patchRows().map((row) => ({ ...row, patch: true }));
    const checks = (this.item?.checkResults || this.item?.checks || []).flatMap((check) => [`${check.ok ? '✓' : '✗'} ${(check.command || []).join(' ')}`, ...`${check.output || ''}`.split('\n').filter(Boolean)]).flatMap((text) => wrapLine(text, this.columns)).map((text) => ({ text, styled: text }));
    const feedback = feedbackRows(this.item?.feedback, this.columns).map((text) => ({ text, styled: text }));
    return [...summary, { text: '', styled: '' }, ...diff, ...(checks.length ? [{ text: '', styled: '' }, ...checks] : []), ...feedback];
  }

  maximumScroll() { return Math.max(0, this.bodyRows().length - this.viewportHeight); }
  clampScroll() { const state = this.state(); state.scroll = Math.min(Math.max(0, Number.isFinite(state.scroll) ? Math.trunc(state.scroll) : 0), this.maximumScroll()); return state.scroll; }
  scroll(delta) { this.state().scroll += Number.isFinite(delta) ? Math.trunc(delta) : 0; return this.clampScroll(); }
  scrollTo(offset) { this.state().scroll = Number.isFinite(offset) ? Math.trunc(offset) : 0; return this.clampScroll(); }
  page(direction) { return this.scroll((direction < 0 ? -1 : 1) * this.viewportHeight); }
  resize(columns, viewportHeight = this.viewportHeight) { this.columns = Math.max(8, columns); this.viewportHeight = Math.max(1, viewportHeight); this.clampScroll(); return this; }

  render({ bodyTop = 1, bodyLeft = 1, bodyWidth = this.columns } = {}) {
    this.clampScroll();
    const body = this.bodyRows();
    const offset = this.state().scroll;
    const rows = body.slice(offset, offset + this.viewportHeight).map((row, index) => ({ ...row, screenRow: bodyTop + index, bodyIndex: offset + index }));
    const hits = rows.filter((row) => row.patch).map((row) => ({ row: row.screenRow, start: bodyLeft, end: bodyLeft + Math.max(0, bodyWidth - 1), visualLine: row.visualLine }));
    const frame = { lines: rows.map((row) => row.styled), rows, hits, offset, maxScroll: this.maximumScroll(), status: stateDescriptor(this.item), confirmation: this.state().confirmation };
    this.lastFrame = frame;
    return frame;
  }

  hit(row, column) { return this.lastFrame?.hits.find((hit) => hit.row === row && column >= hit.start && column <= hit.end) || null; }

  rangesForVisualSpan(first, last) {
    const rows = renderPatch(this.item?.diff || '', this.columns);
    const low = Math.max(0, Math.min(first, last));
    const high = Math.min(rows.length - 1, Math.max(first, last));
    const sources = [];
    const seen = new Set();
    for (const row of rows.slice(low, high + 1)) {
      const key = `${row.sourceLine}`;
      if (!seen.has(key)) { seen.add(key); sources.push(row); }
    }
    const ranges = [];
    for (const source of sources.filter((row) => row.file && row.hunk && row.sourceLine > 0 && row.sourceText.trim())) {
      const previous = ranges.at(-1);
      if (previous && previous.file === source.file && previous.hunk === source.hunk && previous.endLine + 1 === source.sourceLine) {
        previous.endLine = source.sourceLine;
        previous.text += `\n${source.sourceText}`;
      } else ranges.push({ file: source.file, hunk: source.hunk, startLine: source.sourceLine, endLine: source.sourceLine, text: source.sourceText });
    }
    return ranges;
  }

  beginSelection(visualLine) { if (!Number.isInteger(visualLine)) return false; this.drag = { anchor: visualLine, current: visualLine }; return true; }
  extendSelection(visualLine) { if (!this.drag || !Number.isInteger(visualLine)) return false; this.drag.current = visualLine; return true; }
  finishSelection(visualLine = this.drag?.current) {
    if (!this.drag) return [];
    if (Number.isInteger(visualLine)) this.drag.current = visualLine;
    const added = this.rangesForVisualSpan(this.drag.anchor, this.drag.current);
    this.state().selections.push(...added);
    this.drag = null;
    this.clampScroll();
    return added.map((selection) => ({ ...selection }));
  }

  handleMouse(mouse) {
    if (!mouse) return false;
    const hit = this.hit(mouse.row, mouse.column);
    if (mouse.final === 'M' && mouse.button === 0 && hit) return this.beginSelection(hit.visualLine);
    if (mouse.final === 'M' && (mouse.button & 32) !== 0 && this.drag) { if (hit) this.extendSelection(hit.visualLine); return true; }
    if (mouse.final === 'm' && this.drag) { this.finishSelection(hit?.visualLine); return true; }
    return false;
  }

  removeSelection(index) { if (index < 0 || index >= this.state().selections.length) return false; this.state().selections.splice(index, 1); this.clampScroll(); return true; }
  removeLastSelection() { return this.removeSelection(this.state().selections.length - 1); }
  clearSelections() { this.state().selections.length = 0; this.clampScroll(); }
  feedback(message) { return { message: `${message ?? ''}`, selections: this.selections() }; }

  requestAction(action) {
    const allowed = stateDescriptor(this.item).actions;
    if (!allowed.includes(action)) return { action: null };
    if (action === 'remedy' || action === 'retry' || action === 'override' || action === 'integrate') { this.state().confirmation = action; return { action: `confirm-${action}` }; }
    return { action };
  }

  cancelConfirmation() { this.state().confirmation = null; }
  confirmAction() { const action = this.state().confirmation; this.state().confirmation = null; return action ? { action } : { action: null }; }
}

module.exports = { COLORS, ReviewView, displayPath, itemKey, parsePatch, patchLineType, renderPatch, stateDescriptor, width, wrapLine };
