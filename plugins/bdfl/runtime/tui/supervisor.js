'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { SessionManager } = require('../sessions/manager');
const { WorkspaceCatalog, LineageCatalog } = require('../state/repositories');
const { LineageStore } = require('../plans/store');
const { WorkerScheduler } = require('../workers/scheduler');
const { IntegrationCoordinator } = require('../workers/integration');
const { ExecutionGit } = require('../worktrees/execution');
const { PlanService, WorkerService, ControlServer } = require('../mcp/bridge');
const { errorDetails, ISSUE_URL, openExternal } = require('../core/errors');
const { WorkstreamWizard, display } = require('./wizard');
const { ACTIONS, Chrome, createdOrder, childOrder, hitAt } = require('./chrome');
const { ReviewView, stateDescriptor } = require('./review-view');

const ESC = '\u001b[';
const COLORS = {
  yellow: `${ESC}38;5;220m`,
  cyan: `${ESC}38;5;81m`,
  green: `${ESC}38;5;114m`,
  red: `${ESC}38;5;203m`,
  white: `${ESC}38;5;255m`,
  black: `${ESC}38;5;16m`,
  bgYellow: `${ESC}48;5;220m`,
  bgCyan: `${ESC}48;5;81m`,
  bgGray: `${ESC}48;5;245m`,
  gray: `${ESC}38;5;245m`,
  reset: `${ESC}0m`,
  bold: `${ESC}1m`,
  underline: `${ESC}4m`,
  inverse: `${ESC}7m`,
  dim: `${ESC}2m`
};
const NATIVE_PAGES = new Set(['New', 'Plans', 'Sessions', 'Reviews']);
const VERIFIER_CONTINUATION =
  'The BDFL supervisor restarted while your execution-agent verification phase was incomplete. Retain this conversation context, re-read durable execution status and the existing verifier context, and finish one comprehensive review of the entire approved change. Do not edit during verification. If it fails, report every finding with evidence and a concrete remedy. Then call bdfl_workers complete with pass or fail.';
const INTEGRATION_CONTINUATION =
  'The BDFL supervisor restarted while your execution-agent repair or reconciliation phase was incomplete. Retain this conversation context, re-read durable execution status and the active worktree, preserve every approved intent, and finish the assigned repair plus comprehensive internal audit before reporting pass. Then call bdfl_workers complete with pass or fail.';
