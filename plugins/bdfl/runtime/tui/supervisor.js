'use strict';

const fs = require('node:fs'); const path = require('node:path');
const { WorkspaceStore } = require('../state/workspace'); const { SessionManager } = require('../sessions/manager');
const { WorkstreamWizard } = require('./wizard');

const ESC = '\u001b['; const COLORS = { yellow: `${ESC}38;5;220m`, gray: `${ESC}38;5;245m`, reset: `${ESC}0m`, inverse: `${ESC}7m`, dim: `${ESC}2m` };
function width(value) { return [...`${value}`.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '')].reduce((sum, character) => sum + (/\p{Extended_Pictographic}|\p{Script=Han}/u.test(character) ? 2 : 1), 0); }
function fit(value, columns) { const result = []; let used = 0; for (const character of `${value}`) { const size = /\p{Extended_Pictographic}|\p{Script=Han}/u.test(character) ? 2 : 1; if (used + size > columns) break; result.push(character); used += size; } return result.join('') + ' '.repeat(Math.max(0, columns - used)); }

class Navigation {
  constructor(workspace) { this.workspace = workspace; this.rail = 'workstreams'; this.workstream = 0; this.pane = 0; }
  currentStream() { return this.workspace.workstreams[this.workstream]; }
  panes() { return this.workspace.sessions.filter((session) => session.workstreamId === this.currentStream()?.id).sort((a, b) => a.paneNumber - b.paneNumber); }
  key(name) { if (this.rail === 'workstreams') { if (name === 'right' && this.workspace.workstreams.length) { const first = this.workspace.workstreams.shift(); this.workspace.workstreams.push(first); this.workstream = 0; } if (name === 'left') { this.rail = 'panes'; this.pane = 0; } if (name === 'up') this.rail = 'actions'; } else if (this.rail === 'panes') { const panes = this.panes(); if (name === 'up' && this.pane >= panes.length - 1) this.rail = 'actions'; else if (name === 'up') this.pane += 1; else if (name === 'down') this.pane = Math.max(0, this.pane - 1); else if (name === 'right') this.rail = 'workstreams'; } else if (this.rail === 'actions' && name === 'down') this.rail = 'panes'; return { rail: this.rail, workstream: this.currentStream(), pane: this.panes()[this.pane] }; }
}

class TerminalRenderer {
  constructor({ version = '0.1.0', reducedMotion = false } = {}) { this.version = version; this.reducedMotion = reducedMotion; }
  render(workspace, navigation, { columns = 100, rows = 28, frame = 0, content = [] } = {}) {
    const focused = navigation.rail !== 'content'; const color = focused ? COLORS.yellow : COLORS.gray; const inner = Math.max(20, columns - 2); const topLabel = ` bdfl ${this.version} `; const actions = '[New] [Plans] [Sessions] [Review] [Close] [Quit]'; const topFill = Math.max(0, inner - width(topLabel) - width(actions)); const lines = [`${color}┌─${topLabel}${'─'.repeat(topFill)}${actions}─┐${COLORS.reset}`];
    const panes = navigation.panes().slice().reverse(); const contentRows = Math.max(1, rows - 3);
    for (let row = 0; row < contentRows; row += 1) { let body = content[row] || ''; if (row < panes.length) { const pane = panes[row]; const suffix = pane.role === 'delegator' ? 'D' : pane.role === 'verifier' ? 'V' : pane.role === 'plan' ? 'P' : pane.role === 'review' ? 'R' : 'W'; const attention = pane.attention ? '!' : ''; const label = `[${pane.paneNumber}]${suffix}${attention}┃ `; const animated = pane.attention && !this.reducedMotion && frame % 2 ? `${COLORS.inverse}${COLORS.dim}${label}${COLORS.reset}` : label; body = `${animated}${body}`; } lines.push(`${color}│${COLORS.reset}${fit(` ${body}`, inner)}${color}│${COLORS.reset}`); }
    const rail = workspace.workstreams.map((stream, index) => `${index === 0 ? '' : '  '}${stream.delegatorProfile?.provider || 'bdfl'} ${index + 1}${workspace.sessions.some((session) => session.workstreamId === stream.id && session.attention) ? '!' : ''}`).join(''); lines.push(`${color}└─${fit(rail, inner - 2)}─┘${COLORS.reset}`); return lines.join('\n');
  }
}

