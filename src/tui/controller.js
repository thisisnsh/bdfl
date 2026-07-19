'use strict';

const { diffLines } = require('../core/plans');
const { bannerFrame, verbForState } = require('./banner');

const TABS = Object.freeze(['Runs', 'Plans', 'Tasks', 'Agents', 'Inbox', 'Models']);
const ACTIONS = Object.freeze({ x: 'stop', r: 'rewind', f: 'follow-up', a: 'approve', i: 'integrate', o: 'open', '?': 'help' });
const ANSI = Object.freeze({ yellow: '\u001b[38;5;220m', green: '\u001b[32m', red: '\u001b[31m', white: '\u001b[37m', dim: '\u001b[2m', bold: '\u001b[1m', reset: '\u001b[0m' });

function colorize(enabled, color, text) { return enabled ? `${ANSI[color]}${text}${ANSI.reset}` : text; }

class TuiController {
  constructor(data = {}, { color = true, width = 80, height = 24, initialTab = 'Runs', focused = false } = {}) {
    this.data = Object.fromEntries(TABS.map((tab) => [tab, data[tab.toLowerCase()] || []]));
    this.color = color;
    this.width = width;
    this.height = height;
    this.tab = Math.max(0, TABS.indexOf(initialTab));
    this.focused = focused;
    this.row = 0;
    this.detail = false;
    this.planVersion = 0;
    this.planDisplay = 'diff';
    this.help = false;
  }

  rows() { return this.data[TABS[this.tab]]; }

  resize(width, height) { this.width = Math.max(20, width); this.height = Math.max(8, height); }

  key(input) {
    const key = ({ '\u001b[D': 'left', '\u001b[C': 'right', '\u001b[A': 'up', '\u001b[B': 'down', '\r': 'enter', '\n': 'enter', '\u001b': 'escape' })[input] || input;
    if (key === 'escape') {
      if (!this.detail && !this.help) return { action: 'quit' };
      this.detail = false; this.help = false; return { action: 'back' };
    }
    if (key === 'q' && !this.detail) return { action: 'quit' };
    if (key === '?') { this.help = !this.help; return { action: 'help' }; }
    if (this.detail && TABS[this.tab] === 'Plans') {
      const versions = this.rows()[this.row]?.versions || [];
      if (key === 'up') this.planVersion = Math.max(0, this.planVersion - 1);
      if (key === 'down') this.planVersion = Math.min(Math.max(0, versions.length - 1), this.planVersion + 1);
      if (key === 'left') this.planDisplay = 'diff';
      if (key === 'right') this.planDisplay = 'full';
    } else if (!this.detail) {
      if (key === 'left' && !this.focused) { this.tab = (this.tab + TABS.length - 1) % TABS.length; this.row = 0; }
      if (key === 'right' && !this.focused) { this.tab = (this.tab + 1) % TABS.length; this.row = 0; }
      if (key === 'up') this.row = Math.max(0, this.row - 1);
      if (key === 'down') this.row = Math.min(Math.max(0, this.rows().length - 1), this.row + 1);
      if (key === 'enter' && this.rows()[this.row]) {
        if (TABS[this.tab] === 'Models') return { action: 'select', item: this.rows()[this.row] };
        this.detail = true; this.planVersion = 0;
      }
    }
    if (key === 'a' && TABS[this.tab] === 'Models') return { action: 'select', item: this.rows()[this.row] };
    if (ACTIONS[key]) return { action: ACTIONS[key], item: this.rows()[this.row], version: this.planVersion + 1 };
    return { action: 'navigate' };
  }

  renderPlan(plan) {
    const versions = plan.versions || [];
    const selected = versions[this.planVersion];
    if (!selected) return ['No plan versions.'];
    const heading = `Plan ${plan.id || ''} · v${selected.number} · ${this.planDisplay}`;
    if (this.planDisplay === 'full') return [heading, ...selected.content.split('\n').map((line) => colorize(this.color, 'white', line))];
    const previous = versions[this.planVersion - 1]?.content || '';
    return [heading, ...diffLines(previous, selected.content).map((line) => {
      if (line.type === 'addition') return colorize(this.color, 'green', `+ ${line.text}`);
      if (line.type === 'removal') return colorize(this.color, 'red', `- ${line.text}`);
      return `  ${line.text}`;
    })];
  }

  render(frame = 0) {
    const state = Object.fromEntries(TABS.map((tab) => [tab.toLowerCase(), this.data[tab]]));
    const tabs = TABS.map((tab, index) => index === this.tab
      ? colorize(this.color, 'bold', `[${tab}]`)
      : colorize(this.color, 'dim', tab)).join('  ');
    const lines = this.focused
      ? [colorize(this.color, 'yellow', `BDFL · ${TABS[this.tab].toLowerCase()}`), '']
      : [bannerFrame(frame, this.color, verbForState(state)), tabs, ''];
    if (this.help) lines.push('←/→ tabs  ↑/↓ row  Enter details  Esc back  x stop  r rewind  f follow-up  a approve  i integrate  o open  ? help');
    else if (this.detail && TABS[this.tab] === 'Plans') lines.push(...this.renderPlan(this.rows()[this.row]));
    else if (this.detail) lines.push(JSON.stringify(this.rows()[this.row], null, 2));
    else if (TABS[this.tab] === 'Models') lines.push(...(this.rows().length ? this.rows().map((row, index) => {
      const cursor = index === this.row ? colorize(this.color, 'yellow', '›') : ' ';
      const active = row.selected ? colorize(this.color, 'green', '●') : ' ';
      return `${cursor} ${active} ${row.title || row.name || row.id || '(unnamed)'}`;
    }) : ['  No models configured']));
    else lines.push(...(this.rows().length ? this.rows().map((row, index) => `${index === this.row ? '›' : ' '} ${row.title || row.name || row.id || '(unnamed)'}`) : ['  No items']));
    const bottom = TABS[this.tab] === 'Models'
      ? '↑↓ move · Enter select · Esc/q close'
      : TABS[this.tab] === 'Plans'
        ? '↑/↓ version · ←/→ diff/full · a approve · o open · ? help · Esc back'
        : TABS[this.tab] === 'Agents'
          ? 'x stop · r rewind · f follow-up · o open · ? help · Esc back'
          : '←/→ tabs · ↑/↓ row · Enter details · ? help · Esc back';
    const available = Math.max(1, this.height - 1);
    const clipped = lines.slice(0, available).map((line) => line.length > this.width ? `${line.slice(0, this.width - 1)}…` : line);
    clipped.push(colorize(this.color, 'dim', bottom.slice(0, this.width)));
    return clipped.join('\n');
  }
}

module.exports = { TABS, ACTIONS, ANSI, TuiController };
