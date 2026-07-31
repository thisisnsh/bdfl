'use strict';

const { request } = require('../daemon/protocol');
const { WorkstreamWizard } = require('./wizard');

const ANSI = {
  clear: '\u001b[2J\u001b[H',
  white: '\u001b[38;5;255m',
  gray: '\u001b[38;5;245m',
  cyan: '\u001b[38;5;81m',
  yellow: '\u001b[38;5;220m',
  red: '\u001b[38;5;203m',
  reset: '\u001b[0m'
};
const STATUS = { Working: ANSI.yellow, Idle: ANSI.gray, Paused: ANSI.cyan, Waiting: ANSI.gray, Exited: ANSI.red };

function entityRow(item, selected = false) {
  return `${selected ? `${ANSI.cyan}› ` : '  '}${ANSI.white}${item.name}${ANSI.reset} ${ANSI.gray}${item.agent || ''}${ANSI.reset} ${STATUS[item.status] || ANSI.gray}${item.status}${ANSI.reset}`;
}

function popupLines(page, items, selection = 0, confirmation = null) {
  const action = page === 'Sessions' ? 'open agent' : page === 'Reviews' ? 'open review' : 'select';
  const lines = [
    '',
    `${ANSI.gray}  ${page} · ↑/↓ or j/k to select · Enter to ${action} · Esc/q to close${['Sessions', 'Plans'].includes(page) ? ' · d/D to delete' : ''}${ANSI.reset}`,
    ''
  ];
  if (!items.length) lines.push(`${ANSI.gray}  No ${page.toLowerCase()} available.${ANSI.reset}`);
  else lines.push(...items.map((item, index) => entityRow(item, index === selection)));
  if (confirmation) lines.push('', `${ANSI.red}${confirmation} Press Enter to confirm; Esc cancels.${ANSI.reset}`);
  return lines;
}

class PopupClient {
  constructor(socket, page, { input = process.stdin, output = process.stdout } = {}) {
    this.socket = socket;
    this.page = page;
    this.input = input;
    this.output = output;
    this.items = [];
    this.selection = 0;
    this.confirmation = null;
    this.wizard = null;
    this.detail = null;
    this.detailIndex = 0;
    this.rangeStart = null;
  }
  async load() {
    if (this.page === 'New') {
      const state = await request(this.socket, 'new-context');
      this.wizard = new WorkstreamWizard(state);
    } else this.items = await request(this.socket, 'rows', { page: this.page });
  }
  draw() {
    let value;
    if (this.wizard) value = ['', ...this.wizard.render().split('\n')];
    else if (this.detail) {
      const start = this.rangeStart === null ? null : Math.min(this.rangeStart, this.detailIndex);
      const end = this.rangeStart === null ? null : Math.max(this.rangeStart, this.detailIndex);
      value = [
        '',
        ...this.detail.lines.map((line, index) => {
          const marker = index === this.detailIndex ? '›' : ' ';
          const selected = start !== null && index >= start && index <= end;
          return `${selected ? ANSI.cyan : ''}${marker} ${line}${selected ? ANSI.reset : ''}`;
        })
      ];
    } else value = popupLines(this.page, this.items, this.selection, this.confirmation);
    this.output.write(`${ANSI.clear}${value.join('\n')}\n`);
  }
  async key(value) {
    if (value === '\u001b') return this.stop();
    if (this.wizard) {
      const config = this.wizard.handle(value);
      if (config) {
        await request(this.socket, 'create', { config });
        return this.stop();
      }
      this.draw();
      return;
    }
    if (value === 'q') return this.stop();
    if (this.detail) {
      if (value === '\u001b[A' || value === 'k') this.detailIndex = Math.max(0, this.detailIndex - 1);
      else if (value === '\u001b[B' || value === 'j')
        this.detailIndex = Math.min(this.detail.lines.length - 1, this.detailIndex + 1);
      else if (value === 'v') this.rangeStart = this.detailIndex;
      else if (value === '\r' && this.rangeStart !== null) {
        const start = Math.min(this.rangeStart, this.detailIndex);
        const end = Math.max(this.rangeStart, this.detailIndex);
        await request(this.socket, 'review-excerpt', {
          id: this.detail.id,
          start,
          end,
          lines: this.detail.lines.slice(start, end + 1)
        });
        this.rangeStart = null;
      }
      this.draw();
      return;
    }
    if (value === '\u001b[A' || value === 'k') this.selection = Math.max(0, this.selection - 1);
    else if (value === '\u001b[B' || value === 'j') this.selection = Math.min(this.items.length - 1, this.selection + 1);
    else if (value === 'd' || value === 'D') {
      const item = this.items[this.selection];
      if (item && ['Sessions', 'Plans'].includes(this.page)) this.confirmation = { item, cascade: value === 'D' };
    } else if (value === '\r' && this.confirmation) {
      const { item, cascade } = this.confirmation;
      await request(this.socket, this.page === 'Sessions' ? 'delete-session' : 'delete-plan', {
        id: item.id,
        ...(this.page === 'Sessions' ? { cascade } : { sessionPlans: cascade })
      });
      this.confirmation = null;
      this.items = await request(this.socket, 'rows', { page: this.page });
      this.selection = Math.min(this.selection, Math.max(0, this.items.length - 1));
    } else if (value === '\r') {
      const item = this.items[this.selection];
      if (item && this.page === 'Sessions') {
        await request(this.socket, 'open', { sessionId: item.id });
        // Keep compatibility with supervisors started by older releases where
        // opening an existing session did not also focus its pane.
        await request(this.socket, 'focus', { sessionId: item.id });
        return this.stop();
      } else if (item && this.page === 'Reviews') {
        this.detail = await request(this.socket, 'review-detail', { id: item.id });
        this.detailIndex = 0;
      }
    }
    this.draw();
  }
  async start() {
    await this.load();
    this.input.setRawMode?.(true);
    this.input.resume?.();
    this.input.setEncoding?.('utf8');
    this.input.on('data', (value) => void this.key(value).catch((error) => this.showError(error)));
    this.draw();
  }
  showError(error) {
    this.confirmation = `${error.message}`;
    this.draw();
  }
  stop() {
    this.input.setRawMode?.(false);
    this.input.pause?.();
    process.exitCode = 0;
  }
}

module.exports = { ANSI, entityRow, popupLines, PopupClient };