const QUIT_MESSAGE = 'Press Ctrl+C again to quit.';
const QUIT_CONFIRMATION_TIMEOUT = 5000;
const FOOTER_MESSAGES = [
  '↑↓ scroll • Click agents to switch • Shift-drag selects text • Ctrl+C twice quits',
  'Use arrows to choose a plan section • Shift-drag selects text',
  'Use arrows to choose a session • Shift-drag selects text',
  'Review with arrows or drag excerpts • Shift-drag selects terminal text',
  'Use arrows to choose each option • Shift-drag selects text'
];
function availableActions(workspace) {
  const active = workspace.sessions?.some((session) => !session.explicitlyClosed);
  return ACTIONS.filter((action) => action !== 'Close' || active);
}
function characterWidth(character) {
  if (/\p{Mark}/u.test(character)) return 0;
  return /\p{Extended_Pictographic}|\p{Script=Han}|\p{Script=Hangul}|\p{Script=Hiragana}|\p{Script=Katakana}|[\uFF01-\uFF60\uFFE0-\uFFE6]/u.test(
    character
  )
    ? 2
    : 1;
}
function width(value) {
  return [
    ...`${value}`.replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, '').replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '')
  ].reduce((sum, character) => sum + characterWidth(character), 0);
}
function crop(value, columns, ellipsis = false) {
  if (columns <= 0) return '';
  const result = [];
  let used = 0;
  const limit = ellipsis && width(value) > columns ? Math.max(0, columns - 1) : columns;
  for (const character of `${value}`) {
    const size = characterWidth(character);
    if (used + size > limit) break;
    result.push(character);
    used += size;
  }
  return `${result.join('')}${ellipsis && width(value) > columns && columns > 0 ? '…' : ''}`;
}
function fit(value, columns) {
  const result = [];
  let used = 0;
  const tokens = `${value}`.match(/\u001b\[[0-9;?]*[A-Za-z]|./gu) || [];
  for (const token of tokens) {
    if (token.startsWith('\u001b[')) {
      result.push(token);
      continue;
    }
    const size = characterWidth(token);
    if (used + size > columns) break;
    result.push(token);
    used += size;
  }
  return result.join('') + ' '.repeat(Math.max(0, columns - used));
}
function softWrapLine(value, columns) {
  const line = `${value}`;
  if (!line || width(line) <= columns) return [line];
  const indent = line.match(/^\s*(?:[-*+]\s+|\d+[.)]\s+|>\s*)?/u)?.[0] || '';
  const continuation = ' '.repeat(Math.min(width(indent), Math.max(0, columns - 1)));
  const words = line.slice(indent.length).split(/(\s+)/u);
  const lines = [];
  let current = indent;
  const push = () => {
    lines.push(current.trimEnd());
    current = continuation;
  };
  for (const word of words) {
    if (!word) continue;
    if (/^\s+$/u.test(word)) {
      if (current && !current.endsWith(' ')) current += ' ';
      continue;
    }
    if (width(current) + width(word) <= columns) {
      current += word;
      continue;
    }
    if (current.trim()) push();
    let remainder = word;
    while (width(current) + width(remainder) > columns) {
      const budget = Math.max(1, columns - width(current));
      let piece = '';
      for (const character of remainder) {
        if (width(piece) + characterWidth(character) > budget) break;
        piece += character;
      }
      current += piece;
      remainder = remainder.slice(piece.length);
      push();
    }
    current += remainder;
  }
  if (current.trim() || !lines.length) lines.push(current.trimEnd());
  return lines;
}
function softWrap(lines, columns) {
  return lines.flatMap((line) => softWrapLine(line, Math.max(8, columns)));
}
function packControlLabels(labels, columns) {
  const separator = ' • ';
  return labels.reduce((lines, label) => {
    const next = lines.length ? `${lines.at(-1)}${separator}${label}` : label;
    if (lines.length && width(next) > columns) lines.push(label);
    else if (lines.length) lines[lines.length - 1] = next;
    else lines.push(label);
    return lines;
  }, []);
}
function diffViewLines(lines, columns) {
  return lines.flatMap((line) => {
    const prefix = line.type === 'addition' ? '+' : line.type === 'removal' ? '-' : ' ';
    const color = line.type === 'addition' ? COLORS.green : line.type === 'removal' ? COLORS.red : '';
    return softWrapLine(`${prefix} ${line.text}`, Math.max(8, columns)).map((row) =>
      color ? `${color}${row}${COLORS.reset}` : row
    );
  });
}
function railName(value) {
  return width(value) <= 16 ? `${value}` : crop(value, 16, true);
}
function promptPreview(value) {
  const characters = [...`${value || ''}`];
  return characters.length <= 75 ? characters.join('') : `${characters.slice(0, 74).join('')}…`;
}
function inputTokens(value) {
  return (
    `${value}`.match(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)|\u001b\[[0-?]*[ -/]*[@-~]|\u001bO.|\u001b.|./gsu) || []
  );
}
function mouseEvent(value) {
  const match = /^\u001b\[<([0-9]+);([0-9]+);([0-9]+)([Mm])$/.exec(value);
  if (!match) return null;
  return { button: Number(match[1]), column: Number(match[2]), row: Number(match[3]), final: match[4] };
}
function isVerticalWheel(mouse) {
  return mouse?.final === 'M' && (mouse.button & 64) !== 0 && (mouse.button & 3) < 2;
}
function isPrimaryClick(mouse) {
  return mouse?.final === 'M' && mouse.button === 0;
}
function isShiftedMouse(mouse) {
  return Boolean(mouse && (mouse.button & 4) !== 0);
}
function sanitizeTerminalTitle(value) {
  return `${value ?? ''}`.replace(/[\u0000-\u001f\u007f-\u009f]/gu, '');
}
function formatLocalDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
function hasOpenAttention(workspace) {
  const open = new Set(
    (workspace.workstreams || []).filter((stream) => stream.status !== 'closed').map((stream) => stream.id)
  );
  return (workspace.sessions || []).some(
    (session) => session.attention && !session.explicitlyClosed && open.has(session.workstreamId)
  );
}
function terminalTitle(name = null, attention = false) {
  const safe = sanitizeTerminalTitle(name);
  return `\u001b]2;${attention ? '* ' : ''}bdfl${safe ? ` - ${safe}` : ''}\u0007`;
}
function executionStateLabel(status, ready = false) {
  if (!status) return ready ? 'Not started' : 'Awaiting approval';
  if (['complete', 'completed'].includes(status)) return 'Complete';
  if (['failed', 'verification-failed'].includes(status)) return 'Failed';
  if (status === 'verifying') return 'Verifying';
  if (
    [
      'integration-queued',
      'integrating',
      'integration-conflict',
      'integration-checking',
      'integration-review'
    ].includes(status)
  )
    return 'Integration';
  if (status === 'running') return 'Working';
  if (status === 'cancelled') return 'Cancelled';
  return `${status}`
    .split('-')
    .map((part) => (part ? `${part[0].toUpperCase()}${part.slice(1)}` : ''))
    .join(' ');
}
function primaryRole(role) {
  return role === 'delegator' || role === 'direct';
}
function fallbackName(session, stream, workspace) {
  if (session?.name) return session.name;
  if (session?.role === 'worker') return `W ${session.roleSequence || Math.max(1, session.paneNumber - 1 || 1)}`;
  const provider =
    stream?.sessionType === 'direct'
      ? stream.directProfile?.provider
      : stream?.delegatorProfile?.provider || session?.profile?.provider || 'agent';
  const label = provider === 'claude' ? 'Claude Code' : display(provider);
  const index = workspace.workstreams.indexOf(stream);
  const sequence =
    stream?.providerSequence ||
    workspace.workstreams
      .slice(0, index + 1)
      .filter(
        (item) => (item.sessionType === 'direct' ? item.directProfile : item.delegatorProfile)?.provider === provider
      ).length ||
    1;
  return `${label} ${sequence}`;
}
function agentSessions(workspace, stream) {
  return childOrder(
    (workspace.sessions || []).filter(
      (session) =>
        session.workstreamId === stream.id &&
        (primaryRole(session.role) || ['worker', 'verifier', 'integration'].includes(session.role))
    )
  );
}
function pausedSession(session) {
  return session?.status === 'paused';
}
function terminalSession(session) {
  return Boolean(
    session?.explicitlyClosed ||
    session?.accepted ||
    session?.completed ||
    session?.superseded ||
    [
      'accepted',
      'cancelled',
      'closed',
      'complete',
      'completed',
      'done',
      'integrated',
      'rejected',
      'superseded'
    ].includes(session?.status)
  );
}
function resumableSession(session) {
  if (
    !session ||
    session.accepted ||
    session.completed ||
    session.superseded ||
    ['accepted', 'cancelled', 'complete', 'completed', 'done', 'integrated', 'rejected', 'superseded'].includes(
      session.status
    )
  )
    return false;
  return (
    session.status === 'paused' || Boolean(session.explicitlyClosed && (!session.status || session.status === 'closed'))
  );
}
function startableSession(session) {
  return Boolean(
    session &&
    (resumableSession(session) ||
      (!session.explicitlyClosed && session.status === 'closed') ||
      !terminalSession(session))
  );
}
function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
function errorPageLines(error) {
  const details = errorDetails(error);
  return [
    `${COLORS.bold}${COLORS.red}BDFL encountered an error${COLORS.reset}`,
    '',
    `${COLORS.bold}Code${COLORS.reset}     ${COLORS.yellow}${details.code}${COLORS.reset}`,
    `${COLORS.bold}Message${COLORS.reset}  ${details.message}`,
    '',
    `${COLORS.gray}Please open an issue and include the code and message:${COLORS.reset}`,
    `${COLORS.cyan}${ISSUE_URL}${COLORS.reset}`
  ];
}
function emptyStateLines() {
  const logo = [
    '██████╗ ██████╗ ███████╗██╗',
    '██╔══██╗██╔══██╗██╔════╝██║',
    '██████╔╝██║  ██║█████╗  ██║',
    '██╔══██╗██║  ██║██╔══╝  ██║',
    '██████╔╝██████╔╝██║     ███████╗',
    '╚═════╝ ╚═════╝ ╚═╝     ╚══════╝'
  ];
  return [
    ...logo.map((line) => `${COLORS.bold}${COLORS.yellow}${line}${COLORS.reset}`),
    '',
    `${COLORS.white}Benevolent Delegator for LLMs${COLORS.reset}`,
    `${COLORS.gray}Created by Nishant Hada${COLORS.reset}`
  ];
}

class Navigation {
  constructor(workspace) {
    this.workspace = workspace;
    this.rail = 'content';
    this.action = 0;
    this.workstream = 0;
    this.pane = 0;
    this.workstreamId = workspace.activeWorkstreamId || null;
    this.sessionId = null;
    this.activeAction = null;
    this.sync(workspace);
  }
  streams() {
    return createdOrder((this.workspace.workstreams || []).filter((stream) => stream.status !== 'closed'));
  }
  agents() {
    return this.streams().flatMap((stream) =>
      agentSessions(this.workspace, stream).map((session) => ({ stream, session }))
    );
  }
  sync(workspace) {
    this.workspace = workspace;
    const agents = this.agents();
    let index = agents.findIndex(({ session }) => session.id === this.sessionId);
    if (index < 0) {
      const open = ({ session }) => !pausedSession(session) && !terminalSession(session);
      index = agents.findIndex(
        ({ stream, session }) => stream.id === this.workstreamId && primaryRole(session.role) && open({ session })
      );
      if (index < 0)
        index = agents.findIndex(({ stream, session }) => stream.id === this.workstreamId && open({ session }));
      if (index < 0)
        index = agents.findIndex(
          ({ stream, session }) => stream.id === workspace.activeWorkstreamId && open({ session })
        );
      if (index < 0) index = agents.findIndex(open);
      if (index < 0)
        index = agents.findIndex(({ stream, session }) => stream.id === this.workstreamId && primaryRole(session.role));
      if (index < 0) index = 0;
    }
    const selected = agents[index];
    this.sessionId = selected?.session.id || null;
    this.workstreamId = selected?.stream.id || null;
    this.workstream = Math.max(
      0,
      this.streams().findIndex((stream) => stream.id === this.workstreamId)
    );
    const panes = this.panes();
    this.pane = Math.max(
      0,
      panes.findIndex((session) => session.id === this.sessionId)
    );
    this.action = Math.min(this.action, Math.max(0, this.actions().length - 1));
    return this;
  }
  currentAgent() {
    return this.agents().find(({ session }) => session.id === this.sessionId) || null;
  }
  currentStream() {
    return this.currentAgent()?.stream || this.streams().find((stream) => stream.id === this.workstreamId);
  }
  panes() {
    return this.currentStream() ? agentSessions(this.workspace, this.currentStream()) : [];
  }
  actions() {
    return availableActions(this.workspace).filter((action) => action !== 'Close' || !this.activeAction);
  }
  selectedAction() {
    return this.actions()[this.action];
  }
  selectSession(id) {
    this.sessionId = id;
    return this.sync(this.workspace);
  }
  key(name) {
    if (this.rail === 'workstreams') {
      const agents = this.agents();
      const current = Math.max(
        0,
        agents.findIndex(({ session }) => session.id === this.sessionId)
      );
      if ((name === 'right' || name === 'left') && agents.length) {
        const delta = name === 'right' ? 1 : -1;
        const selected = agents[(current + agents.length + delta) % agents.length];
        this.sessionId = selected.session.id;
        this.workstreamId = selected.stream.id;
        this.sync(this.workspace);
      } else if (name === 'up') this.rail = 'actions';
    } else if (this.rail === 'actions') {
      if (name === 'left' && this.actions().length)
        this.action = (this.action + this.actions().length - 1) % this.actions().length;
      else if (name === 'right' && this.actions().length) this.action = (this.action + 1) % this.actions().length;
      else if (name === 'down') this.rail = 'workstreams';
    }
    return {
      rail: this.rail,
      action: this.selectedAction(),
      workstream: this.currentStream(),
      pane: this.currentAgent()?.session
    };
  }
}

class TerminalRenderer {
  constructor({ version = '0.1.0', reducedMotion = false } = {}) {
    this.version = version;
    this.reducedMotion = reducedMotion;
    this.chrome = new Chrome({ version, reducedMotion });
  }
  chromeWorkspace(workspace) {
    return {
      ...workspace,
      workstreams: (workspace.workstreams || []).map((stream) => {
        const primary = (workspace.sessions || []).find(
          (session) => session.workstreamId === stream.id && primaryRole(session.role)
        );
        return {
          ...stream,
          name: stream.name || (primary && fallbackName(primary, stream, workspace)) || stream.title
        };
      })
    };
  }
  options(workspace, navigation, options = {}) {
    const currentAgent = navigation.currentAgent();
    const current = currentAgent?.session;
    const primary =
      currentAgent &&
      (workspace.sessions || []).find(
        (session) => session.workstreamId === currentAgent.stream.id && primaryRole(session.role)
      );
    const title =
      options.title ||
      currentAgent?.stream.name ||
      (currentAgent && fallbackName(primary || current, currentAgent.stream, workspace));
    return {
      columns: options.columns,
      rows: options.rows,
      title,
      activeAction: navigation.activeAction,
      activeSessionId: navigation.activeAction ? null : navigation.sessionId,
      showClose: Boolean(current && !terminalSession(current) && !navigation.activeAction),
      isRunning: options.isRunning,
      isOpen: options.isOpen,
      phase: options.phase,
      tip: options.footerMessage || FOOTER_MESSAGES[0]
    };
  }
  layout(workspace, navigation, options = {}) {
    return this.chrome.layout(this.chromeWorkspace(workspace), this.options(workspace, navigation, options));
  }
  render(
    workspace,
    navigation,
    {
      columns = 100,
      rows = 28,
      content = [],
      footerMessage = FOOTER_MESSAGES[0],
      footerTone = 'gray',
      isRunning,
      isOpen,
      title
    } = {}
  ) {
    const layout = this.layout(workspace, navigation, { columns, rows, footerMessage, isRunning, isOpen, title });
    const lines = [...layout.lines];
    const inner = Math.max(1, columns - 2);
    const bodyRows = Math.max(1, rows - 3);
    for (let index = 0; index < bodyRows; index += 1)
      lines[index + 1] =
        `${COLORS.yellow}│${COLORS.reset}${fit(` ${content[index] || ''}`, inner)}${COLORS.yellow}│${COLORS.reset}`;
    if (layout.tipRow) {
      const tip = crop(footerMessage, Math.max(0, inner - 4), true);
      const padding = ' '.repeat(Math.max(0, inner - width(tip) - 2));
      const tone = footerTone === 'red' ? COLORS.red : COLORS.gray;
      lines[layout.tipRow - 1] =
        `${COLORS.yellow}│${COLORS.reset}${padding}${tone}${tip}${COLORS.reset}  ${COLORS.yellow}│${COLORS.reset}`;
    }
    layout.lines = lines;
    layout.output = lines.join('\n');
    this.lastLayout = layout;
    return layout.output;
  }
}

class TerminalSupervisor {
  constructor(
    root,
    {
      input = process.stdin,
      output = process.stdout,
      store = null,
      sessions,
      lineage,
      git,
      scheduler,
      integration,
      bridge,
      version = '0.1.0',
      dangerous = false,
      linkOpener = openExternal,
      setInterval: startInterval = global.setInterval,
      clearInterval: stopInterval = global.clearInterval,
      setTimeout: scheduleTimeout = global.setTimeout,
      clearTimeout: cancelTimeout = global.clearTimeout
    } = {}
  ) {
    this.input = input;
    this.output = output;
    this.store = store || new WorkspaceCatalog(root);
    this.root = this.store.coordinatorRoot?.() || path.resolve(root);
    this.dangerous = dangerous;
    this.lineage =
      lineage || (this.store.repositoryRoots ? new LineageCatalog(this.store) : new LineageStore(this.root));
    this.git = git || new ExecutionGit(this.root);
    this.scheduler =
      scheduler ||
      new WorkerScheduler(this.root, {
        store: this.store,
        lineage: this.lineage,
        worktrees: this.git,
        launcher: (value) => this.launchWorker(value),
        validator: (value) => this.validateWorker(value)
      });
    this.integration =
      integration ||
      new IntegrationCoordinator({
        scheduler: this.scheduler,
        git: this.git,
        lineage: this.lineage,
        agentLauncher: (value) => this.launchExecutionAgent(value)
      });
    if (!scheduler)
      this.scheduler.onAllAccepted = (executionId) => {
        try {
          this.integration.prepare(executionId);
        } catch (error) {
          this.error = codedError('INTEGRATION_PREPARE_FAILED', error.message);
          this.scheduleDraw();
        }
      };
    if (!scheduler)
      this.scheduler.onRepairsAccepted = (executionId, round) => {
        try {
          this.integration.combineVerificationRepairs(executionId, round);
        } catch (error) {
          this.error = codedError('VERIFICATION_REPAIR_COMBINE_FAILED', error.message);
          this.scheduleDraw();
        }
      };
    this.workerService = new WorkerService({
      scheduler: this.scheduler,
      integration: this.integration,
      sender: (executionId, chunkId, message) => this.sendWorker(executionId, chunkId, message)
    });
    this.bridge =
      bridge || new ControlServer({ planService: new PlanService(this.lineage), workerService: this.workerService });
    this.bridge.setToolSuccessHandler?.((event) => this.handleToolSuccess(event));
    this.sessions =
      sessions || new SessionManager(this.root, this.store, { bridge: this.bridge, requireBridge: true, dangerous });
    this.sessions.onOutput = (sessionId, event) => {
      if (this.visibleSessionId() !== sessionId) return;
      if (event?.scroll || event?.activity) this.scheduleDraw();
      else this.scheduleOutputDraw(sessionId);
    };
    this.sessions.onAttention = (sessionId) => this.raiseAttention(sessionId);
    this.sessions.onBridgeError = (_sessionId, error) => {
      this.error = codedError('BRIDGE_RECOVERY_FAILED', error.message);
      this.scheduleDraw();
    };
    this.sessions.onExit = (session, result) => {
      if (!session?.executionId || !['verifier', 'integration'].includes(session.role)) return;
      try {
        const execution = this.scheduler.load?.(session.executionId);
        const activeAgent =
          execution?.integration?.agent?.sessionId ||
          (execution?.status === 'verifying'
            ? execution?.integration?.verifier?.sessionId
            : execution?.integration?.worker?.sessionId);
        if (activeAgent !== session.id) return;
        const reason = `Execution agent exited before reporting (exit ${result.exitCode ?? 'unknown'}, signal ${result.signal ?? 'none'})`;
        if (execution.status === 'verifying')
          this.integration.retryVerification?.(session.executionId, { sessionId: session.id, reason });
        else if (execution.status === 'integration-conflict')
          this.integration.repaired?.(session.executionId, { state: 'fail', summary: reason });
      } catch (error) {
        this.error = codedError('EXECUTION_AGENT_RECOVERY_FAILED', error.message);
      }
      this.scheduleDraw();
    };
    this.renderer = new TerminalRenderer({ version, reducedMotion: process.env.NO_COLOR === '1' });
    this.reviewView = new ReviewView();
    this.linkOpener = linkOpener;
    this.lastFocused = new Map();
    this.reviewDiffCache = new Map();
    this.groupPageStates = new Map();
    this.sessionExpanded = null;
    this.previousSurface = null;
    this.lockFile = path.join(this.root, '.bdfl', 'run', 'supervisor.lock');
    this.locks = [];
    this.quitPending = false;
    this.quitTimer = undefined;
    this.outputDrawTimer = undefined;
    this.lastFrameLines = null;
    this.lastTerminalTitle = null;
    this.startInterval = startInterval;
    this.stopInterval = stopInterval;
    this.scheduleTimeout = scheduleTimeout;
    this.cancelTimeout = cancelTimeout;
    const reconcile = () => {
      let errors;
      try {
        errors = this.reconcileManagedSessions();
      } catch (error) {
        errors = [{ sessionId: 'managed sessions', error }];
      }
      if (errors.length)
        this.error = codedError(
          'SESSION_RECONCILE_FAILED',
          errors.map(({ sessionId, error }) => `${sessionId}: ${error.message}`).join(' · ')
        );
      this.scheduleDraw();
    };
    const schedulerChange = this.scheduler.onChange;
    this.scheduler.onChange = (...args) => {
      schedulerChange?.(...args);
      reconcile();
    };
    const integrationChange = this.integration.onChange;
    this.integration.onChange = (...args) => {
      integrationChange?.(...args);
      reconcile();
    };
  }
  createWizard() {
    if (!this.store.selectableRepositories)
      return new WorkstreamWizard({
        repositories: [{ root: this.root, label: '.', lastUsed: this.store.loadConfig?.() }]
      });
    return new WorkstreamWizard({
      repositories: this.store.selectableRepositories(),
      rememberedRepositoryRoot: this.store.rememberedRepositoryRoot?.()
    });
  }
  finishWizard(config) {
    const stream = this.store.createWorkstream(config, undefined, config.repositoryRoot);
    const direct = config.sessionType === 'direct';
    const session = this.store.createSession(
      stream.id,
      direct ? 'direct' : 'delegator',
      direct ? config.directProfile : config.delegatorProfile,
      { turnState: 'idle', turnStateReason: 'awaiting start' }
    );
    this.wizard = null;
    this.navigation = new Navigation(this.store.load());
    this.navigation.selectSession(session.id);
    this.navigation.activeAction = null;
    this.clearFocusedAttention();
    return session;
  }
  markTurn(sessionId, state, reason) {
    if (!sessionId) return;
    try {
      this.store.setSessionTurnState?.(sessionId, state, reason);
    } catch {}
  }
  handleToolSuccess({ capability, name, arguments: args }) {
    if (name === 'bdfl_plan' && args.action === 'publish')
      this.markTurn(capability.sessionId, 'idle', 'plan published');
    else if (name === 'bdfl_workers' && args.action === 'complete')
      this.markTurn(capability.sessionId, 'idle', `reported ${args.state}`);
    else if (name === 'bdfl_workers' && ['feedback', 'send'].includes(args.action)) {
      const chunk = this.scheduler
        .load?.(args.executionId || capability.executionId)
        ?.chunks?.find((item) => item.id === (args.chunkId || capability.chunkId));
      this.markTurn(
        chunk?.verificationRepairs?.at(-1)?.attempts?.at(-1)?.sessionId || chunk?.attempts?.at(-1)?.sessionId,
        'working',
        args.action
      );
    } else if (name === 'bdfl_workers' && args.action === 'remedy') {
      const execution = this.scheduler.load?.(args.executionId || capability.executionId);
      this.markTurn(
        execution?.integration?.agent?.sessionId || execution?.integration?.worker?.sessionId,
        'working',
        'accepted remedy'
      );
    }
    this.scheduleDraw();
  }
  workerPrompt(execution, chunk, context) {
    return `You are a BDFL-managed worker for “${chunk.title || chunk.taskSnippet || chunk.id}”. Work only in your isolated worktree and only within the approved paths: ${chunk.paths.join(', ')}. Read the complete frozen plan and explicit assignment at ${context}. Before editing, audit your chunk against the Summary, shared decisions, every chunk, dependency results, global validation, and assignment manifest. Implement the chunk, run useful checks, audit the result against the complete plan again, then call bdfl_workers complete with a concise summary. Do not create subagents, publish plans, start executions, or integrate branches.`;
  }
  launchWorker({ execution, chunk, attempt, context, profile, taskSnippet, repair }) {
    if (repair) return this.launchRepairWorker({ execution, chunk, attempt, context, profile, taskSnippet, repair });
    const worktree = this.git.createWorker(
      execution.id,
      chunk.id,
      attempt.number,
      attempt.base,
      execution.repositoryRoot
    );
    const session = this.store.createSession(execution.workstreamId, 'worker', profile, {
      executionId: execution.id,
      chunkId: chunk.id,
      worktree: worktree.worktree,
      taskSnippet,
      turnState: 'working',
      turnStateReason: 'implementation started',
      roleInstruction: this.workerPrompt(execution, chunk, context)
    });
    this.sessions.open(session.id, this.dimensions());
    return { ...worktree, sessionId: session.id, context };
  }
  repairWorkerPrompt(execution, chunk, context, repair, replacement) {
    return `You are ${replacement ? 'a clearly labeled replacement for' : 'the original contextual worker resuming'} verification repair round ${repair.round} for “${chunk.title || chunk.id}”. Work only in the isolated repair worktree and only within this chunk's approved paths: ${chunk.paths.join(', ')}. Read the complete frozen plan, verifier findings, prior accepted result, dependency results, and repair assignment at ${context}. Audit this chunk against the whole plan before editing and again before reporting. Repair every applicable finding without changing other chunks. Run focused checks, then call bdfl_workers complete. Your diff must return to Review for explicit re-acceptance.`;
  }
  launchRepairWorker({ execution, chunk, attempt, context, profile, taskSnippet, repair }) {
    const worktree = this.git.createWorker(
      execution.id,
      `${chunk.id}-verification-repair-${repair.round}`,
      attempt.number,
      attempt.base,
      execution.repositoryRoot
    );
    const original = repair.originalSessionId
      ? this.store.load().sessions.find((session) => session.id === repair.originalSessionId)
      : null;
    if (original?.providerSessionId || original?.profile?.provider === 'claude') {
      if (this.sessions.isOpen?.(original.id)) this.sessions.close?.(original.id, true);
      const roleInstruction = this.repairWorkerPrompt(execution, chunk, context, repair, false);
      this.store.update((state) => {
        const session = state.sessions.find((item) => item.id === original.id);
        if (session) {
          session.worktree = worktree.worktree;
          session.roleInstruction = roleInstruction;
          session.taskSnippet = taskSnippet;
          session.status = 'paused';
          session.explicitlyClosed = true;
        }
        return state;
      });
      this.sessions.resume?.(original.id, this.dimensions());
      this.sessions.continueWhenReady?.(original.id, roleInstruction);
      return { ...worktree, sessionId: original.id, context, replacement: false };
    }
    const roleInstruction = this.repairWorkerPrompt(execution, chunk, context, repair, true);
    const session = this.store.createSession(execution.workstreamId, 'worker', profile, {
      name: this.nextManagedName(execution.workstreamId, 'Replacement'),
      executionId: execution.id,
      chunkId: chunk.id,
      worktree: worktree.worktree,
      taskSnippet: `Replacement · ${taskSnippet}`,
      turnState: 'working',
      turnStateReason: `verification repair ${repair.round}`,
      roleInstruction
    });
    this.sessions.open(session.id, this.dimensions());
    return { ...worktree, sessionId: session.id, context, replacement: true };
  }
  async validateWorker({ execution, chunk, attempt }) {
    const head = this.git.checkpoint(attempt.worktree, `BDFL ${execution.planId} ${chunk.id}`);
    const verify = this.git.verifyResultAsync?.bind(this.git) || this.git.verifyResult.bind(this.git);
    return verify({
      base: attempt.base,
      head,
      ownedPaths: chunk.paths,
      checks: chunk.checks || [],
      worktree: attempt.worktree
    });
  }
  sendWorker(executionId, chunkId, message) {
    const chunk = this.scheduler.load(executionId).chunks.find((item) => item.id === chunkId);
    const sessionId =
      chunk?.verificationRepairs?.at(-1)?.attempts?.at(-1)?.sessionId || chunk?.attempts.at(-1)?.sessionId;
    if (!sessionId) throw new Error(`No active worker session for ${chunkId}`);
    const session = this.store.load().sessions.find((item) => item.id === sessionId);
    const open =
      this.sessions.isOpen?.(sessionId) ??
      Boolean(session && !session.explicitlyClosed && session.status === 'running');
    if (!open) {
      if (!session) throw new Error(`Worker session is unavailable: ${sessionId}`);
      if (this.sessions.resume) this.sessions.resume(sessionId, this.dimensions());
      else this.sessions.open(sessionId, this.dimensions());
    }
    this.markTurn(sessionId, 'working', 'feedback');
    this.sessions.write(sessionId, `\u001b[200~${message}\u001b[201~`);
    this.sessions.write(sessionId, '\r');
  }
  nextManagedName(workstreamId, prefix) {
    const expression = new RegExp(`^${prefix} ([0-9]+)$`);
    const used = this.store
      .load()
      .sessions.filter((session) => session.workstreamId === workstreamId)
      .map((session) => expression.exec(session.name)?.[1])
      .filter(Boolean)
      .map(Number);
    return `${prefix} ${Math.max(0, ...used) + 1}`;
  }
  executionAgentBasePrompt(execution) {
    return `You are the single durable BDFL execution agent for ${execution.planId}. You retain this provider conversation across verification, explicitly accepted repairs, consolidation conflict repair, and final target reconciliation. Only implementation workers are isolated. BDFL will send one phase instruction at a time. Verification phases are read-only; repair and reconciliation phases may edit only the named generated worktree and approved paths. Never modify the target checkout directly, never infer or start a phase transition yourself, and call bdfl_workers complete with state pass or fail only when the current phase instruction is finished.`;
  }
  executionAgentPrompt({ integration, result, allowedPaths = [], phase, context }) {
    const paths = allowedPaths.length ? allowedPaths.join(', ') : 'the approved plan path union';
    if (['verification', 'verification-retry'].includes(phase)) {
      const repaired = integration.verificationPurpose === 'remedy-verification';
      const stage = repaired
        ? 'This verification follows an accepted repair.'
        : integration.verificationPurpose === 'target-reconciliation'
          ? 'This verifies the reconciled target result immediately before integration completes.'
          : 'This is the initial consolidated verification.';
      return `Execution phase: verification. ${stage} This phase is read-only. Do not edit files. Inspect the active result in ${integration.worktree}, its entire diff, and every approved plan section at ${context}. Perform one comprehensive audit and do not stop after the first defect. If anything fails, report all findings together with numbered evidence, affected chunk IDs, and a concrete remedy for each. If verification fails, wait in this same conversation for the user's remedy decision; do not start repairs until BDFL sends an accepted-remedy continuation.`;
    }
    if (phase === 'verification-remedy')
      return `Execution phase: accepted verification remedy. The user accepted verifier remedies. Work only in ${integration.worktree}; changes are restricted to ${paths}.\n\n${result?.message || 'Inspect the recorded verifier failure.'}\n\nRead the full verifier context at ${context || integration.context}. Implement every remedy with regression coverage, then audit the entire consolidated change and all acceptance conditions. Fix additional defects you find, rerun focused checks, and repeat until clean. Do not report pass merely because existing tests pass. BDFL runs global validation after your report.`;
    if (phase === 'target' || phase === 'target-validation')
      return `Execution phase: target reconciliation. Work only in the active reconciliation worktree ${integration.worktree}; changes are restricted to ${paths}. ${phase === 'target-validation' ? 'Repair the failed reconciled validation while preserving both committed intents.' : 'Resolve the target conflict by preserving both the committed target changes and the approved BDFL result.'}\n\n${result?.message || ''}\n\nInspect the approved plan, your earlier verification/repair decisions, and Git history. Run focused checks, then report only when the reconciled tree is clean.`;
    return `Execution phase: consolidation repair. Resolve the worker consolidation conflict in ${integration.worktree}; changes are restricted to ${paths}.\n\n${result?.message || ''}\n\nPreserve the approved plan intent and your full execution context. BDFL runs global checks after you report.`;
  }
  launchExecutionAgent(value) {
    const { execution, agent, profile } = value;
    const prompt = this.executionAgentPrompt(value);
    const roleInstruction = this.executionAgentBasePrompt(execution);
    const workspaceRoot = path.join(execution.repositoryRoot || this.root, '.bdfl', 'worktrees');
    const existing = agent?.sessionId && this.store.load().sessions.find((session) => session.id === agent.sessionId);
    if (existing?.role === 'integration') {
      this.store.update?.((state) => {
        const current = state.sessions.find((session) => session.id === existing.id);
        if (current) current.roleInstruction = roleInstruction;
        return state;
      });
      this.markTurn(existing.id, 'working', `managed ${value.phase || 'phase'}`);
      if (!(this.sessions.isOpen?.(existing.id) ?? (!existing.explicitlyClosed && existing.status === 'running')))
        this.sessions.open(existing.id, this.dimensions());
      this.sessions.continueWhenReady?.(existing.id, prompt);
      return { sessionId: existing.id };
    }
    const session = this.store.createSession(execution.workstreamId, 'integration', profile, {
      name: this.nextManagedName(execution.workstreamId, 'Execution'),
      executionId: execution.id,
      worktree: workspaceRoot,
      taskSnippet: `Execute and verify ${execution.planId}`,
      turnState: 'working',
      turnStateReason: `managed ${value.phase || 'phase'}`,
      roleInstruction
    });
    this.sessions.open(session.id, this.dimensions());
    this.sessions.continueWhenReady?.(session.id, prompt);
    return { sessionId: session.id, ...(existing ? { replacesSessionId: existing.id } : {}) };
  }
  launchVerifier(value) {
    return this.launchExecutionAgent({ ...value, phase: value.phase || 'verification' });
  }
  launchIntegrationWorker(value) {
    return this.launchExecutionAgent(value);
  }
  recoverIncompleteVerifications() {
    const errors = [];
    for (const execution of this.scheduler.list?.().filter((item) => item.status === 'verifying') || []) {
      const sessionId = execution.integration?.agent?.sessionId || execution.integration?.verifier?.sessionId;
      const session = this.store.load().sessions.find((item) => item.id === sessionId);
      const open =
        sessionId &&
        (this.sessions.isOpen?.(sessionId) ??
          Boolean(session && !session.explicitlyClosed && session.status === 'running'));
      try {
        if (open) this.sessions.continueWhenReady?.(sessionId, VERIFIER_CONTINUATION);
        else {
          if (session && !session.explicitlyClosed) this.sessions.close?.(sessionId, true);
          this.integration.retryVerification?.(execution.id, {
            sessionId,
            reason: 'Execution agent was unavailable when the BDFL supervisor restored verification'
          });
        }
      } catch (error) {
        errors.push({ executionId: execution.id, error });
      }
    }
    return errors;
  }
  recoverIncompleteIntegrations() {
    const errors = [];
    for (const execution of this.scheduler.list?.().filter((item) => item.status === 'integration-conflict') || []) {
      const sessionId = execution.integration?.agent?.sessionId || execution.integration?.worker?.sessionId;
      const session = this.store.load().sessions.find((item) => item.id === sessionId);
      const open =
        sessionId &&
        (this.sessions.isOpen?.(sessionId) ??
          Boolean(session && !session.explicitlyClosed && session.status === 'running'));
      try {
        if (open) this.sessions.continueWhenReady?.(sessionId, INTEGRATION_CONTINUATION);
        else if (session?.role === 'integration') {
          try {
            this.sessions.open?.(sessionId, this.dimensions());
            this.sessions.continueWhenReady?.(sessionId, INTEGRATION_CONTINUATION);
          } catch {
            this.integration.repaired?.(execution.id, {
              state: 'fail',
              summary: 'Execution agent was unavailable when the BDFL supervisor restored repair or reconciliation'
            });
          }
        } else {
          if (session && !session.explicitlyClosed) this.sessions.close?.(sessionId, true);
          this.integration.repaired?.(execution.id, {
            state: 'fail',
            summary: 'Conflict-resolution agent was unavailable when the BDFL supervisor restored the execution'
          });
        }
      } catch (error) {
        errors.push({ executionId: execution.id, error });
      }
    }
    return errors;
  }
  reconcileManagedSessions() {
    if (!this.scheduler.list) return [];
    const active = new Set();
    const interactiveWorkerStates = new Set(['running', 'waiting', 'review', 'failed']);
    for (const execution of this.scheduler.list() || []) {
      if (!['complete', 'cancelled'].includes(execution.status))
        for (const chunk of execution.chunks || []) {
          const attempt = chunk.attempts?.at(-1);
          if (attempt?.sessionId && interactiveWorkerStates.has(chunk.status)) active.add(attempt.sessionId);
          const repair = chunk.verificationRepairs?.at(-1);
          const repairAttempt = repair?.attempts?.at(-1);
          if (
            repairAttempt?.sessionId &&
            ['running', 'waiting', 'review', 'failed', 'checking'].includes(repair.status)
          )
            active.add(repairAttempt.sessionId);
        }
      const agentId = execution.integration?.agent?.sessionId;
      if (agentId && !['complete', 'cancelled'].includes(execution.status)) active.add(agentId);
      const verifierId = execution.integration?.verifier?.sessionId;
      const verifierAttempt = execution.integration?.verifierAttempts?.findLast(
        (attempt) => attempt.sessionId === verifierId
      );
      if (
        execution.status === 'verifying' &&
        verifierId &&
        (!verifierAttempt || (!verifierAttempt.completedAt && !verifierAttempt.result))
      )
        active.add(verifierId);
      const workerId = execution.integration?.worker?.sessionId;
      const repairAttempt = execution.integration?.repairAttempts?.findLast(
        (attempt) => attempt.sessionId === workerId
      );
      if (
        execution.status === 'integration-conflict' &&
        workerId &&
        (!repairAttempt || (!repairAttempt.completedAt && !repairAttempt.result))
      )
        active.add(workerId);
    }
    const errors = [];
    for (const session of this.store
      .load()
      .sessions.filter(
        (item) =>
          ['worker', 'verifier', 'integration'].includes(item.role) &&
          item.executionId &&
          !item.explicitlyClosed &&
          !active.has(item.id)
      )) {
      try {
        this.sessions.close?.(session.id, true);
      } catch (error) {
        errors.push({ executionId: session.executionId, sessionId: session.id, error });
      }
    }
    return errors;
  }
  closeInactiveManagedAgents() {
    return this.reconcileManagedSessions();
  }
  closeInactiveIntegrationAgents() {
    return this.reconcileManagedSessions();
  }
  lockFiles() {
    return [
      ...new Set(
        [this.root, ...(this.store.lockRoots?.() || [])].map((directory) =>
          path.join(directory, '.bdfl', 'run', 'supervisor.lock')
        )
      )
    ].sort();
  }
  acquireFile(file) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const descriptor = fs.openSync(file, 'wx', 0o600);
        fs.writeFileSync(descriptor, `${process.pid}\n`);
        return descriptor;
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        let owner;
        try {
          owner = Number.parseInt(fs.readFileSync(file, 'utf8'), 10);
        } catch {}
        let alive = Number.isInteger(owner) && owner > 0;
        if (alive) {
          try {
            process.kill(owner, 0);
          } catch (probe) {
            if (probe.code === 'ESRCH') alive = false;
          }
        }
        if (alive || attempt) {
          const conflict = new Error(`Another BDFL supervisor owns ${path.dirname(path.dirname(path.dirname(file)))}`);
          conflict.code = 'WORKSPACE_LOCKED';
          throw conflict;
        }
        try {
          fs.unlinkSync(file);
        } catch (remove) {
          if (remove.code !== 'ENOENT') throw remove;
        }
      }
    }
  }
  acquire() {
    try {
      for (const file of this.lockFiles()) this.locks.push({ file, descriptor: this.acquireFile(file) });
      this.lock = this.locks[0]?.descriptor;
    } catch (error) {
      this.release();
      throw error;
    }
  }
  release() {
    for (const { file, descriptor } of this.locks.splice(0).reverse()) {
      try {
        fs.closeSync(descriptor);
      } catch {}
      try {
        fs.unlinkSync(file);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    this.lock = undefined;
  }
  dimensions() {
    return { columns: Math.max(20, (this.output.columns || 100) - 4), rows: Math.max(1, (this.output.rows || 28) - 3) };
  }
  contentGeometry(headerLines = 0) {
    return { bodyTop: 2 + headerLines, bodyLeft: 3, bodyWidth: this.dimensions().columns };
  }
  planItems() {
    return this.viewModel?.plans || createdOrder(this.lineage.list?.() || []);
  }
  planAgentLines(lineage, prefix = '') {
    const workspace = this.workspace || this.store.load();
    const planning = workspace.sessions.find((session) => session.id === lineage.originSessionId);
    const stream = workspace.workstreams.find((item) => item.id === lineage.workstreamId);
    const planningText = planning?.name || 'Unavailable';
    const profile = stream?.workerProfile;
    const workerText =
      stream && profile
        ? `${display(profile.provider)}${profile.model ? ` ${profile.model}` : ''}${profile.effort ? ` · ${profile.effort} effort` : ''} · max ${stream.workerCapacity}`
        : 'Unavailable';
    const row = (connector, label, detail) =>
      `${COLORS.gray}${prefix}${connector}${COLORS.reset} ${COLORS.bold}${COLORS.white}${label}${COLORS.reset}${COLORS.gray} · ${detail}${COLORS.reset}`;
    return [row('├─', 'Planning agent', planningText), row('└─', 'Worker agent', workerText)];
  }
  versionExecution(planId, version) {
    return (
      (this.viewModel?.executions || this.scheduler.list?.() || []).find(
        (execution) => execution.planId === planId && execution.version === version
      ) || null
    );
  }
  reviewItems(workspace = this.workspace || this.store.load(), providedExecutions = null, providedLineages = null) {
    if (!providedExecutions && !providedLineages && workspace === this.workspace && this.viewModel?.reviews)
      return this.viewModel.reviews;
    let executions = providedExecutions || this.scheduler.list?.();
    if (!executions) {
      const directory = path.join(this.root, '.bdfl', 'executions');
      let entries;
      try {
        entries = fs.readdirSync(directory, { withFileTypes: true });
      } catch {
        entries = [];
      }
      executions = entries
        .filter((entry) => entry.isDirectory())
        .flatMap((entry) => {
          try {
            return [JSON.parse(fs.readFileSync(path.join(directory, entry.name, 'execution.json'), 'utf8'))];
          } catch {
            return [];
          }
        });
    }
    const lineages =
      providedLineages || new Map((this.lineage.list?.() || []).map((lineage) => [lineage.planId, lineage]));
    const decorate = (execution, item, sessionId) => {
      const lineage = lineages.get(execution.planId);
      const workstreamId = execution.workstreamId || lineage?.workstreamId;
      const planning =
        workspace.sessions.find((session) => session.id === lineage?.originSessionId) ||
        workspace.sessions.find((session) => session.workstreamId === workstreamId && session.role === 'delegator');
      const agent = workspace.sessions.find((session) => session.id === sessionId);
      const planningName = planning
        ? fallbackName(
            planning,
            workspace.workstreams.find((stream) => stream.id === workstreamId),
            workspace
          )
        : 'Planning agent unavailable';
      const agentName = agent?.name;
      return {
        ...item,
        executionId: execution.id,
        workstreamId,
        planId: execution.planId,
        planTitle: lineage?.name || lineage?.title || 'Untitled plan',
        planUpdatedAt: lineage?.updatedAt || lineage?.createdAt,
        agentLabel: agentName ? `${planningName} (${agentName})` : planningName,
        repositoryRoot: execution.repositoryRoot
      };
    };
    return executions.flatMap((execution) => {
      const chunks = (execution.chunks || [])
        .filter((chunk) => {
          const sessionId = chunk.attempts?.at(-1)?.sessionId;
          const session = workspace.sessions.find((item) => item.id === sessionId);
          return (
            ['review', 'waiting', 'failed', 'accepted'].includes(chunk.status) ||
            (chunk.status === 'running' && session?.attention) ||
            chunk.summary ||
            chunk.diff ||
            chunk.commit ||
            chunk.feedback?.length
          );
        })
        .map((chunk) => {
          const repair = chunk.verificationRepairs?.at(-1);
          const sessionId = repair?.attempts?.at(-1)?.sessionId || chunk.attempts?.at(-1)?.sessionId;
          const session = workspace.sessions.find((item) => item.id === sessionId);
          const presented =
            repair && execution.verificationRepair?.round === repair.round
              ? {
                  ...chunk,
                  status: repair.status === 'accepted' ? 'accepted' : repair.status,
                  summary: repair.summary || `Verification repair round ${repair.round}`,
                  commit: repair.commit,
                  changedPaths: repair.changedPaths || [],
                  checkResults: repair.checkResults || [],
                  diff: repair.diff || '',
                  verificationRepair: repair,
                  repairRound: repair.round
                }
              : chunk;
          return decorate(
            execution,
            { ...presented, attention: Boolean(session?.attention), diff: presented.diff || '', kind: 'chunk' },
            sessionId
          );
        });
      if (execution.integration) {
        const sessionId =
          execution.integration?.agent?.sessionId ||
          (execution.status === 'integration-conflict'
            ? execution.integration?.worker?.sessionId
            : execution.integration?.verifier?.sessionId);
        chunks.push(
          decorate(
            execution,
            {
              id: 'combined-result',
              kind: 'final',
              status: execution.status,
              summary:
                execution.status === 'integration-checking'
                  ? 'Running bounded global validation in the background.'
                  : execution.integration.phase
                    ? [
                        execution.integration.phase.progress,
                        execution.integration.phase.nextStep,
                        execution.verification?.summary
                      ]
                        .filter(Boolean)
                        .join(' · ')
                    : execution.verification?.summary,
              diff: execution.integration?.finalDiff,
              checks: execution.integration?.checkResults || [],
              verification: execution.verification,
              phase: execution.integration.phase
            },
            sessionId
          )
        );
      }
      return chunks;
    });
  }
  reviewDetailItem(item) {
    if (item?.verificationRepair) return item;
    if (!item || item.kind !== 'chunk' || !this.git.resultDiff) return item;
    const key = `${item.executionId}:${item.id}:${item.commit || ''}:${item.status || ''}`;
    if (!this.reviewDiffCache.has(key)) {
      let diff = item.diff || '';
      try {
        const execution = (this.viewModel?.executions || this.scheduler.list?.() || []).find(
          (value) => value.id === item.executionId
        );
        const chunk = execution?.chunks?.find((value) => value.id === item.id);
        diff =
          this.git.resultDiff(chunk || item, item.repositoryRoot || execution?.repositoryRoot || this.root) || diff;
      } catch {}
      this.reviewDiffCache.clear();
      this.reviewDiffCache.set(key, diff);
    }
    return { ...item, diff: this.reviewDiffCache.get(key) };
  }
  decorateWorkspace(workspace, executions = null, plans = null) {
    const visual = new Map();
    const mark = (sessionId, values) => {
      if (sessionId) visual.set(sessionId, { ...(visual.get(sessionId) || {}), ...values });
    };
    for (const execution of executions || this.scheduler.list?.() || []) {
      for (const chunk of execution.chunks || []) {
        const attempts = chunk.attempts || [];
        attempts.forEach((attempt, index) =>
          mark(
            attempt.sessionId,
            index < attempts.length - 1
              ? { superseded: true, chunkTitle: chunk.title || chunk.taskSnippet || chunk.id }
              : {
                  chunkTitle: chunk.title || chunk.taskSnippet || chunk.id,
                  attemptStatus: chunk.status,
                  accepted: chunk.status === 'accepted',
                  completed: ['complete', 'completed'].includes(chunk.status)
                }
          )
        );
        for (const verificationRepair of chunk.verificationRepairs || [])
          verificationRepair.attempts?.forEach((attempt, index) =>
            mark(
              attempt.sessionId,
              index < verificationRepair.attempts.length - 1 || verificationRepair.status === 'accepted'
                ? {
                    superseded: index < verificationRepair.attempts.length - 1,
                    completed: verificationRepair.status === 'accepted'
                  }
                : {
                    chunkTitle: chunk.title || chunk.id,
                    workerPhase: `Verification repair ${verificationRepair.round}`,
                    attemptStatus: verificationRepair.status,
                    executionStatus: execution.status
                  }
            )
          );
      }
      const verifierAttempts = execution.integration?.verifierAttempts || [];
      verifierAttempts.forEach((attempt, index) =>
        mark(
          attempt.sessionId,
          index < verifierAttempts.length - 1 || attempt.result
            ? {
                superseded: index < verifierAttempts.length - 1,
                completed: Boolean(attempt.result),
                workerPhase: 'Review',
                executionStatus: execution.status
              }
            : { workerPhase: 'Review', attemptStatus: execution.status, executionStatus: execution.status }
        )
      );
      const repairAttempts = execution.integration?.repairAttempts || [];
      repairAttempts.forEach((attempt, index) =>
        mark(
          attempt.sessionId,
          index < repairAttempts.length - 1 || attempt.result
            ? {
                superseded: index < repairAttempts.length - 1,
                completed: Boolean(attempt.result),
                workerPhase: 'Integration',
                executionStatus: execution.status
              }
            : { workerPhase: 'Integration', attemptStatus: execution.status, executionStatus: execution.status }
        )
      );
    }
    const published = new Set((plans || this.planItems()).map((lineage) => lineage.originSessionId).filter(Boolean));
    return {
      ...workspace,
      sessions: (workspace.sessions || []).map((session) => {
        const metadata = visual.get(session.id) || {};
        let turnState = session.turnState;
        if (!turnState) {
          const completedTurn =
            metadata.accepted ||
            metadata.completed ||
            metadata.superseded ||
            ['waiting', 'review', 'failed'].includes(metadata.attemptStatus) ||
            published.has(session.id) ||
            (session.role === 'direct' && session.attention);
          turnState = completedTurn
            ? 'idle'
            : !session.explicitlyClosed && session.status === 'running'
              ? 'working'
              : undefined;
        }
        return { ...session, ...metadata, ...(turnState ? { turnState } : {}) };
      })
    };
  }
  buildViewModel() {
    const plans = createdOrder(this.lineage.list?.() || []);
    const executions = this.scheduler.list?.() || [];
    const lineages = new Map(plans.map((lineage) => [lineage.planId, lineage]));
    const manifests = new Map();
    for (const plan of plans) {
      try {
        manifests.set(
          `${plan.planId}:${plan.currentVersion}`,
          this.lineage.readManifest(plan.planId, plan.currentVersion)
        );
      } catch {}
    }
    const workspace = this.decorateWorkspace(this.store.load(), executions, plans);
    const reviews = this.reviewItems(workspace, executions, lineages);
    return {
      plans,
      executions,
      lineages,
      manifests,
      reviews,
      workspace: { ...workspace, planCount: plans.length, reviewCount: reviews.length }
    };
  }
  sessionPickerItems(workspace = this.workspace || this.store.load()) {
    return createdOrder(workspace.workstreams || []);
  }
  sessionPickerRows(workspace = this.workspace || this.store.load(), expanded = this.sessionPicker?.expanded) {
    return this.sessionPickerItems(workspace).flatMap((stream) => {
      const sessions = workspace.sessions
        .filter(
          (session) =>
            session.workstreamId === stream.id &&
            (primaryRole(session.role) || ['worker', 'verifier', 'integration'].includes(session.role))
        )
        .sort((a, b) => (a.paneNumber || 0) - (b.paneNumber || 0));
      const primary = sessions.find((session) => primaryRole(session.role));
      if (!primary) return [];
      const header = { key: `group:${stream.id}`, stream, session: primary, header: true };
      if (expanded instanceof Set && !expanded.has(stream.id)) return [header];
      return [header, ...sessions.map((session) => ({ key: `agent:${session.id}`, stream, session, header: false }))];
    });
  }
  syncSessionPicker(rows) {
    let index = this.sessionPicker.sessionId
      ? rows.findIndex((row) => !row.header && row.session.id === this.sessionPicker.sessionId)
      : rows.findIndex((row) => row.key === this.sessionPicker.selectedKey);
    if (index < 0) index = Math.min(this.sessionPicker.index || 0, Math.max(0, rows.length - 1));
    const selected = rows[index];
    this.sessionPicker.index = Math.max(0, index);
    this.sessionPicker.selectedKey = selected?.key || null;
    this.sessionPicker.sessionId = selected && !selected.header ? selected.session.id : null;
    return this.sessionPicker.index;
  }
  groupPageState(action) {
    let state = this.groupPageStates.get(action);
    if (!state) {
      state = {
        expanded: new Set(this.workspace?.activeWorkstreamId ? [this.workspace.activeWorkstreamId] : []),
        scroll: 0,
        selectedKey: null,
        followSelection: true
      };
      this.groupPageStates.set(action, state);
    }
    return state;
  }
  groupedItems(items) {
    const byWorkstream = new Map();
    for (const item of items) {
      const id = item.workstreamId || 'ungrouped';
      if (!byWorkstream.has(id)) byWorkstream.set(id, []);
      byWorkstream.get(id).push(item);
    }
    const ordered = (this.workspace?.workstreams || [])
      .filter((stream) => byWorkstream.has(stream.id))
      .map((stream) => {
        const planning = (this.workspace.sessions || []).find(
          (session) => session.workstreamId === stream.id && primaryRole(session.role)
        );
        return {
          id: stream.id,
          name: stream.name || fallbackName(planning, stream, this.workspace),
          stream,
          planning,
          items: byWorkstream.get(stream.id)
        };
      });
    if (byWorkstream.has('ungrouped'))
      ordered.push({ id: 'ungrouped', name: 'Earlier sessions', items: byWorkstream.get('ungrouped') });
    return ordered;
  }
  overviewEntries(items, state = this.groupPageState(this.topPage?.action)) {
    return this.groupedItems(items).flatMap((group) => [
      { kind: 'group', key: `group:${group.id}`, group },
      ...(state.expanded.has(group.id)
        ? group.items.map((item) => ({
            kind: 'item',
            key: `item:${item.executionId || item.planId}:${item.id || item.planId}`,
            group,
            item,
            index: items.indexOf(item)
          }))
        : [])
    ]);
  }
  selectedOverviewEntry(items, state = this.groupPageState(this.topPage?.action)) {
    const entries = this.overviewEntries(items, state);
    let selected = entries.find((entry) => entry.key === state.selectedKey);
    if (!selected)
      selected =
        entries.find((entry) => entry.kind === 'item' && entry.group.id === this.workspace?.activeWorkstreamId) ||
        entries.find((entry) => entry.kind === 'item') ||
        entries[0];
    state.selectedKey = selected?.key || null;
    if (selected?.kind === 'item') this.topPage.index = selected.index;
    return selected || null;
  }
  moveOverviewSelection(items, offset) {
    const state = this.groupPageState(this.topPage.action);
    const entries = this.overviewEntries(items, state);
    if (!entries.length) return null;
    const selected = this.selectedOverviewEntry(items, state);
    const index = Math.max(
      0,
      entries.findIndex((entry) => entry.key === selected?.key)
    );
    const next = entries[Math.max(0, Math.min(entries.length - 1, index + offset))];
    state.selectedKey = next.key;
    state.followSelection = true;
    if (next.kind === 'item') this.topPage.index = next.index;
    return next;
  }
  setGroupExpanded(groupId, expanded, items) {
    const state = this.groupPageState(this.topPage.action);
    const selected = this.overviewEntries(items, state).find((entry) => entry.key === state.selectedKey);
    state.followSelection = true;
    if (expanded) state.expanded.add(groupId);
    else {
      state.expanded.delete(groupId);
      if (selected?.kind === 'item' && selected.group.id === groupId) state.selectedKey = `group:${groupId}`;
    }
  }
  planManifest(planId, version) {
    const key = `${planId}:${version}`;
    if (this.viewModel?.manifests?.has(key)) return this.viewModel.manifests.get(key);
    try {
      return this.lineage.readManifest(planId, version);
    } catch {
      return null;
    }
  }
  planExecutionLabel(plan, version = plan.currentVersion) {
    const manifest = this.planManifest(plan.planId, version);
    const sections = manifest
      ? [manifest.summary, manifest.shared, ...(manifest.chunks || []), manifest.globalValidation].filter(Boolean)
      : [];
    const ready = Boolean(
      sections.length && sections.every((section) => manifest.approvals?.[section.id]?.sectionSha === section.sha)
    );
    return executionStateLabel(this.versionExecution(plan.planId, version)?.status, ready);
  }
  planExecutionDescriptor(plan, version = plan.currentVersion) {
    const label = this.planExecutionLabel(plan, version);
    return {
      label,
      tone:
        label === 'Complete'
          ? 'green'
          : label === 'Failed'
            ? 'red'
            : ['Working', 'Verifying', 'Integration'].includes(label)
              ? 'yellow'
              : 'gray'
    };
  }
  overviewLines(plans, items, { bottom = [], controls: controlOverride = null } = {}) {
    const action = plans ? 'Plans' : 'Reviews';
    const state = this.groupPageState(action);
    const groups = this.groupedItems(items);
    const selectedEntry = this.selectedOverviewEntry(items, state);
    const columns = this.dimensions().columns;
    const title = plans ? 'Plans' : 'Ready for review';
    const description = plans
      ? 'Browse durable implementation plans grouped by session.'
      : 'Review worker results, questions, failures, and combined output grouped by session.';
    const lines = [`${COLORS.yellow}${title}${COLORS.reset}`, `${COLORS.gray}${description}${COLORS.reset}`, ''];
    const hits = [];
    for (const group of groups) {
      const expanded = state.expanded.has(group.id);
      const key = `group:${group.id}`;
      const selected = state.selectedKey === key;
      const groupRow = lines.length + 1;
      const header = `${expanded ? '▾' : '▸'} ${group.name}`;
      const count = `${group.items.length} ${plans ? 'plan' : 'review'}${group.items.length === 1 ? '' : 's'}`;
      lines.push(
        `${COLORS.yellow}${COLORS.bold}${selected ? COLORS.inverse : ''}${header}${COLORS.reset}  ${COLORS.gray}${count}${COLORS.reset}`
      );
      hits.push({
        type: 'group-toggle',
        row: groupRow,
        start: 1,
        end: Math.min(columns, width(header)),
        workstreamId: group.id,
        key
      });
      if (!expanded) {
        lines.push('');
        continue;
      }
      const planningName = group.planning ? fallbackName(group.planning, group.stream, this.workspace) : 'Unavailable';
      const updatedAt = group.items
        .map(
          (item) =>
            item.updatedAt ||
            item.planUpdatedAt ||
            this.viewModel?.lineages?.get(item.planId)?.updatedAt ||
            item.createdAt
        )
        .filter(Boolean)
        .sort()
        .at(-1);
      const metadata = [
        `Planning agent: ${planningName}`,
        updatedAt ? `Updated at: ${formatLocalDateTime(updatedAt)}` : null
      ]
        .filter(Boolean)
        .join(' · ');
      lines.push(`${COLORS.gray}  ${metadata}${COLORS.reset}`);
      for (const [itemIndex, item] of group.items.entries()) {
        const itemKey = `item:${item.executionId || item.planId}:${item.id || item.planId}`;
        const itemSelected = state.selectedKey === itemKey;
        const name = plans ? item.name || item.title || 'Untitled plan' : `${item.agentLabel} · ${item.planTitle}`;
        const descriptor = plans ? this.planExecutionDescriptor(item) : stateDescriptor(item);
        const tone =
          descriptor.tone === 'green'
            ? COLORS.green
            : descriptor.tone === 'red'
              ? COLORS.red
              : descriptor.tone === 'yellow'
                ? COLORS.yellow
                : COLORS.gray;
        const connector = itemIndex === group.items.length - 1 ? '└─' : '├─';
        const headingRows = softWrapLine(`  ${connector} ${name}`, columns);
        const itemRow = lines.length + 1;
        for (const [index, row] of headingRows.entries())
          lines.push(
            `${COLORS.bold}${COLORS.white}${itemSelected ? COLORS.inverse : ''}${row}${COLORS.reset}${index === headingRows.length - 1 ? `  ${tone}${descriptor.label}${COLORS.reset}` : ''}`
          );
        const detail = plans
          ? [
              item.repository && item.repository !== '.' ? item.repository : null,
              `Latest v${item.currentVersion}`,
              formatLocalDateTime(item.updatedAt || item.createdAt)
            ]
              .filter(Boolean)
              .join(' · ')
          : [
              item.repository && item.repository !== '.' ? item.repository : null,
              item.summary || `${item.changedPaths?.length || 0} changed paths`
            ]
              .filter(Boolean)
              .join(' · ');
        if (detail)
          lines.push(...softWrapLine(`     ${detail}`, columns).map((row) => `${COLORS.gray}${row}${COLORS.reset}`));
        hits.push({
          type: plans ? 'plan-item' : 'review-item',
          row: itemRow,
          start: 1,
          end: columns,
          planId: item.planId,
          version: item.currentVersion,
          executionId: item.executionId,
          itemId: item.id,
          index: items.indexOf(item),
          key: itemKey,
          workstreamId: group.id
        });
      }
      lines.push('');
    }
    if (!groups.length) lines.push(`${COLORS.gray}No ${plans ? 'plans' : 'reviews'} yet.${COLORS.reset}`);
    const contextual =
      selectedEntry?.kind === 'group'
        ? ' • r rename session'
        : plans && selectedEntry?.kind === 'item'
          ? ' • r rename plan • d delete selected'
          : '';
    const controls =
      controlOverride ||
      `↑/↓ select • ← collapse • → expand • Enter open/toggle${contextual}${plans ? ' • D delete all' : ''} • Esc back`;
    const controlLines = softWrapLine(controls, columns).map((line) => `${COLORS.cyan}${line}${COLORS.reset}`);
    const fixed = lines.slice(0, 3);
    const body = lines.slice(3);
    const available = Math.max(1, this.dimensions().rows - 4 - bottom.length - controlLines.length);
    const maximum = Math.max(0, body.length - available);
    const selectedHit = hits.find((hit) => hit.key === state.selectedKey);
    const selectedRow = selectedHit && selectedHit.row > 3 ? selectedHit.row - 4 : null;
    if (state.followSelection !== false && selectedRow !== null) {
      if (selectedRow < state.scroll) state.scroll = selectedRow;
      else if (selectedRow >= state.scroll + available) state.scroll = selectedRow - available + 1;
    }
    state.scroll = Math.min(Math.max(0, state.scroll), maximum);
    const visible = body.slice(state.scroll, state.scroll + available);
    return [
      ...fixed,
      ...visible,
      ...(maximum
        ? [
            `${COLORS.gray}${state.scroll + 1}–${Math.min(body.length, state.scroll + available)} of ${body.length}${COLORS.reset}`
          ]
        : []),
      ...bottom,
      ...controlLines
    ];
  }
  actionPageLines() {
    if (!this.topPage) return null;
    const plans = this.topPage.action === 'Plans';
    const items = plans ? this.planItems() : this.reviewItems();
    if (this.topPage.detail && plans) {
      const detail = this.topPage.detail;
      const lineage = this.lineage.load(detail.planId);
      const version = Math.min(detail.version, lineage.currentVersion);
      const manifest = this.lineage.readManifest(lineage.planId, version);
      const sections = [manifest.summary, manifest.shared, ...manifest.chunks, manifest.globalValidation].filter(
        Boolean
      );
      const selected = Math.min(detail.sectionIndex || 0, sections.length - 1);
      const section = sections[selected];
      const approved = manifest.approvals[section.id]?.sectionSha === section.sha;
      const approvedCount = sections.filter((item) => manifest.approvals[item.id]?.sectionSha === item.sha).length;
      const latest = version === lineage.currentVersion;
      const versionLabel = latest
        ? lineage.currentVersion === 1
          ? 'Latest'
          : `v${version} of ${lineage.currentVersion} · Latest`
        : `Older version — v${lineage.currentVersion} is latest`;
      const execution = this.versionExecution(lineage.planId, version);
      const columns = this.dimensions().columns;
      let content = [];
      if (detail.reader) content = this.lineage.readSection(lineage.planId, version, section.id).trimEnd().split('\n');
      else if (detail.diff && version > 1) {
        const before = fs.readFileSync(
          path.join(this.lineage.versionDirectory(lineage.planId, version - 1), 'consolidated.md'),
          'utf8'
        );
        const after = fs.readFileSync(
          path.join(this.lineage.versionDirectory(lineage.planId, version), 'consolidated.md'),
          'utf8'
        );
        content = diffViewLines(require('../core/plans').diffLines(before, after), columns);
      } else
        content = sections.map((item, index) => {
          const status =
            manifest.approvals[item.id]?.sectionSha === item.sha
              ? `${COLORS.green}Approved${COLORS.reset}`
              : 'Needs approval';
          const kind =
            item.id === 'summary'
              ? 'Summary'
              : item.id === 'shared'
                ? 'Shared decisions'
                : item.id === 'global-validation'
                  ? 'Global validation'
                  : `Worker chunk · ${item.title || item.taskSnippet || item.id}`;
          return `${index === selected ? '›' : ' '} ${kind} · ${status}`;
        });
      if (!detail.diff) content = softWrap(content, columns);
      const scrollable = detail.reader || detail.diff;
      const bodyRows = Math.max(1, this.dimensions().rows - 10);
      const maxScroll = Math.max(0, content.length - bodyRows);
      detail.scroll = Math.min(detail.scroll || 0, maxScroll);
      const visible = content.slice(detail.scroll, detail.scroll + bodyRows);
      const contextual = approved ? 'a remove approval' : 'a approve';
      let actions = detail.reader
        ? `↑/↓ scroll  •  ${contextual}`
        : detail.diff
          ? `↑/↓ scroll  •  ←/→ version  •  d close diff`
          : `↑/↓ select  •  ←/→ version  •  Enter read  •  ${contextual}`;
      if (!detail.reader && !detail.diff) {
        if (version > 1) actions += `  •  d diff v${version - 1} → v${version}`;
        if (!execution && approvedCount === sections.length) actions += `  •  e execute v${version}`;
      }
      const stream = this.workspace.workstreams.find(
        (item) => item.id === (manifest.workstreamId || lineage.workstreamId)
      );
      const profile = execution?.profile || stream?.workerProfile;
      const worker = profile
        ? `${display(profile.provider)}${profile.model ? ` ${profile.model}` : ''}${profile.effort ? ` · ${profile.effort} effort` : ''}`
        : 'Unavailable';
      const executionLabel = executionStateLabel(execution?.status, approvedCount === sections.length);
      const approvalStatus = approved
        ? `${COLORS.green}Approved${COLORS.reset}`
        : `${COLORS.gray}Needs approval${COLORS.reset}`;
      const summary = detail.reader
        ? `${COLORS.gray}${versionLabel} · ${selected + 1} of ${sections.length} approval sections · ${COLORS.reset}${approvalStatus}`
        : `${COLORS.gray}${versionLabel} · Worker: ${worker} · Execution: ${executionLabel}${COLORS.reset}`;
      const header = [
        `${COLORS.yellow}${lineage.name || manifest.title} · v${version} of ${lineage.currentVersion}${COLORS.reset}`,
        summary,
        ''
      ];
      if (detail.diff) header.push(`${COLORS.white}Diff v${version - 1} → v${version}${COLORS.reset}`, '');
      if (detail.confirmExecute)
        return [
          ...header,
          `${COLORS.red}Execute v${version} even though v${lineage.currentVersion} is newer?${COLORS.reset}`,
          `${COLORS.cyan}Enter confirms • Esc cancels${COLORS.reset}`
        ];
      const actionLines = softWrapLine(`${actions}  •  Esc back`, columns).map(
        (line) => `${COLORS.cyan}${line}${COLORS.reset}`
      );
      const tipLines =
        detail.reader || detail.diff
          ? []
          : softWrapLine('Tip: Approve all sections to execute the plan', columns).map(
              (line) => `${COLORS.gray}${line}${COLORS.reset}`
            );
      return [
        ...header,
        ...visible,
        scrollable && maxScroll
          ? `${COLORS.gray}${detail.scroll + 1}–${Math.min(content.length, detail.scroll + bodyRows)} of ${content.length}${COLORS.reset}`
          : '',
        '',
        ...actionLines,
        ...tipLines
      ];
    }
    if (this.topPage.detail && !plans) {
      const detail = this.topPage.detail;
      const item = this.reviewDetailItem(
        items.find((candidate) => candidate.executionId === detail.executionId && candidate.id === detail.id)
      );
      if (!item) return ['No review item is available.'];
      const columns = this.dimensions().columns;
      this.reviewView.update(item);
      const requestedScroll = this.reviewView.state().scroll;
      const descriptor = stateDescriptor(item);
      const header = [
        ...softWrapLine(`${item.agentLabel} · ${item.planTitle}`, columns).map(
          (line) => `${COLORS.yellow}${line}${COLORS.reset}`
        ),
        `${descriptor.tone === 'red' ? COLORS.red : descriptor.tone === 'green' ? COLORS.green : COLORS.gray}${descriptor.label}${COLORS.reset}`,
        ''
      ];
      let controls;
      const confirmation = this.reviewView.state().confirmation;
      if (this.topPage.feedback) {
        const label = this.topPage.feedback.kind === 'remedy' ? 'Repair guidance' : 'Feedback';
        controls = [
          '',
          ...softWrapLine(`${label}: ${this.topPage.feedback.value}`, columns).map(
            (line) => `${COLORS.yellow}${line}${COLORS.reset}`
          ),
          ...(this.topPage.feedback.error
            ? softWrapLine(`! ${this.topPage.feedback.error}`, columns).map(
                (line) => `${COLORS.red}${line}${COLORS.reset}`
              )
            : []),
          `${COLORS.cyan}Enter ${this.topPage.feedback.error ? 'retry' : 'send'} • Esc cancel${COLORS.reset}`
        ];
      } else if (confirmation) {
        const prompt =
          confirmation === 'integrate'
            ? 'Integrate this verified result into the frozen target?'
            : confirmation === 'override'
              ? 'Override failed global verification and integrate anyway?'
              : 'Return the accepted verifier findings to the affected original workers?';
        const choice = this.reviewView.state().confirmationChoice;
        const consequence =
          confirmation === 'integrate'
            ? 'Creates the approved plan commit and advances the frozen target when safe.'
            : confirmation === 'override'
              ? 'Skips failed verification evidence and may integrate a broken result.'
              : 'Creates isolated repair worktrees, requires renewed Review acceptance, then reruns checks and verification.';
        controls = [
          '',
          `${COLORS.white}${COLORS.bold}${item.planTitle}${COLORS.reset}`,
          ...softWrapLine(item.summary || 'No result summary was recorded.', columns).map(
            (line) => `${COLORS.gray}${line}${COLORS.reset}`
          ),
          `${confirmation === 'remedy' ? COLORS.yellow : COLORS.red}${prompt}${COLORS.reset}`,
          ...softWrapLine(consequence, columns).map((line) => `${COLORS.gray}${line}${COLORS.reset}`),
          `${choice === 'confirm' ? COLORS.inverse : ''} Confirm ${COLORS.reset}  ${choice === 'cancel' ? COLORS.inverse : ''} Cancel ${COLORS.reset}`,
          `${COLORS.cyan}←/→ choose • Enter select • Esc cancel${COLORS.reset}`
        ];
      } else {
        const selectionCount = this.reviewView.selections().length;
        const actions = descriptor.actions.map((action) =>
          action === 'accept'
            ? 'a accept'
            : action === 'feedback'
              ? item.kind === 'final'
                ? 'f suggest repair'
                : 'f feedback'
              : action === 'integrate'
                ? 'i integrate'
                : action === 'override'
                  ? 'o override'
                  : action === 'remedy'
                    ? 'r accept remedies'
                    : action
        );
        const navigation = [
          '↑/↓ scroll',
          'drag diff to add excerpts',
          ...(selectionCount ? [`${selectionCount} selected`, 'u undo', 'x clear'] : []),
          'Esc back'
        ];
        controls = actions.length
          ? [
              '',
              ...packControlLabels(actions, columns).map((line) => `${COLORS.cyan}${line}${COLORS.reset}`),
              ...packControlLabels(navigation, columns).map((line) => `${COLORS.cyan}${line}${COLORS.reset}`)
            ]
          : [
              '',
              `${COLORS.cyan}${descriptor.label} • Esc back${COLORS.reset}`,
              ...navigation.slice(0, -1).map((line) => `${COLORS.cyan}${line}${COLORS.reset}`)
            ];
      }
      const availableRows = Math.max(0, this.dimensions().rows - header.length - controls.length);
      let bodyRows = availableRows;
      let position = false;
      if (bodyRows > 0) {
        this.reviewView.resize(columns, bodyRows);
        if (this.reviewView.maximumScroll() > 0 && bodyRows > 1) {
          bodyRows -= 1;
          position = true;
          this.reviewView.resize(columns, bodyRows);
        }
      } else this.reviewView.resize(columns, 1);
      this.reviewView.scrollTo(requestedScroll);
      const frame =
        bodyRows > 0
          ? this.reviewView.render(this.contentGeometry(header.length))
          : { lines: [], offset: this.reviewView.scrollTo(0), maxScroll: this.reviewView.maximumScroll() };
      detail.scroll = frame.offset;
      const bodyLength = this.reviewView.bodyRows().length;
      return [
        ...header,
        ...frame.lines,
        ...(position
          ? [
              `${COLORS.gray}${frame.offset + 1}–${Math.min(bodyLength, frame.offset + bodyRows)} of ${bodyLength}${COLORS.reset}`
            ]
          : []),
        ...controls
      ];
    }
    const bottom = [];
    let controls = null;
    if (this.topPage.rename) {
      const label = this.topPage.rename.kind === 'plan' ? 'Rename plan' : 'Rename session';
      bottom.push(
        `${COLORS.yellow}${label}: ${this.topPage.rename.value}${COLORS.bgCyan}${COLORS.black} ${COLORS.reset}`,
        ...(this.topPage.rename.error ? [`${COLORS.red}! ${this.topPage.rename.error}${COLORS.reset}`] : [])
      );
      controls = 'Enter save • Esc cancel';
    } else if (plans && this.topPage.deleteConfirmation) {
      const deletion = this.topPage.deleteConfirmation;
      bottom.push(
        `${COLORS.red}${COLORS.bold}Delete ${deletion.count} plan${deletion.count === 1 ? '' : 's'} permanently?${COLORS.reset}`,
        `${COLORS.red}Only BDFL plan lineage and versions are removed; sessions, Git history, worktrees, and provider transcripts remain.${COLORS.reset}`
      );
      controls = 'Enter confirms • Esc cancels';
    } else if (plans && this.topPage.deleteError)
      bottom.push(`${COLORS.red}! ${this.topPage.deleteError}${COLORS.reset}`);
    return this.overviewLines(plans, items, { bottom, controls });
  }
  sessionPickerLines() {
    this.contentHits ||= [];
    const rows = this.sessionPickerRows();
    this.syncSessionPicker(rows);
    const streams = this.sessionPickerItems();
    const lines = [
      `${COLORS.yellow}Your sessions${COLORS.reset}`,
      `${COLORS.gray}Browse saved agents. Opening a paused agent resumes its existing provider conversation.${COLORS.reset}`,
      ''
    ];
    for (const stream of streams) {
      const group = rows.filter((row) => row.stream.id === stream.id);
      const planning = group.find((row) => row.header);
      if (!planning) continue;
      const selected = group.find((row) => row.key === this.sessionPicker.selectedKey);
      const planningSelected = selected?.header;
      const expanded = this.sessionPicker.expanded.has(stream.id);
      const planningName = stream.name || fallbackName(planning.session, stream, this.workspace);
      const primary = planning.session;
      const liveStatus =
        primary.status === 'bridge-reconnecting'
          ? `${COLORS.yellow}Bridge reconnecting${COLORS.reset}`
          : primary.status === 'bridge-error'
            ? `${COLORS.red}Bridge error${COLORS.reset}`
            : primary.status === 'running'
              ? primary.turnState === 'idle'
                ? `${COLORS.gray}Idle${COLORS.reset}`
                : `${COLORS.yellow}Working${COLORS.reset}`
              : resumableSession(primary) || primary.explicitlyClosed
                ? `${COLORS.yellow}Paused${COLORS.reset}`
                : primary.status === 'closed'
                  ? `${COLORS.yellow}Ready to start${COLORS.reset}`
                  : `${COLORS.gray}Saved${COLORS.reset}`;
      const groupStatus = stream.status === 'closed' ? `${COLORS.yellow}Paused${COLORS.reset}` : liveStatus;
      const created = formatLocalDateTime(stream.createdAt);
      const location =
        stream.repository && stream.repository !== '.'
          ? stream.repository
          : stream.title || path.basename(stream.repositoryRoot || this.root);
      const summary = [location, created ? `Created at: ${created}` : ''].filter(Boolean).join(' · ');
      const headerRow = lines.length + 1;
      const marker = expanded ? '▾' : '▸';
      const header = `${marker} ${planningName}`;
      lines.push(
        `${COLORS.yellow}${COLORS.bold}${planningSelected ? COLORS.inverse : ''}${header}${COLORS.reset}  ${groupStatus}`,
        `${COLORS.gray}  ${summary}${COLORS.reset}`
      );
      this.contentHits.push({
        type: 'session-row',
        row: headerRow,
        start: 1,
        end: Math.max(1, width(header)),
        key: planning.key,
        sessionId: null,
        workstreamId: stream.id,
        index: rows.indexOf(planning),
        header: true
      });
      if (expanded)
        for (const [index, session] of this.workspace.sessions
          .filter(
            (item) =>
              item.workstreamId === stream.id &&
              (primaryRole(item.role) || ['worker', 'verifier', 'integration'].includes(item.role))
          )
          .sort((a, b) => (a.paneNumber || 0) - (b.paneNumber || 0))
          .entries()) {
          const row = rows.find((item) => !item.header && item.session.id === session.id);
          const childSelected = row?.key === this.sessionPicker.selectedKey;
          const childSessions = this.workspace.sessions.filter(
            (item) =>
              item.workstreamId === stream.id &&
              (primaryRole(item.role) || ['worker', 'verifier', 'integration'].includes(item.role))
          );
          const connector = index === childSessions.length - 1 ? '└─' : '├─';
          const provider = display(
            session.profile?.provider || stream.delegatorProfile?.provider || stream.directProfile?.provider || 'agent'
          );
          const status =
            session.status === 'running'
              ? session.turnState === 'idle'
                ? `${COLORS.gray}Idle${COLORS.reset}`
                : `${COLORS.yellow}Working${COLORS.reset}`
              : session.status === 'bridge-reconnecting'
                ? `${COLORS.yellow}Bridge reconnecting${COLORS.reset}`
                : session.status === 'bridge-error'
                  ? `${COLORS.red}Bridge error${COLORS.reset}`
                  : resumableSession(session) || session.explicitlyClosed
                    ? `${COLORS.yellow}Paused${COLORS.reset}`
                    : session.status === 'closed'
                      ? `${COLORS.yellow}Ready to start${COLORS.reset}`
                      : `${COLORS.gray}Saved${COLORS.reset}`;
          const name = primaryRole(session.role)
            ? session.role === 'direct'
              ? 'Direct agent'
              : 'Planning agent'
            : fallbackName(session, stream, this.workspace);
          const body = `${COLORS.bold}${COLORS.white}${name}${COLORS.reset} ${COLORS.gray}· ${provider}${COLORS.reset}  ${status}`;
          const childRow = lines.length + 1;
          lines.push(
            `${COLORS.gray}  ${connector}${COLORS.reset} ${childSelected ? `${COLORS.inverse} ${body} ${COLORS.reset}` : body}`
          );
          if (row)
            this.contentHits.push({
              type: 'session-row',
              row: childRow,
              start: 3,
              end: Math.max(3, Math.min(this.dimensions().columns, width(lines.at(-1)))),
              key: row.key,
              sessionId: session.id,
              workstreamId: stream.id,
              index: rows.indexOf(row),
              header: false
            });
        }
      lines.push('');
    }
    const selectedRowData = rows[this.sessionPicker.index];
    let bottom = [];
    let controls;
    if (this.sessionPicker.edit) {
      bottom = [
        `${COLORS.yellow}Rename session: ${this.sessionPicker.edit.value}${COLORS.bgCyan}${COLORS.black} ${COLORS.reset}`,
        ...(this.sessionPicker.edit.error ? [`${COLORS.red}! ${this.sessionPicker.edit.error}${COLORS.reset}`] : [])
      ];
      controls = 'Enter save • Esc cancel';
    } else if (this.sessionPicker.confirmDelete) {
      const deletion = this.sessionPicker.confirmDelete;
      const subject =
        deletion.scope === 'all'
          ? `all ${deletion.count} session${deletion.count === 1 ? '' : 's'} and ${deletion.agentCount} agent${deletion.agentCount === 1 ? '' : 's'}`
          : `session “${deletion.name}” and its ${deletion.agentCount} agent${deletion.agentCount === 1 ? '' : 's'}`;
      bottom = [
        `${COLORS.red}${COLORS.bold}Delete ${subject} permanently?${COLORS.reset}`,
        `${COLORS.red}Plans, executions, Git history, and provider transcripts outside BDFL runtime state remain.${COLORS.reset}`
      ];
      controls = 'Enter confirms • Esc cancels';
    } else {
      if (this.sessionPicker.deleteError) bottom = [`${COLORS.red}! ${this.sessionPicker.deleteError}${COLORS.reset}`];
      controls = `↑/↓ select • ← collapse • → expand • Enter open/toggle${selectedRowData?.header ? ' • r rename session • d delete session' : ''}${streams.length ? ' • D delete all sessions' : ''} • Esc back`;
    }
    const controlLines = softWrapLine(controls, this.dimensions().columns).map(
      (line) => `${COLORS.cyan}${line}${COLORS.reset}`
    );
    const body = lines.slice(3);
    const available = Math.max(1, this.dimensions().rows - 4 - bottom.length - controlLines.length);
    const maximum = Math.max(0, body.length - available);
    const selectedHit = this.contentHits.find(
      (hit) => hit.type === 'session-row' && hit.key === this.sessionPicker.selectedKey
    );
    const selectedRow = selectedHit ? selectedHit.row - 4 : null;
    if (this.sessionPicker.followSelection !== false && selectedRow !== null) {
      if (selectedRow < (this.sessionPicker.scroll || 0)) this.sessionPicker.scroll = selectedRow;
      else if (selectedRow >= (this.sessionPicker.scroll || 0) + available)
        this.sessionPicker.scroll = selectedRow - available + 1;
    }
    this.sessionPicker.scroll = Math.min(Math.max(0, this.sessionPicker.scroll || 0), maximum);
    const start = this.sessionPicker.scroll;
    const end = start + available;
    const visibleHits = this.contentHits
      .filter((hit) => hit.row <= 3 || (hit.row - 4 >= start && hit.row - 4 < end))
      .map((hit) => (hit.row <= 3 ? hit : { ...hit, row: hit.row - start }));
    this.contentHits.splice(0, this.contentHits.length, ...visibleHits);
    return [
      ...lines.slice(0, 3),
      ...body.slice(start, end),
      ...(maximum ? [`${COLORS.gray}${start + 1}–${Math.min(body.length, end)} of ${body.length}${COLORS.reset}`] : []),
      ...bottom,
      ...controlLines
    ];
  }
  selectedSession() {
    return this.navigation?.currentAgent()?.session || null;
  }
  focusedSessionId() {
    if (this.navigation?.rail !== 'content' || this.wizard || this.sessionPicker || this.topPage) return null;
    return this.navigation.sessionId || null;
  }
  visibleSessionId() {
    if (!this.navigation || this.error || this.wizard || this.sessionPicker || this.topPage) return null;
    return this.navigation.sessionId || null;
  }
  raiseAttention(sessionId) {
    const session = this.store.load().sessions.find((item) => item.id === sessionId);
    if (session?.role === 'direct') this.markTurn(sessionId, 'idle', 'provider completed');
    if (this.focusedSessionId() === sessionId) {
      this.scheduleDraw();
      return false;
    }
    this.store.setSessionAttention?.(sessionId, true);
    this.scheduleDraw();
    return true;
  }
  clearFocusedAttention() {
    const sessionId = this.focusedSessionId();
    if (sessionId) {
      this.store.setSessionAttention?.(sessionId, false);
      this.sessions.acknowledgeAttention?.(sessionId);
    }
    return sessionId;
  }
  focusAgent(sessionId, { draw = true } = {}) {
    this.workspace = this.decorateWorkspace(this.store.load());
    this.navigation ||= new Navigation(this.workspace);
    this.navigation.sync(this.workspace);
    const agents = this.navigation.agents();
    const selected = agents.find(({ session }) => session.id === sessionId);
    if (!selected) {
      if (draw) this.draw();
      return false;
    }
    try {
      this.store.activateWorkstream?.(selected.stream.id);
      this.error = null;
      this.wizard = null;
      this.sessionPicker = null;
      this.topPage = null;
      this.workspace = this.decorateWorkspace(this.store.load());
      this.navigation.sync(this.workspace);
      this.navigation.selectSession(selected.session.id);
      this.navigation.activeAction = null;
      this.navigation.rail = 'content';
      this.lastFocused.set(selected.stream.id, selected.session.id);
      if (this.sessions.focus) this.sessions.focus(selected.session.id);
      else this.store.markSessionViewed?.(selected.session.id);
      this.store.setSessionAttention?.(selected.session.id, false);
      this.sessions.acknowledgeAttention?.(selected.session.id);
    } catch (error) {
      this.error = error;
    }
    if (draw) this.draw();
    return !this.error;
  }
  openAgent(sessionId, { draw = true } = {}) {
    if (!this.focusAgent(sessionId, { draw: false })) {
      if (draw) this.draw();
      return false;
    }
    const session = this.selectedSession();
    if (startableSession(session) && !this.sessionIsOpen(session)) this.startFocusedSession(session);
    if (draw) this.draw();
    return !this.error;
  }
  sessionIsOpen(session) {
    return this.sessions.isOpen?.(session.id) ?? Boolean(!session.explicitlyClosed && session.status === 'running');
  }
  startFocusedSession(session) {
    const resumable = resumableSession(session);
    if (!startableSession(session) || this.sessionIsOpen(session)) return false;
    try {
      if (resumable) {
        if (this.sessions.resume) this.sessions.resume(session.id, this.dimensions());
        else this.sessions.open(session.id, this.dimensions());
      } else this.sessions.open(session.id, this.dimensions());
      this.error = null;
      this.workspace = this.decorateWorkspace(this.store.load());
      this.navigation.sync(this.workspace);
      this.navigation.selectSession(session.id);
      this.clearFocusedAttention();
      return true;
    } catch (error) {
      this.error = codedError('SESSION_RESTORE_FAILED', error.message);
      return false;
    }
  }
  focusParent(workstreamId) {
    const workspace = this.decorateWorkspace(this.store.load());
    const stream = workspace.workstreams.find((item) => item.id === workstreamId);
    if (!stream) return this.draw();
    const selected = agentSessions(workspace, stream).find((session) => primaryRole(session.role));
    this.navigation.workstreamId = workstreamId;
    if (selected) return this.focusAgent(selected.id);
    return this.activate('Sessions');
  }
  exitNative() {
    const wasWizard = Boolean(this.wizard);
    const previous = wasWizard ? this.previousSurface : null;
    const sessionId = previous?.sessionId || this.navigation?.sessionId;
    this.wizard = null;
    this.sessionPicker = null;
    this.topPage = null;
    this.navigation.activeAction = null;
    this.navigation.rail = 'content';
    this.previousSurface = null;
    if (previous?.action && previous.action !== 'New') return this.activate(previous.action);
    if (sessionId && this.navigation.agents().some(({ session }) => session.id === sessionId))
      return this.focusAgent(sessionId);
    if (wasWizard && (this.workspace?.sessions || []).length) return this.activate('Sessions');
    return this.draw();
  }
  openLink(url) {
    try {
      Promise.resolve(this.linkOpener(url)).catch((error) => {
        this.error = codedError('OPEN_EXTERNAL_FAILED', error.message);
        this.scheduleDraw();
      });
    } catch (error) {
      this.error = codedError('OPEN_EXTERNAL_FAILED', error.message);
      this.scheduleDraw();
    }
  }
  activePlanExecutions(planIds) {
    const affected = new Set(planIds);
    return (this.scheduler.list?.() || []).filter(
      (execution) => affected.has(execution.planId) && !['complete', 'cancelled'].includes(execution.status)
    );
  }
  deletePlans(deletion) {
    const blockers = this.activePlanExecutions(deletion.planIds);
    if (blockers.length) {
      const count = blockers.length;
      throw new Error(`Cannot delete: ${count} affected execution${count === 1 ? ' is' : 's are'} still active.`);
    }
    return deletion.scope === 'all' ? this.lineage.deleteAll() : this.lineage.delete(deletion.planIds[0]);
  }
  deleteSessions(deletion) {
    const workspace = this.store.load();
    const sessions =
      deletion.scope === 'all'
        ? workspace.sessions
        : workspace.sessions.filter((session) => session.workstreamId === deletion.workstreamId);
    for (const session of sessions) this.sessions.delete?.(session.id);
    return deletion.scope === 'all'
      ? this.store.deleteAllWorkstreams()
      : this.store.deleteWorkstream(deletion.workstreamId);
  }
  scheduleDraw() {
    if (!this.running || this.redrawScheduled) return;
    this.redrawScheduled = true;
    setImmediate(() => {
      this.redrawScheduled = false;
      if (this.running) this.draw();
    });
  }
  scheduleOutputDraw(sessionId) {
    if (!this.running || this.visibleSessionId() !== sessionId || this.outputDrawTimer !== undefined) return;
    this.outputDrawTimer = this.scheduleTimeout(() => {
      this.outputDrawTimer = undefined;
      if (this.running && this.visibleSessionId() === sessionId) this.draw();
    }, 50);
    this.outputDrawTimer?.unref?.();
  }
  drawScroll() {
    return false;
  }
  pageName() {
    if (this.wizard) return 'New';
    if (this.sessionPicker) return 'Sessions';
    if (this.topPage) return this.topPage.action;
    if (NATIVE_PAGES.has(this.navigation?.activeAction)) return this.navigation.activeAction;
    return null;
  }
  titleName() {
    const page = this.pageName();
    if (page) return page;
    const current = this.navigation?.currentAgent();
    if (!current) return null;
    const primary = this.workspace.sessions.find(
      (session) => session.workstreamId === current.stream.id && primaryRole(session.role)
    );
    return current.stream.name || fallbackName(primary || current.session, current.stream, this.workspace);
  }
  footerPresentation() {
    if (this.quitPending) return { message: QUIT_MESSAGE, tone: 'red' };
    const page = this.pageName();
    const session = !page && this.selectedSession();
    if (startableSession(session) && !this.sessionIsOpen(session))
      return { message: 'Press Enter to start this agent with its saved history' };
    const index = page === 'Plans' ? 1 : page === 'Sessions' ? 2 : page === 'Reviews' ? 3 : page === 'New' ? 4 : 0;
    return { message: FOOTER_MESSAGES[index], tone: 'gray' };
  }
  runningSessionIds() {
    return new Set(
      (this.workspace?.sessions || [])
        .filter((session) => this.sessions.isSessionActive?.(session.id) || this.sessions.isActive?.(session.id))
        .map((session) => session.id)
    );
  }
  draw() {
    this.viewModel = this.buildViewModel();
    this.workspace = this.viewModel.workspace;
    this.navigation ||= new Navigation(this.workspace);
    this.navigation.sync(this.workspace);
    this.contentHits = [];
    const session = this.selectedSession();
    const providerFocused = this.navigation.rail === 'content' && !this.navigation.activeAction;
    const picker = this.sessionPicker ? this.sessionPickerLines() : null;
    let presentation = null;
    if (session && !this.error && !this.wizard && !picker && !this.topPage)
      presentation = this.sessions.presentation?.(session.id, this.dimensions().rows, { cursor: providerFocused }) || {
        lines: this.sessions.screen?.(session.id, this.dimensions().rows, { cursor: providerFocused }) || [],
        cursor: null
      };
    const spacedPage = this.wizard || picker || (this.topPage && !this.topPage.detail);
    const pageContent = this.error
      ? errorPageLines(this.error)
      : this.wizard
        ? this.wizard.render().split('\n')
        : picker || this.actionPageLines() || presentation?.lines || emptyStateLines();
    const content = spacedPage ? ['', ...pageContent] : pageContent;
    const footer = this.footerPresentation();
    const titleName = this.titleName();
    const rendered = this.renderer.render(this.workspace, this.navigation, {
      columns: this.output.columns || 100,
      rows: this.output.rows || 28,
      content,
      footerMessage: footer.message,
      footerTone: footer.tone,
      isRunning: (id) => this.runningSessionIds().has(id),
      isOpen: (id) => this.sessionIsOpen(this.workspace.sessions.find((item) => item.id === id)),
      title: titleName
    });
    const lines = rendered.split('\n');
    const title = terminalTitle(titleName, hasOpenAttention(this.workspace));
    const output = [];
    if (!this.lastFrameLines || this.lastFrameLines.length !== lines.length) output.push(title, `${ESC}H`, rendered);
    else {
      if (title !== this.lastTerminalTitle) output.push(title);
      for (let index = 0; index < lines.length; index += 1)
        if (lines[index] !== this.lastFrameLines[index]) output.push(`${ESC}${index + 1};1H${lines[index]}`);
    }
    if (presentation?.cursor)
      output.push(`${ESC}?25h${ESC}${presentation.cursor.row + 2};${presentation.cursor.column + 3}H`);
    else output.push(`${ESC}?25l`);
    this.lastFrameLines = lines;
    this.lastTerminalTitle = title;
    if (output.length) this.output.write(output.join(''));
  }
  start() {
    this.acquire();
    this.bridge.start?.();
    if (this.bridge.error) throw codedError('BRIDGE_START_FAILED', this.bridge.error.message);
    this.running = true;
    this.scheduler.resume?.();
    const preRestoreErrors = this.reconcileManagedSessions();
    this.workspace = this.decorateWorkspace(this.store.load());
    const openWorkstreams = new Set(
      this.workspace.workstreams.filter((stream) => stream.status !== 'closed').map((stream) => stream.id)
    );
    const hasOpenSession = this.workspace.workstreams.some(
      (stream) =>
        openWorkstreams.has(stream.id) &&
        agentSessions(this.workspace, stream).some((session) => !pausedSession(session) && !terminalSession(session))
    );
    if (!hasOpenSession) {
      this.navigation = new Navigation(this.workspace);
      this.navigation.rail = 'content';
      if (this.workspace.sessions.length) {
        this.sessionExpanded ||= new Set(this.workspace.activeWorkstreamId ? [this.workspace.activeWorkstreamId] : []);
        const rows = this.sessionPickerRows(this.workspace, this.sessionExpanded);
        const selected =
          rows.find((row) => row.header && row.stream.id === this.workspace.activeWorkstreamId) || rows[0];
        this.sessionPicker = {
          index: Math.max(0, rows.indexOf(selected)),
          selectedKey: selected?.key || null,
          sessionId: selected && !selected.header ? selected.session.id : null,
          expanded: this.sessionExpanded
        };
        this.navigation.activeAction = 'Sessions';
      } else {
        this.wizard = this.createWizard();
        this.navigation.activeAction = 'New';
      }
    } else {
      this.navigation ||= new Navigation(this.workspace);
      this.navigation.rail = 'content';
    }
    this.output.write(`${ESC}?1049h${ESC}?25l${ESC}?1000h${ESC}?1006h`);
    this.input.setRawMode?.(true);
    this.input.resume?.();
    let restoreErrors = [];
    if (!this.wizard && this.sessions.restore) {
      const restored = this.sessions.restore(this.dimensions());
      restoreErrors = restored?.errors || [];
      if (!restoreErrors.length) {
        const focused = this.clearFocusedAttention();
        if (focused) {
          this.lastFocused.set(this.navigation.workstreamId, focused);
          if (this.sessions.focus) this.sessions.focus(focused);
          else this.store.markSessionViewed?.(focused);
        }
      }
    }
    const managedErrors = [...preRestoreErrors];
    try {
      this.integration.resumeIntegrationQueue?.();
      managedErrors.push(...this.reconcileManagedSessions());
    } catch (error) {
      managedErrors.push({ executionId: 'integration-queue', error });
    }
    managedErrors.push(...this.recoverIncompleteVerifications(), ...this.recoverIncompleteIntegrations());
    if (restoreErrors.length || managedErrors.length)
      this.error = codedError(
        'SESSION_RESTORE_FAILED',
        [
          ...restoreErrors.map(({ sessionId, error }) => `${sessionId}: ${error.message}`),
          ...managedErrors.map(({ executionId, error }) => `${executionId}: ${error.message}`)
        ].join(' · ')
      );
    const handle = (value) => {
      if (value === '\u0003') {
        if (this.quitPending) {
          this.stop();
          return false;
        }
        this.quitPending = true;
        this.quitTimer = this.scheduleTimeout(() => {
          this.quitTimer = undefined;
          if (!this.running || !this.quitPending) return;
          this.quitPending = false;
          this.draw();
        }, QUIT_CONFIRMATION_TIMEOUT);
        this.quitTimer?.unref?.();
        return this.draw();
      }
      const shortcutLocked = Boolean(
        this.sessionPicker?.edit ||
        this.sessionPicker?.confirmDelete ||
        this.topPage?.rename ||
        this.topPage?.feedback ||
        this.topPage?.deleteConfirmation ||
        this.topPage?.detail?.confirmExecute
      );
      const mouse = mouseEvent(value);
      if (mouse) {
        if (isShiftedMouse(mouse)) return;
        const sessionId = this.focusedSessionId();
        const columns = this.output.columns || 100;
        const rows = this.output.rows || 28;
        const layout =
          this.renderer.lastLayout || this.renderer.layout(this.workspace, this.navigation, { columns, rows });
        const chromeHit = hitAt(layout, mouse.row, mouse.column);
        const contentHit = this.sessionPicker
          ? this.contentHits.find(
              (item) => mouse.row === item.row + 2 && mouse.column >= item.start + 2 && mouse.column <= item.end + 2
            )
          : null;
        const hit = chromeHit || contentHit;
        if (!shortcutLocked && isPrimaryClick(mouse) && hit) {
          if (hit.type === 'action') return this.activate(hit.action);
          if (hit.type === 'child') return this.focusAgent(hit.sessionId);
          if (hit.type === 'link') {
            this.openLink(hit.url);
            return;
          }
          if (hit.type === 'session-row' && this.sessionPicker) {
            this.sessionPicker.index = hit.index;
            this.sessionPicker.selectedKey = hit.key;
            this.sessionPicker.sessionId = hit.sessionId;
            this.sessionPicker.followSelection = true;
            if (hit.header) {
              if (this.sessionPicker.expanded.has(hit.workstreamId))
                this.sessionPicker.expanded.delete(hit.workstreamId);
              else this.sessionPicker.expanded.add(hit.workstreamId);
              return this.draw();
            }
            const stream = this.workspace.workstreams.find((item) => item.id === hit.workstreamId);
            if (stream?.status === 'closed') this.store.reopenWorkstream(hit.workstreamId);
            return this.openAgent(hit.sessionId);
          }
        }
        if (
          !shortcutLocked &&
          !chromeHit &&
          this.topPage?.action === 'Reviews' &&
          this.topPage.detail &&
          !isVerticalWheel(mouse) &&
          this.reviewView.handleMouse(mouse)
        )
          return this.draw();
        if (!shortcutLocked && this.topPage?.action === 'Reviews' && this.topPage.detail && isVerticalWheel(mouse)) {
          this.reviewView.scroll((mouse.button & 1) === 0 ? -3 : 3);
          return this.draw();
        }
        if (isVerticalWheel(mouse) && this.sessionPicker) {
          this.sessionPicker.followSelection = false;
          this.sessionPicker.scroll = Math.max(
            0,
            (this.sessionPicker.scroll || 0) + ((mouse.button & 1) === 0 ? -3 : 3)
          );
          return this.draw();
        }
        if (isVerticalWheel(mouse) && this.topPage && !this.topPage.detail) {
          const state = this.groupPageState(this.topPage.action);
          state.followSelection = false;
          state.scroll = Math.max(0, state.scroll + ((mouse.button & 1) === 0 ? -3 : 3));
          return this.draw();
        }
        if (
          isVerticalWheel(mouse) &&
          this.topPage?.detail &&
          (this.topPage.detail.reader || this.topPage.detail.diff)
        ) {
          this.topPage.detail.scroll = Math.max(
            0,
            (this.topPage.detail.scroll || 0) + ((mouse.button & 1) === 0 ? -3 : 3)
          );
          this.draw();
        } else if (
          sessionId &&
          isVerticalWheel(mouse) &&
          mouse.column >= 3 &&
          mouse.column <= columns - 1 &&
          mouse.row >= 2 &&
          mouse.row <= rows - 2
        ) {
          const translated = { ...mouse, column: mouse.column - 2, row: mouse.row - 1 };
          const lines = (mouse.button & 1) === 0 ? -3 : 3;
          this.sessions.scroll?.(sessionId, lines, translated);
        } else if (
          sessionId &&
          !isVerticalWheel(mouse) &&
          mouse.column >= 3 &&
          mouse.column <= columns - 1 &&
          mouse.row >= 2 &&
          mouse.row <= rows - 2
        ) {
          this.sessions.mouse?.(sessionId, value);
        }
        return;
      }
      if (this.topPage) {
        const plans = this.topPage.action === 'Plans';
        const items = plans ? this.planItems() : this.reviewItems();
        if (this.topPage.rename) {
          if (value === '\u001b') this.topPage.rename = null;
          else if (value === '\r') {
            try {
              if (this.topPage.rename.kind === 'plan')
                this.lineage.rename(this.topPage.rename.id, this.topPage.rename.value);
              else this.store.renameWorkstream(this.topPage.rename.id, this.topPage.rename.value);
              this.topPage.rename = null;
            } catch (error) {
              this.topPage.rename.error = error.message;
            }
          } else if (value === '\u007f' || value === '\b') {
            this.topPage.rename.value = [...this.topPage.rename.value].slice(0, -1).join('');
            this.topPage.rename.error = null;
          } else if (!/[\u0000-\u001f\u007f-\u009f]/u.test(value)) {
            this.topPage.rename.value += value;
            this.topPage.rename.error = null;
          }
          return this.draw();
        }
        if (this.topPage.feedback) {
          if (value === '\u001b') this.topPage.feedback = null;
          else if (value === '\r') {
            try {
              const detail = this.topPage.detail;
              if (this.topPage.feedback.kind === 'remedy') {
                this.reviewView.requestAction('remedy', this.topPage.feedback.value);
              } else {
                const payload = this.reviewView.feedback(this.topPage.feedback.value);
                this.scheduler.feedback(detail.executionId, detail.id, payload, (executionId, chunkId, message) =>
                  this.sendWorker(executionId, chunkId, message)
                );
              }
              this.topPage.feedback = null;
            } catch (error) {
              this.topPage.feedback.error = error.message;
            }
          } else if (value === '\u007f' || value === '\b')
            this.topPage.feedback.value = [...this.topPage.feedback.value].slice(0, -1).join('');
          else if (!/[\u0000-\u001f\u007f-\u009f]/u.test(value)) this.topPage.feedback.value += value;
          return this.draw();
        }
        if (plans && this.topPage.deleteConfirmation) {
          if (value === '\u001b') this.topPage.deleteConfirmation = null;
          else if (value === '\r') {
            const deletion = this.topPage.deleteConfirmation;
            try {
              this.deletePlans(deletion);
              this.topPage.deleteConfirmation = null;
              this.topPage.deleteError = null;
              const remaining = this.planItems();
              if (!remaining.length) return this.exitNative();
              this.topPage.index = Math.min(this.topPage.index, remaining.length - 1);
            } catch (error) {
              this.topPage.deleteConfirmation = null;
              this.topPage.deleteError = error.message;
            }
          }
          return this.draw();
        }
        if (this.topPage.detail) {
          if (plans) {
            const detail = this.topPage.detail;
            const lineage = this.lineage.load(detail.planId);
            const manifest = this.lineage.readManifest(detail.planId, detail.version);
            const count = manifest.chunks.length + 2 + (manifest.summary ? 1 : 0);
            if (detail.confirmExecute) {
              if (value === '\u001b') detail.confirmExecute = false;
              else if (value === '\r') {
                try {
                  this.scheduler.freeze(
                    detail.planId,
                    detail.version,
                    manifest.workstreamId || this.navigation.workstreamId
                  );
                  detail.confirmExecute = false;
                } catch {}
              }
              return this.draw();
            }
            if (value === 'q') {
              this.topPage.detail = null;
              return this.draw();
            }
            if (value === '\u001b') {
              if (detail.reader || detail.diff) {
                detail.reader = false;
                detail.diff = false;
                detail.scroll = 0;
              } else this.topPage.detail = null;
              return this.draw();
            }
            if (value === '\u001b[A') {
              if (detail.reader || detail.diff) detail.scroll = Math.max(0, (detail.scroll || 0) - 1);
              else detail.sectionIndex = Math.max(0, detail.sectionIndex - 1);
            } else if (value === '\u001b[B') {
              if (detail.reader || detail.diff) detail.scroll = (detail.scroll || 0) + 1;
              else detail.sectionIndex = Math.min(count - 1, detail.sectionIndex + 1);
            } else if (value === '\u001b[5~')
              detail.scroll = Math.max(0, (detail.scroll || 0) - Math.max(1, this.dimensions().rows - 10));
            else if (value === '\u001b[6~')
              detail.scroll = (detail.scroll || 0) + Math.max(1, this.dimensions().rows - 10);
            else if (value === '\u001b[D') {
              detail.version = Math.max(1, detail.version - 1);
              detail.sectionIndex = 0;
              detail.scroll = 0;
              detail.diff = false;
            } else if (value === '\u001b[C') {
              detail.version = Math.min(lineage.currentVersion, detail.version + 1);
              detail.sectionIndex = 0;
              detail.scroll = 0;
              detail.diff = false;
            } else if (value === '\r' && !detail.reader && !detail.diff) {
              detail.reader = true;
              detail.scroll = 0;
            } else if (value === 'd' && !detail.reader && detail.version > 1) {
              detail.diff = !detail.diff;
              detail.scroll = 0;
            } else if (value === 'a' && !detail.diff) {
              const currentManifest = this.lineage.readManifest(detail.planId, detail.version);
              const section = [
                currentManifest.summary,
                currentManifest.shared,
                ...currentManifest.chunks,
                currentManifest.globalValidation
              ].filter(Boolean)[detail.sectionIndex];
              if (section) {
                const approved = currentManifest.approvals[section.id]?.sectionSha === section.sha;
                if (approved) this.lineage.removeApproval(detail.planId, detail.version, section.id);
                else this.lineage.approve(detail.planId, detail.version, section.id);
              }
            } else if (
              value === 'e' &&
              !detail.reader &&
              !detail.diff &&
              !this.versionExecution(detail.planId, detail.version) &&
              this.lineage.executable(detail.planId, detail.version)
            ) {
              if (detail.version < lineage.currentVersion) detail.confirmExecute = true;
              else
                try {
                  this.scheduler.freeze(
                    detail.planId,
                    detail.version,
                    manifest.workstreamId || this.navigation.workstreamId
                  );
                } catch {}
            }
          } else {
            const detail = this.topPage.detail;
            const item = items.find(
              (candidate) => candidate.executionId === detail.executionId && candidate.id === detail.id
            );
            this.reviewView.update(item || { executionId: detail.executionId, id: detail.id, status: 'missing' });
            const confirmation = this.reviewView.state().confirmation;
            if (confirmation) {
              if (value === '\u001b') this.reviewView.cancelConfirmation();
              else if (value === '\u001b[D' || value === '\u001b[C' || value === '\t')
                this.reviewView.moveConfirmation();
              else if (value === '\r') {
                const { action, guidance } = this.reviewView.confirmAction();
                try {
                  if (action === 'integrate' || action === 'override')
                    this.integration.finalize(detail.executionId, {}, { override: action === 'override' });
                  else if (action === 'remedy')
                    this.integration.remedy(detail.executionId, ...(guidance ? [guidance] : []));
                } catch (error) {
                  this.error = error;
                }
              }
              return this.draw();
            }
            if (value === 'q' || value === '\u001b') {
              this.topPage.detail = null;
              return this.draw();
            }
            if (value === '\u001b[A') this.reviewView.scroll(-1);
            else if (value === '\u001b[B') this.reviewView.scroll(1);
            else if (value === '\u001b[5~') this.reviewView.page(-1);
            else if (value === '\u001b[6~') this.reviewView.page(1);
            else if (value === 'u') this.reviewView.removeLastSelection();
            else if (value === 'x') this.reviewView.clearSelections();
            else if (value === 'a' && item?.kind === 'chunk' && item.status === 'review')
              this.scheduler.accept(item.executionId, item.id);
            else if (value === 'f' && stateDescriptor(item).actions.includes('feedback'))
              this.topPage.feedback = { kind: item?.kind === 'final' ? 'remedy' : 'feedback', value: '', error: null };
            else if (value === 'i' && item?.kind === 'final') this.reviewView.requestAction('integrate');
            else if (value === 'o' && item?.kind === 'final') this.reviewView.requestAction('override');
            else if (value === 'r' && item?.kind === 'final') this.reviewView.requestAction('remedy');
          }
          return this.draw();
        }
        if (value === 'q' || value === '\u001b') return this.exitNative();
        const groupState = this.groupPageState(this.topPage.action);
        const selected = () => this.selectedOverviewEntry(items, groupState);
        if (value === '\u001b[A') {
          this.moveOverviewSelection(items, -1);
          this.topPage.deleteError = null;
        } else if (value === '\u001b[B') {
          this.moveOverviewSelection(items, 1);
          this.topPage.deleteError = null;
        } else if (value === '\u001b[D') {
          const entry = selected();
          if (entry?.kind === 'item') {
            groupState.selectedKey = `group:${entry.group.id}`;
            this.setGroupExpanded(entry.group.id, false, items);
          } else if (entry?.kind === 'group') this.setGroupExpanded(entry.group.id, false, items);
        } else if (value === '\u001b[C') {
          const entry = selected();
          if (entry?.kind === 'group') this.setGroupExpanded(entry.group.id, true, items);
        } else if (value === '\u001b[5~') this.moveOverviewSelection(items, -Math.max(1, this.dimensions().rows - 6));
        else if (value === '\u001b[6~') this.moveOverviewSelection(items, Math.max(1, this.dimensions().rows - 6));
        else if (value === 'r' && selected()?.kind === 'group' && selected().group.id !== 'ungrouped')
          this.topPage.rename = { kind: 'session', id: selected().group.id, value: selected().group.name, error: null };
        else if (plans && value === 'r' && selected()?.kind === 'item') {
          const item = selected().item;
          this.topPage.rename = {
            kind: 'plan',
            id: item.planId,
            value: item.name || item.title || 'Untitled plan',
            error: null
          };
        } else if (plans && value === 'd' && selected()?.kind === 'item') {
          const item = selected().item;
          this.topPage.deleteConfirmation = { scope: 'selected', count: 1, planIds: [item.planId] };
          this.topPage.deleteError = null;
        } else if (plans && value === 'D' && items.length) {
          this.topPage.deleteConfirmation = {
            scope: 'all',
            count: items.length,
            planIds: items.map((item) => item.planId)
          };
          this.topPage.deleteError = null;
        } else if (value === '\r') {
          const entry = selected();
          if (entry?.kind === 'group')
            this.setGroupExpanded(entry.group.id, !groupState.expanded.has(entry.group.id), items);
          else if (entry?.kind === 'item') {
            const item = entry.item;
            this.topPage.index = entry.index;
            this.topPage.detail = plans
              ? {
                  planId: item.planId,
                  version: item.currentVersion,
                  sectionIndex: 0,
                  reader: false,
                  diff: false,
                  scroll: 0
                }
              : { executionId: item.executionId, id: item.id, scroll: 0 };
          }
        }
        return this.draw();
      }
      if (this.sessionPicker) {
        let rows = this.sessionPickerRows(this.decorateWorkspace(this.store.load()));
        this.syncSessionPicker(rows);
        const selected = () => rows[this.sessionPicker.index];
        if (this.sessionPicker.confirmDelete) {
          if (value === '\u001b') this.sessionPicker.confirmDelete = null;
          else if (value === '\r') {
            const deletion = this.sessionPicker.confirmDelete;
            try {
              this.deleteSessions(deletion);
              this.sessionPicker.confirmDelete = null;
              this.sessionPicker.deleteError = null;
              this.workspace = this.decorateWorkspace(this.store.load());
              this.sessionExpanded = new Set(
                this.workspace.activeWorkstreamId ? [this.workspace.activeWorkstreamId] : []
              );
              if (!this.workspace.workstreams.length) return this.activate('New');
              const nextRows = this.sessionPickerRows(this.workspace, this.sessionExpanded);
              const next =
                nextRows.find((row) => row.header && row.stream.id === this.workspace.activeWorkstreamId) ||
                nextRows[0];
              this.sessionPicker = {
                index: Math.max(0, nextRows.indexOf(next)),
                selectedKey: next?.key || null,
                sessionId: null,
                expanded: this.sessionExpanded
              };
            } catch (error) {
              this.sessionPicker.confirmDelete = null;
              this.sessionPicker.deleteError = error.message;
            }
          }
          return this.draw();
        }
        if (this.sessionPicker.edit) {
          if (value === '\u001b') this.sessionPicker.edit = null;
          else if (value === '\r') {
            try {
              this.store.renameWorkstream(this.sessionPicker.edit.workstreamId, this.sessionPicker.edit.value);
              this.sessionPicker.edit = null;
            } catch (error) {
              this.sessionPicker.edit.error = error.message;
            }
          } else if (value === '\u007f' || value === '\b') {
            this.sessionPicker.edit.value = [...this.sessionPicker.edit.value].slice(0, -1).join('');
            this.sessionPicker.edit.error = null;
          } else if (!/[\u0000-\u001f\u007f-\u009f]/u.test(value)) {
            this.sessionPicker.edit.value += value;
            this.sessionPicker.edit.error = null;
          }
          return this.draw();
        }
        if (value === 'q') return this.exitNative();
        if (value === '\u001b') return this.exitNative();
        if ((value === '\u001b[A' || value === '\u001b[B') && rows.length) {
          this.sessionPicker.followSelection = true;
          this.sessionPicker.index = Math.max(
            0,
            Math.min(rows.length - 1, this.sessionPicker.index + (value === '\u001b[A' ? -1 : 1))
          );
          const row = rows[this.sessionPicker.index];
          this.sessionPicker.selectedKey = row.key;
          this.sessionPicker.sessionId = row.header ? null : row.session.id;
        } else if (value === '\u001b[D' && selected()) {
          const streamId = selected().stream.id;
          this.sessionPicker.expanded.delete(streamId);
          rows = this.sessionPickerRows(this.decorateWorkspace(this.store.load()));
          const parent = rows.find((row) => row.header && row.stream.id === streamId);
          this.sessionPicker.index = rows.indexOf(parent);
          this.sessionPicker.selectedKey = parent?.key || null;
          this.sessionPicker.sessionId = null;
          this.sessionPicker.followSelection = true;
        } else if (value === '\u001b[C' && selected()?.header) {
          this.sessionPicker.expanded.add(selected().stream.id);
          rows = this.sessionPickerRows(this.decorateWorkspace(this.store.load()));
          this.syncSessionPicker(rows);
          this.sessionPicker.followSelection = true;
        } else if ((value === '\u001b[5~' || value === '\u001b[6~') && rows.length) {
          this.sessionPicker.followSelection = true;
          this.sessionPicker.index = Math.max(
            0,
            Math.min(
              rows.length - 1,
              this.sessionPicker.index + (value === '\u001b[5~' ? -1 : 1) * Math.max(1, this.dimensions().rows - 5)
            )
          );
          const row = rows[this.sessionPicker.index];
          this.sessionPicker.selectedKey = row.key;
          this.sessionPicker.sessionId = row.header ? null : row.session.id;
        } else if (value === 'r' && selected()?.header)
          this.sessionPicker.edit = {
            workstreamId: selected().stream.id,
            value: selected().stream.name || fallbackName(selected().session, selected().stream, this.workspace),
            error: null
          };
        else if (value === 'd' && selected()?.header) {
          const row = selected();
          const agentCount = this.store
            .load()
            .sessions.filter((session) => session.workstreamId === row.stream.id).length;
          this.sessionPicker.confirmDelete = {
            scope: 'selected',
            count: 1,
            workstreamId: row.stream.id,
            name: row.stream.name || fallbackName(row.session, row.stream, this.workspace),
            agentCount
          };
          this.sessionPicker.deleteError = null;
        } else if (value === 'D') {
          const workspace = this.store.load();
          if (workspace.workstreams.length) {
            this.sessionPicker.confirmDelete = {
              scope: 'all',
              count: workspace.workstreams.length,
              agentCount: workspace.sessions.length
            };
            this.sessionPicker.deleteError = null;
          }
        } else if (value === '\r' && selected()) {
          const row = selected();
          if (row.header) {
            if (this.sessionPicker.expanded.has(row.stream.id)) this.sessionPicker.expanded.delete(row.stream.id);
            else this.sessionPicker.expanded.add(row.stream.id);
            this.sessionPicker.selectedKey = row.key;
            this.sessionPicker.sessionId = null;
          } else {
            if (row.stream.status === 'closed') this.store.reopenWorkstream(row.stream.id);
            this.openAgent(row.session.id, { draw: false });
          }
        }
        return this.draw();
      }
      if (this.wizard && value === '\u001b') {
        if (this.navigation.agents().length) return this.exitNative();
        return this.draw();
      }
      if (this.wizard && this.navigation.rail === 'content') {
        const config = this.wizard.handle(value);
        if (config) this.finishWizard(config);
        return this.draw();
      }
      const session = this.selectedSession();
      if (this.navigation.rail === 'content' && session) {
        if (!this.sessionIsOpen(session)) {
          if (value === '\r') this.startFocusedSession(session);
        } else if (value === '\u001b[A') this.sessions.scroll?.(session.id, -1);
        else if (value === '\u001b[B') this.sessions.scroll?.(session.id, 1);
        else if (value !== '\u001b[D' && value !== '\u001b[C') {
          this.store.setSessionTurnState?.(session.id, 'working', 'user input');
          this.sessions.write?.(session.id, value);
        }
      }
    };
    this.onData = (data) => {
      for (const value of inputTokens(data)) if (handle(value) === false) break;
    };
    this.onResize = () => {
      const dimensions = this.dimensions();
      for (const sessionId of this.sessions.processes?.keys?.() || [])
        this.sessions.resize?.(sessionId, dimensions.columns, dimensions.rows);
      this.draw();
    };
    this.input.on?.('data', this.onData);
    this.output.on?.('resize', this.onResize);
    this.draw();
    return this;
  }
  activate(action) {
    if (action === 'New') {
      if (!this.wizard)
        this.previousSurface = this.navigation.activeAction
          ? { action: this.navigation.activeAction }
          : { sessionId: this.navigation.sessionId };
      this.sessionPicker = null;
      this.topPage = null;
      this.wizard = this.createWizard();
      this.navigation.activeAction = 'New';
      this.navigation.rail = 'content';
      return this.draw();
    }
    if (action === 'Sessions') {
      this.wizard = null;
      this.topPage = null;
      const currentAgent = this.navigation.currentAgent();
      this.sessionExpanded ||= new Set(currentAgent?.stream.id ? [currentAgent.stream.id] : []);
      const rows = this.sessionPickerRows(this.store.load(), this.sessionExpanded);
      const current = rows.findIndex((row) => !row.header && row.session.id === this.navigation.sessionId);
      const fallback = rows.findIndex((row) => row.header && row.stream.id === currentAgent?.stream.id);
      const index = current >= 0 ? current : Math.max(0, fallback);
      const selected = rows[index] || rows[0];
      this.sessionPicker = {
        index,
        selectedKey: selected?.key || null,
        sessionId: selected && !selected.header ? selected.session.id : null,
        expanded: this.sessionExpanded
      };
      this.navigation.activeAction = 'Sessions';
      this.navigation.rail = 'content';
      return this.draw();
    }
    if (action === 'Close') {
      const session = this.selectedSession();
      if (session) {
        if (this.sessions.pause) this.sessions.pause(session.id);
        else this.sessions.close?.(session.id);
        const current = this.store.load().sessions.find((item) => item.id === session.id);
        if (current && !current.explicitlyClosed) this.store.pauseSession?.(session.id);
      }
      this.workspace = this.decorateWorkspace(this.store.load());
      this.navigation.activeAction = null;
      this.navigation.sessionId = null;
      this.navigation.rail = 'content';
      this.navigation.sync(this.workspace);
      const openAgents = this.navigation
        .agents()
        .filter(({ session: candidate }) => !pausedSession(candidate) && !terminalSession(candidate));
      const sameParent = openAgents.find(({ stream }) => stream.id === session?.workstreamId);
      const fallback = sameParent || openAgents[0];
      if (fallback) return this.focusAgent(fallback.session.id);
      return this.activate('Sessions');
    }
    if (action === 'Plans' || action === 'Reviews') {
      this.wizard = null;
      this.sessionPicker = null;
      this.topPage = { action, index: 0 };
      this.groupPageState(action);
      this.navigation.activeAction = action;
      this.navigation.rail = 'content';
      return this.draw();
    }
    return this.draw();
  }
  stop() {
    this.running = false;
    this.quitPending = false;
    if (this.quitTimer !== undefined) {
      this.cancelTimeout(this.quitTimer);
      this.quitTimer = undefined;
    }
    if (this.outputDrawTimer !== undefined) {
      this.cancelTimeout(this.outputDrawTimer);
      this.outputDrawTimer = undefined;
    }
    this.git.cancelChecks?.();
    this.sessions.shutdown?.();
    this.bridge.close?.();
    this.input.off?.('data', this.onData);
    this.output.off?.('resize', this.onResize);
    this.input.setRawMode?.(false);
    this.input.pause?.();
    this.output.write(`${terminalTitle(null, false)}${ESC}?1006l${ESC}?1000l${ESC}?25h${ESC}?1049l`);
    this.release();
  }
}

module.exports = {
  ACTIONS,
  FOOTER_MESSAGES,
  availableActions,
  COLORS,
  width,
  fit,
  crop,
  softWrapLine,
  softWrap,
  railName,
  promptPreview,
  inputTokens,
  mouseEvent,
  isVerticalWheel,
  isPrimaryClick,
  isShiftedMouse,
  sanitizeTerminalTitle,
  formatLocalDateTime,
  hasOpenAttention,
  terminalTitle,
  executionStateLabel,
  codedError,
  errorPageLines,
  Navigation,
  TerminalRenderer,
  TerminalSupervisor
};
