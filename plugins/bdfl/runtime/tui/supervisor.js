'use strict';

const fs = require('node:fs'); const path = require('node:path');
const { WorkspaceStore } = require('../state/workspace'); const { SessionManager } = require('../sessions/manager');
const { WorkstreamWizard, display } = require('./wizard');

const ESC = '\u001b['; const COLORS = { yellow: `${ESC}38;5;220m`, cyan: `${ESC}38;5;81m`, green: `${ESC}38;5;114m`, red: `${ESC}38;5;203m`, white: `${ESC}38;5;255m`, black: `${ESC}38;5;16m`, bgYellow: `${ESC}48;5;220m`, bgCyan: `${ESC}48;5;81m`, bgGray: `${ESC}48;5;245m`, gray: `${ESC}38;5;245m`, reset: `${ESC}0m`, bold: `${ESC}1m`, underline: `${ESC}4m`, inverse: `${ESC}7m`, dim: `${ESC}2m` };
const ACTIONS = ['New', 'Plans', 'Sessions', 'Review', 'Close', 'Quit'];
function availableActions(workspace) { const sessions = workspace.sessions || []; const active = workspace.workstreams?.some((stream) => stream.status !== 'closed'); return ACTIONS.filter((action) => action === 'New' || action === 'Quit' || action === 'Sessions' && workspace.workstreams?.length || action === 'Close' && active || action === 'Plans' && (workspace.planCount > 0 || sessions.some((session) => session.role === 'plan' && !session.explicitlyClosed)) || action === 'Review' && (workspace.reviewCount > 0 || sessions.some((session) => session.role === 'review' && !session.explicitlyClosed))); }
function width(value) { return [...`${value}`.replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, '').replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '')].reduce((sum, character) => sum + (/\p{Extended_Pictographic}|\p{Script=Han}/u.test(character) ? 2 : 1), 0); }
function fit(value, columns) { const result = []; let used = 0; const tokens = `${value}`.match(/\u001b\[[0-9;?]*[A-Za-z]|./gu) || []; for (const token of tokens) { if (token.startsWith('\u001b[')) { result.push(token); continue; } const size = /\p{Extended_Pictographic}|\p{Script=Han}/u.test(token) ? 2 : 1; if (used + size > columns) break; result.push(token); used += size; } return result.join('') + ' '.repeat(Math.max(0, columns - used)); }
const TOGGLE_KEYS = new Set(['\u001d', '\u001b[93;5u', '\u001b[29;5u']);
function isToggleKey(value) { return TOGGLE_KEYS.has(value); }
function inputTokens(value) { return `${value}`.match(/\u001b\[<[0-9]+;[0-9]+;[0-9]+[Mm]|\u001b\[[0-9]+(?:;[0-9]+)*u|\u001b\[[A-D]|./gsu) || []; }
function mouseEvent(value) { const match = /^\u001b\[<([0-9]+);([0-9]+);([0-9]+)([Mm])$/.exec(value); if (!match) return null; return { button: Number(match[1]), column: Number(match[2]), row: Number(match[3]), final: match[4] }; }
function isVerticalWheel(mouse) { return mouse?.final === 'M' && (mouse.button & 64) !== 0 && (mouse.button & 3) < 2; }
function sanitizeTerminalTitle(value) { return `${value}`.replace(/[\u0000-\u001f\u007f-\u009f]/g, ''); }
function hasOpenAttention(workspace) { const open = new Set((workspace.workstreams || []).filter((stream) => stream.status !== 'closed').map((stream) => stream.id)); return (workspace.sessions || []).some((session) => session.attention && !session.explicitlyClosed && open.has(session.workstreamId)); }
function terminalTitle(workspace, attention = false) { const name = sanitizeTerminalTitle(workspace) || 'workspace'; return `\u001b]2;${attention ? '* ' : ''}bdfl · ${name}\u0007`; }

class Navigation {
  constructor(workspace) { this.workspace = workspace; this.rail = 'workstreams'; this.workstream = 0; this.workstreamId = workspace.activeWorkstreamId || workspace.workstreams.find((stream) => stream.status !== 'closed')?.id || null; this.pane = 0; this.action = 0; this.sync(workspace); }
  streams() { return this.workspace.workstreams.filter((stream) => stream.status !== 'closed'); }
  sync(workspace) { this.workspace = workspace; const streams = this.streams(); let index = streams.findIndex((stream) => stream.id === this.workstreamId); if (index < 0) { const active = streams.findIndex((stream) => stream.id === workspace.activeWorkstreamId); index = active >= 0 ? active : Math.min(this.workstream, Math.max(0, streams.length - 1)); this.workstreamId = streams[index]?.id || null; } this.workstream = Math.max(0, index); this.pane = Math.min(this.pane, Math.max(0, this.panes().length - 1)); this.action = Math.min(this.action, Math.max(0, this.actions().length - 1)); return this; }
  currentStream() { return this.streams().find((stream) => stream.id === this.workstreamId); }
  panes() { return this.workspace.sessions.filter((session) => session.workstreamId === this.currentStream()?.id && !session.explicitlyClosed).sort((a, b) => a.paneNumber - b.paneNumber); }
  actions() { return availableActions(this.workspace); }
  selectedAction() { return this.actions()[this.action]; }
  key(name) {
    if (this.rail === 'workstreams') {
      if (name === 'right' && this.streams().length) { this.workstream = (this.workstream + 1) % this.streams().length; this.workstreamId = this.streams()[this.workstream].id; this.pane = 0; }
      else if (name === 'left' && this.streams().length) { this.workstream = (this.workstream + this.streams().length - 1) % this.streams().length; this.workstreamId = this.streams()[this.workstream].id; this.pane = 0; }
      else if (name === 'up') this.rail = 'actions';
    } else if (this.rail === 'actions') {
      if (name === 'left') this.action = (this.action + this.actions().length - 1) % this.actions().length;
      else if (name === 'right') this.action = (this.action + 1) % this.actions().length;
      else if (name === 'down') this.rail = 'workstreams';
    }
    return { rail: this.rail, action: this.selectedAction(), workstream: this.currentStream(), pane: this.panes()[this.pane] };
  }
}

class TerminalRenderer {
  constructor({ version = '0.1.0', reducedMotion = false } = {}) { this.version = version; this.reducedMotion = reducedMotion; }
  render(workspace, navigation, { columns = 100, rows = 28, frame = 0, content = [] } = {}) {
    const focused = navigation.rail !== 'content'; const color = focused ? COLORS.yellow : COLORS.gray; const inner = Math.max(20, columns - 2); const topLabel = ` bdfl ${this.version} `; const visibleActions = navigation.actions(); const plainActions = visibleActions.map((action) => `[${action}]`).join(' '); const topFill = inner - width(topLabel) - width(plainActions) - 2;
    let headerBody;
    if (topFill < 0) headerBody = `${fit(`─${topLabel}`, inner - 1)}─`;
    else { const actions = visibleActions.map((action, index) => { const active = navigation.activeAction === action; const hovered = navigation.rail === 'actions' && navigation.action === index; if (active || hovered) return `${COLORS.bgYellow}${COLORS.black}${COLORS.bold}[${action}]${COLORS.reset}${color}`; return `[${action}]`; }).join(' '); headerBody = `─${topLabel}${'─'.repeat(topFill)}${actions}─`; }
    const lines = [`${color}┌${headerBody}┐${COLORS.reset}`];
    const panes = navigation.panes(); const contentRows = Math.max(1, rows - 3);
    for (let row = 0; row < contentRows; row += 1) {
      const contentLine = row === 0 ? '' : content[row - 1] || '';
      lines.push(`${color}│${COLORS.reset}${fit(`  ${contentLine}`, inner)}${color}│${COLORS.reset}`);
    }
    const activeStreamId = workspace.activeWorkstreamId || navigation.streams()[0]?.id; const agentFocused = navigation.rail === 'content' && !navigation.activeAction; const labels = navigation.streams().map((stream, index) => { const provider = stream.delegatorProfile?.provider || 'bdfl'; const providerSequence = stream.providerSequence || workspace.workstreams.slice(0, workspace.workstreams.findIndex((item) => item.id === stream.id) + 1).filter((item) => (item.delegatorProfile?.provider || 'bdfl') === provider).length; const label = `[${display(provider)} ${providerSequence}${workspace.sessions.some((session) => session.workstreamId === stream.id && session.attention) ? '*' : ''}]`; const active = stream.id === activeStreamId; const hovered = navigation.rail === 'workstreams' && navigation.workstream === index; if (navigation.activeAction) return `${COLORS.gray}${label}${COLORS.reset}${color}`; if (agentFocused) return active ? `${COLORS.bgGray}${COLORS.black}${COLORS.bold}${label}${COLORS.reset}${color}` : `${COLORS.gray}${label}${COLORS.reset}${color}`; if (hovered) return `${COLORS.bgYellow}${COLORS.black}${COLORS.bold}${label}${COLORS.reset}${color}`; return `${COLORS.yellow}${label}${COLORS.reset}${color}`; }); const rail = `─${labels.join(' ')}`; const bottomBody = width(rail) < inner ? `${rail}${'─'.repeat(inner - width(rail))}` : `${fit(rail, inner - 1)}─`; const agentKeys = !agentFocused && !navigation.activeAction && panes.length > 1 ? `Press ${panes.map((pane) => `[${pane.paneNumber}${pane.attention ? '*' : ''}]`).join(' ')} to change agents · ` : ''; const status = `${agentKeys}Toggle Focus: Ctrl+]`; const githubText = 'Star on GitHub thisisnsh/bdfl'; const statusPadding = 2; const statusWidth = Math.max(1, columns - statusPadding * 2); const showGithub = width(status) + width(githubText) + 1 <= statusWidth; const github = showGithub ? `\u001b]8;;https://github.com/thisisnsh/bdfl\u0007${githubText}\u001b]8;;\u0007` : ''; const visibleStatus = fit(status, Math.min(statusWidth, width(status))); const gap = ' '.repeat(Math.max(0, statusWidth - width(visibleStatus) - (showGithub ? width(githubText) : 0))); lines.push(`${color}└${bottomBody}┘${COLORS.reset}`); lines.push(`${COLORS.dim}${' '.repeat(statusPadding)}${visibleStatus}${gap}${github}${' '.repeat(statusPadding)}${COLORS.reset}`); return lines.join('\n');
  }
}

class TerminalSupervisor {
  constructor(root, { input = process.stdin, output = process.stdout, store = new WorkspaceStore(root), sessions, version = '0.1.0' } = {}) { this.root = path.resolve(root); this.input = input; this.output = output; this.store = store; this.sessions = sessions || new SessionManager(root, store); this.sessions.onOutput = () => this.scheduleDraw(); this.sessions.onAttention = (sessionId) => this.raiseAttention(sessionId); this.renderer = new TerminalRenderer({ version, reducedMotion: process.env.NO_COLOR === '1' }); this.lockFile = path.join(root, '.bdfl', 'run', 'supervisor.lock'); this.frame = 0; }
  acquire() {
    fs.mkdirSync(path.dirname(this.lockFile), { recursive: true });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try { this.lock = fs.openSync(this.lockFile, 'wx', 0o600); fs.writeFileSync(this.lock, `${process.pid}\n`); return; }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        let owner; try { owner = Number.parseInt(fs.readFileSync(this.lockFile, 'utf8'), 10); } catch {}
        let alive = Number.isInteger(owner) && owner > 0;
        if (alive) { try { process.kill(owner, 0); } catch (probe) { if (probe.code === 'ESRCH') alive = false; } }
        if (alive || attempt) throw new Error('Another BDFL supervisor owns this workspace');
        try { fs.unlinkSync(this.lockFile); } catch (remove) { if (remove.code !== 'ENOENT') throw remove; }
      }
    }
  }
  release() { if (this.lock === undefined) return; fs.closeSync(this.lock); this.lock = undefined; try { fs.unlinkSync(this.lockFile); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
  dimensions() { return { columns: Math.max(20, (this.output.columns || 100) - 4), rows: Math.max(1, (this.output.rows || 28) - 4) }; }
  planItems() { const directory = path.join(this.root, '.bdfl', 'plans'); let entries; try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch { return []; } return entries.filter((entry) => entry.isDirectory()).flatMap((entry) => { try { return [JSON.parse(fs.readFileSync(path.join(directory, entry.name, 'lineage.json'), 'utf8'))]; } catch { return []; } }).sort((a, b) => `${b.updatedAt}`.localeCompare(`${a.updatedAt}`)); }
  reviewItems() { const directory = path.join(this.root, '.bdfl', 'executions'); let entries; try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch { return []; } return entries.filter((entry) => entry.isDirectory()).flatMap((entry) => { try { const execution = JSON.parse(fs.readFileSync(path.join(directory, entry.name, 'execution.json'), 'utf8')); return execution.chunks.filter((chunk) => chunk.status === 'review').map((chunk) => ({ ...chunk, executionId: execution.id, planId: execution.planId })); } catch { return []; } }); }
  decorateWorkspace(workspace) { return { ...workspace, planCount: this.planItems().length, reviewCount: this.reviewItems().length }; }
  sessionPickerItems(workspace = this.workspace || this.store.load()) {
    return workspace.workstreams.map((stream, index) => {
      const agents = workspace.sessions.filter((session) => session.workstreamId === stream.id);
      const modifiedAt = [stream.updatedAt, stream.createdAt, ...agents.flatMap((session) => [session.updatedAt, session.createdAt])].filter(Boolean).sort().at(-1) || '';
      return { stream, index, modifiedAt };
    }).sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt) || a.index - b.index).map(({ stream }) => stream);
  }
  syncSessionPicker(items) { const selected = items.findIndex((stream) => stream.id === this.sessionPicker.workstreamId); if (selected >= 0) this.sessionPicker.index = selected; this.sessionPicker.index = Math.max(0, Math.min(this.sessionPicker.index || 0, Math.max(0, items.length - 1))); this.sessionPicker.workstreamId = items[this.sessionPicker.index]?.id || null; return this.sessionPicker.index; }
  actionPageLines() { if (!this.topPage) return null; const plans = this.topPage.action === 'Plans'; const items = plans ? this.planItems() : this.reviewItems(); const title = plans ? 'Plans' : 'Ready for review'; const description = plans ? 'Browse durable implementation plans created in this workspace.' : 'Worker results waiting for your review and acceptance.'; return [`${COLORS.bold}${plans ? COLORS.cyan : COLORS.yellow}${title}${COLORS.reset}`, `${COLORS.gray}${description}${COLORS.reset}`, '', ...items.flatMap((item, index) => { const selected = index === this.topPage.index; const name = plans ? item.title || item.planId : `${item.id} · ${item.planId}`; const status = plans ? `${COLORS.green}Version ${item.currentVersion}${COLORS.reset}` : `${COLORS.yellow}Needs review${COLORS.reset}`; const detail = plans ? `Updated ${item.updatedAt || item.createdAt || 'recently'}` : item.summary || `${item.changedPaths?.length || 0} changed paths`; return [`${selected ? `${COLORS.inverse}${COLORS.bold} › ${name} ${COLORS.reset}` : `   ${COLORS.bold}${COLORS.white}${name}${COLORS.reset}`}  ${status}`, `${COLORS.gray}   ${detail}${COLORS.reset}`, '']; }), `${COLORS.cyan}↑/↓ choose${COLORS.reset}${COLORS.gray}  •  Ctrl+] back${COLORS.reset}`]; }
  sessionPickerLines() { const streams = this.sessionPickerItems(); this.syncSessionPicker(streams); return [`${COLORS.bold}${COLORS.yellow}Your sessions${COLORS.reset}`, `${COLORS.gray}Open a running session or resume one you closed earlier.${COLORS.reset}`, '', ...streams.flatMap((stream, index) => { const provider = display(stream.delegatorProfile?.provider || 'bdfl'); const originalIndex = this.workspace.workstreams.findIndex((item) => item.id === stream.id); const sequence = stream.providerSequence || this.workspace.workstreams.slice(0, originalIndex + 1).filter((item) => item.delegatorProfile?.provider === stream.delegatorProfile?.provider).length; const selected = index === this.sessionPicker.index; const deleting = this.sessionPicker.confirmDelete === stream.id; const title = `${provider} ${sequence}${this.workspace.sessions.some((session) => session.workstreamId === stream.id && session.attention) ? '*' : ''}`; const status = deleting ? `${COLORS.red}${COLORS.bold}Delete permanently?${COLORS.reset}` : stream.status === 'closed' ? `${COLORS.yellow}Ready to resume${COLORS.reset}` : `${COLORS.green}Running${COLORS.reset}`; const description = deleting ? `${COLORS.red}Press Enter to confirm · Esc to keep this session${COLORS.reset}` : `${COLORS.gray}${stream.title || path.basename(this.root)} · ${selected ? 'Enter open · d delete' : stream.status === 'closed' ? 'Saved provider session' : 'Session is available'}${COLORS.reset}`; const agents = this.workspace.sessions.filter((session) => session.workstreamId === stream.id).sort((a, b) => (a.paneNumber || 0) - (b.paneNumber || 0)); const children = agents.length ? agents.map((agent, agentIndex) => { const connector = agentIndex === agents.length - 1 ? '└─' : '├─'; const role = agent.role === 'delegator' ? 'Planning agent' : agent.role === 'worker' ? 'Worker agent' : `${display(agent.role)} agent`; const agentProvider = display(agent.profile?.provider || stream.delegatorProfile?.provider || 'agent'); const agentStatus = agent.status === 'running' ? `${COLORS.green}Running${COLORS.reset}` : agent.explicitlyClosed ? `${COLORS.gray}Closed${COLORS.reset}` : `${COLORS.yellow}Saved${COLORS.reset}`; const shortcut = agents.length > 1 ? `[${agent.paneNumber || agentIndex + 1}${agent.attention ? '*' : ''}] ` : ''; return `${COLORS.gray}   ${connector}${COLORS.reset} ${COLORS.bold}${COLORS.white}${shortcut}${role}${COLORS.reset} ${COLORS.gray}· ${agentProvider}${COLORS.reset}  ${agentStatus}`; }) : [`${COLORS.gray}   └─ No agents saved${COLORS.reset}`]; return [`${selected ? `${COLORS.inverse}${COLORS.bold} › ${title} ${COLORS.reset}` : `   ${COLORS.bold}${COLORS.white}${title}${COLORS.reset}`}  ${status}`, `   ${description}`, ...children, '']; }), `${COLORS.cyan}↑/↓ choose${COLORS.reset}${COLORS.gray}  •  Enter open  •  d delete  •  Esc/Ctrl+] back${COLORS.reset}`]; }
  focusedSessionId() { if (this.navigation?.rail !== 'content' || this.wizard || this.sessionPicker || this.topPage) return null; return this.navigation.panes()[this.navigation.pane]?.id || null; }
  visibleSessionId() { if (!this.navigation || this.error || this.wizard || this.sessionPicker || this.topPage) return null; return this.navigation.panes()[this.navigation.pane]?.id || null; }
  raiseAttention(sessionId) { if (this.focusedSessionId() === sessionId) return false; this.store.setSessionAttention?.(sessionId, true); this.scheduleDraw(); return true; }
  clearFocusedAttention() { const sessionId = this.focusedSessionId(); if (sessionId) this.store.setSessionAttention?.(sessionId, false); return sessionId; }
  scheduleDraw() { if (!this.running || this.redrawScheduled) return; this.redrawScheduled = true; setImmediate(() => { this.redrawScheduled = false; if (this.running) this.draw(); }); }
  draw() { this.workspace = this.decorateWorkspace(this.store.load()); this.navigation ||= new Navigation(this.workspace); this.navigation.sync(this.workspace); const pane = this.navigation.panes()[this.navigation.pane]; const picker = this.sessionPicker ? this.sessionPickerLines() : null; const content = this.error ? [`${COLORS.bold}${COLORS.red}Something went wrong${COLORS.reset}`, `${COLORS.gray}${this.error}${COLORS.reset}`] : this.wizard ? this.wizard.render().split('\n') : picker || this.actionPageLines() || (pane && this.sessions.screen ? this.sessions.screen(pane.id, this.dimensions().rows, { cursor: this.navigation.rail === 'content' }) : []); this.output.write(`${terminalTitle(path.basename(this.root), hasOpenAttention(this.workspace))}${ESC}H${this.renderer.render(this.workspace, this.navigation, { columns: this.output.columns || 100, rows: this.output.rows || 28, frame: this.frame++, content })}`); }
  start() {
    this.acquire(); this.running = true; this.workspace = this.decorateWorkspace(this.store.load());
    const openWorkstreams = new Set(this.workspace.workstreams.filter((stream) => stream.status !== 'closed').map((stream) => stream.id)); const hasOpenSession = this.workspace.sessions.some((session) => !session.explicitlyClosed && openWorkstreams.has(session.workstreamId));
    if (!hasOpenSession) { this.navigation = new Navigation(this.workspace); this.navigation.rail = 'content'; if (this.workspace.sessions.length) { const items = this.sessionPickerItems(this.workspace); const index = Math.max(0, items.findIndex((stream) => stream.id === this.workspace.activeWorkstreamId)); this.sessionPicker = { index, workstreamId: items[index]?.id || null }; this.navigation.activeAction = 'Sessions'; } else { this.wizard = new WorkstreamWizard({ lastUsed: this.store.loadConfig?.() }); this.navigation.activeAction = 'New'; } }
    this.output.write(`${ESC}?1049h${ESC}?25l${ESC}?1000h${ESC}?1006h`); this.input.setRawMode?.(true); this.input.resume();
    if (!this.wizard && this.sessions.restore) { const restored = this.sessions.restore(this.dimensions()); if (restored?.errors?.length) this.error = restored.errors.map(({ sessionId, error }) => `${sessionId}: ${error.message}`).join(' · '); }
    const keys = { '\u001b[A': 'up', '\u001b[B': 'down', '\u001b[C': 'right', '\u001b[D': 'left' };
    const handle = (value) => {
      const mouse = mouseEvent(value);
      if (mouse) {
        const sessionId = this.visibleSessionId(); const columns = this.output.columns || 100; const rows = this.output.rows || 28;
        if (sessionId && isVerticalWheel(mouse) && mouse.column >= 4 && mouse.column <= columns - 1 && mouse.row >= 3 && mouse.row <= rows - 2) {
          const translated = { ...mouse, column: mouse.column - 3, row: mouse.row - 2 }; const lines = (mouse.button & 1) === 0 ? -3 : 3;
          this.sessions.scroll?.(sessionId, lines, translated);
        }
        return;
      }
      if (this.topPage) {
        const items = this.topPage.action === 'Plans' ? this.planItems() : this.reviewItems();
        if (isToggleKey(value) || value === 'q' || value === '\u001b') { this.topPage = null; this.navigation.activeAction = null; this.navigation.rail = 'workstreams'; return this.draw(); }
        if (value === '\u001b[A' && items.length) this.topPage.index = (this.topPage.index + items.length - 1) % items.length;
        else if (value === '\u001b[B' && items.length) this.topPage.index = (this.topPage.index + 1) % items.length;
        return this.draw();
      }
      if (this.sessionPicker) {
        const items = this.sessionPickerItems(this.store.load());
        this.syncSessionPicker(items);
        if (isToggleKey(value) || value === 'q') { this.sessionPicker = null; this.navigation.activeAction = null; this.navigation.rail = 'workstreams'; return this.draw(); }
        if (value === '\u001b') { if (this.sessionPicker.confirmDelete) this.sessionPicker.confirmDelete = null; else { this.sessionPicker = null; this.navigation.activeAction = null; this.navigation.rail = 'workstreams'; } return this.draw(); }
        if ((value === '\u001b[A' || value === '\u001b[B') && items.length) { const movement = value === '\u001b[A' ? -1 : 1; this.sessionPicker.index = (this.sessionPicker.index + items.length + movement) % items.length; this.sessionPicker.workstreamId = items[this.sessionPicker.index].id; this.sessionPicker.confirmDelete = null; }
        else if (value === 'd' && items[this.sessionPicker.index]) this.sessionPicker.confirmDelete = items[this.sessionPicker.index].id;
        else if (value === '\r' && items[this.sessionPicker.index]) { const selected = items[this.sessionPicker.index]; if (this.sessionPicker.confirmDelete === selected.id) { const sessionIds = this.store.load().sessions.filter((item) => item.workstreamId === selected.id).map((item) => item.id); for (const sessionId of sessionIds) this.sessions.delete?.(sessionId); this.store.deleteWorkstream(selected.id); const remaining = this.sessionPickerItems(this.store.load()); if (!remaining.length) { this.sessionPicker = null; this.wizard = new WorkstreamWizard({ lastUsed: this.store.loadConfig?.() }); this.navigation = new Navigation(this.store.load()); this.navigation.rail = 'content'; this.navigation.activeAction = 'New'; } else { this.sessionPicker.index = Math.min(this.sessionPicker.index, remaining.length - 1); this.sessionPicker.workstreamId = remaining[this.sessionPicker.index].id; this.sessionPicker.confirmDelete = null; } } else { if (selected.status === 'closed') this.store.reopenWorkstream(selected.id); else this.store.activateWorkstream(selected.id); const state = this.store.load(); const errors = []; for (const session of state.sessions.filter((item) => item.workstreamId === selected.id && !item.explicitlyClosed)) { try { this.sessions.open(session.id, this.dimensions()); } catch (error) { errors.push(error.message); } } this.error = errors.length ? errors.join(' · ') : null; this.sessionPicker = null; this.navigation = new Navigation(this.store.load()); this.navigation.workstreamId = selected.id; this.navigation.sync(this.store.load()); this.navigation.rail = 'workstreams'; this.navigation.activeAction = null; } }
        return this.draw();
      }
      if (value === '\u0003' || (value === 'q' && this.navigation.rail !== 'content')) { this.stop(); return false; }
      if (isToggleKey(value)) {
        if (this.wizard && this.navigation.panes().length) { this.wizard = null; this.navigation.activeAction = null; this.navigation.rail = 'workstreams'; }
        else if (this.wizard) this.navigation.rail = this.navigation.rail === 'content' ? 'actions' : 'content';
        else if (this.navigation.rail === 'content') this.navigation.rail = 'workstreams';
        else { const selected = this.navigation.panes()[this.navigation.pane]; if (selected) { try { this.sessions.open(selected.id, this.dimensions()); this.error = null; this.navigation.rail = 'content'; this.clearFocusedAttention(); } catch (error) { this.error = error.message; } } }
        return this.draw();
      }
      if (this.wizard && value === '\u001b') { this.wizard = null; this.navigation.activeAction = null; this.navigation.rail = 'workstreams'; return this.draw(); }
      if (this.wizard && this.navigation.rail === 'content') {
        const config = this.wizard.handle(value); if (config) { const stream = this.store.createWorkstream(config); const session = this.store.createSession(stream.id, 'delegator', config.delegatorProfile); this.wizard = null; this.navigation = null; try { this.sessions.open(session.id, this.dimensions()); } catch (error) { this.error = error.message; } }
        return this.draw();
      }
      if (value === '\r' && this.navigation.rail === 'actions') return this.activate(this.navigation.selectedAction());
      if (value === '\r' && this.navigation.rail === 'workstreams') { const selected = this.navigation.panes()[0]; if (selected) { this.navigation.pane = 0; try { this.store.activateWorkstream?.(this.navigation.workstreamId); this.sessions.open(selected.id, this.dimensions()); this.error = null; this.navigation.activeAction = null; this.navigation.rail = 'content'; this.clearFocusedAttention(); } catch (error) { this.error = error.message; } } return this.draw(); }
      if (/^[1-9]$/.test(value) && this.navigation.rail !== 'content') { const panes = this.navigation.panes(); if (panes.length > 1) { const index = panes.findIndex((pane, paneIndex) => (pane.paneNumber || paneIndex + 1) === Number(value)); if (index >= 0) this.navigation.pane = index; } return this.draw(); }
      if (keys[value] && this.navigation.rail !== 'content') { this.navigation.key(keys[value]); return this.draw(); }
      const pane = this.navigation.panes()[this.navigation.pane]; if (this.navigation.rail === 'content' && pane) this.sessions.write(pane.id, value);
    };
    this.onData = (data) => { for (const value of inputTokens(data)) if (handle(value) === false) break; };
    this.input.on('data', this.onData); this.draw(); return this;
  }
  activate(action) {
    if (action === 'Quit') return this.stop();
    if (action === 'New') { this.sessionPicker = null; this.topPage = null; this.wizard = new WorkstreamWizard({ lastUsed: this.store.loadConfig?.() }); this.navigation.activeAction = 'New'; this.navigation.rail = 'content'; return this.draw(); }
    if (action === 'Sessions') { this.wizard = null; this.topPage = null; const items = this.sessionPickerItems(this.store.load()); const index = Math.max(0, items.findIndex((stream) => stream.id === this.navigation.workstreamId)); this.sessionPicker = { index, workstreamId: items[index]?.id || null }; this.navigation.activeAction = 'Sessions'; this.navigation.rail = 'content'; return this.draw(); }
    if (action === 'Close') { const streamId = this.navigation.workstreamId; const workspace = this.workspace || this.store.load(); if (streamId) { const sessionIds = workspace.sessions.filter((session) => session.workstreamId === streamId && !session.explicitlyClosed).map((session) => session.id); for (const sessionId of sessionIds) this.sessions.close(sessionId); if (this.store.closeWorkstream) this.store.closeWorkstream(streamId); else { const stream = workspace.workstreams.find((item) => item.id === streamId); if (stream) stream.status = 'closed'; } } this.navigation.activeAction = null; this.navigation.workstreamId = null; this.navigation.pane = 0; this.navigation.rail = 'workstreams'; return this.draw(); }
    if (action === 'Plans' || action === 'Review') { const items = action === 'Plans' ? this.planItems() : this.reviewItems(); if (items.length) { this.wizard = null; this.sessionPicker = null; this.topPage = { action, index: 0 }; this.navigation.activeAction = action; this.navigation.rail = 'content'; return this.draw(); } const role = action === 'Plans' ? 'plan' : 'review'; const panes = this.navigation.panes(); const index = panes.findLastIndex((pane) => pane.role === role); if (index >= 0) { this.navigation.pane = index; this.sessions.open(panes[index].id, this.dimensions()); this.navigation.activeAction = action; this.navigation.rail = 'content'; this.clearFocusedAttention(); } return this.draw(); }
    return this.draw();
  }
  stop() { this.running = false; this.sessions.shutdown?.(); this.input.off('data', this.onData); this.input.setRawMode?.(false); this.input.pause(); this.output.write(`${terminalTitle(path.basename(this.root), false)}${ESC}?1006l${ESC}?1000l${ESC}?25h${ESC}?1049l`); this.release(); }
}

module.exports = { ACTIONS, availableActions, COLORS, width, fit, inputTokens, mouseEvent, isVerticalWheel, isToggleKey, sanitizeTerminalTitle, hasOpenAttention, terminalTitle, Navigation, TerminalRenderer, TerminalSupervisor };