class TerminalSupervisor {
  constructor(root, { input = process.stdin, output = process.stdout, store = new WorkspaceStore(root), sessions, version = '0.1.0' } = {}) { this.root = path.resolve(root); this.input = input; this.output = output; this.store = store; this.sessions = sessions || new SessionManager(root, store); this.renderer = new TerminalRenderer({ version, reducedMotion: process.env.NO_COLOR === '1' }); this.lockFile = path.join(root, '.bdfl', 'run', 'supervisor.lock'); this.frame = 0; }
  acquire() { fs.mkdirSync(path.dirname(this.lockFile), { recursive: true }); try { this.lock = fs.openSync(this.lockFile, 'wx', 0o600); fs.writeFileSync(this.lock, `${process.pid}\n`); } catch (error) { if (error.code === 'EEXIST') throw new Error('Another BDFL supervisor owns this workspace'); throw error; } }
  release() { if (this.lock !== undefined) fs.closeSync(this.lock); try { fs.unlinkSync(this.lockFile); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
  draw() { this.workspace = this.store.load(); this.navigation ||= new Navigation(this.workspace); this.navigation.workspace = this.workspace; const content = this.wizard ? this.wizard.render().split('\n') : []; this.output.write(`${ESC}H${this.renderer.render(this.workspace, this.navigation, { columns: this.output.columns || 100, rows: this.output.rows || 28, frame: this.frame++, content })}`); }
  start() {
    this.acquire(); this.workspace = this.store.load();
    if (!this.workspace.workstreams.length) this.wizard = new WorkstreamWizard();
    this.output.write(`${ESC}?1049h${ESC}?25l`); this.input.setRawMode?.(true); this.input.resume();
    const keys = { '\u001b[A': 'up', '\u001b[B': 'down', '\u001b[C': 'right', '\u001b[D': 'left' };
    this.onData = (data) => {
      const value = `${data}`; if (value === '\u0003' || value === 'q') return this.stop();
      if (this.wizard) {
        if (value === '\u001b[A') this.wizard.move(-1); else if (value === '\u001b[B') this.wizard.move(1);
        else if (value === '\r') { const config = this.wizard.choose(); if (config) { const stream = this.store.createWorkstream(config); const session = this.store.createSession(stream.id, 'delegator', config.delegatorProfile); this.wizard = null; this.navigation = null; this.sessions.open(session.id, { columns: this.output.columns || 100, rows: Math.max(8, (this.output.rows || 28) - 3) }); } }
        return this.draw();
      }
      if (value === '\u001d') { this.navigation.rail = this.navigation.rail === 'content' ? 'panes' : 'content'; return this.draw(); }
      if (value === '\r' && this.navigation.rail === 'panes') { const selected = this.navigation.panes()[this.navigation.pane]; if (selected) { this.sessions.open(selected.id); this.navigation.rail = 'content'; } return this.draw(); }
      if (keys[value] && this.navigation.rail !== 'content') { this.navigation.key(keys[value]); return this.draw(); }
      const pane = this.navigation.panes()[this.navigation.pane]; if (this.navigation.rail === 'content' && pane) this.sessions.write(pane.id, value);
    };
    this.input.on('data', this.onData); this.draw(); return this;
  }
  stop() { this.input.off('data', this.onData); this.input.setRawMode?.(false); this.input.pause(); this.output.write(`${ESC}?25h${ESC}?1049l`); this.release(); }
}

module.exports = { COLORS, width, fit, Navigation, TerminalRenderer, TerminalSupervisor };
