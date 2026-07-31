'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { WorkspaceCatalog, LineageCatalog } = require('../state/repositories');
const { SessionManager } = require('../sessions/manager');
const { TmuxControlClient } = require('../tmux/control');
const { TerminalSupervisor } = require('../tui/supervisor');
const { fitsRail } = require('../tmux/cells');
const { planningProviderName } = require('../state/workspace');
const { atomicWrite } = require('../core/plans');
const { ROLE_LABELS } = require('../tmux/status');
const { encodeMessage, listen } = require('./protocol');

function activeExecutionForSession(state, session) {
  return (state.executions || []).some(
    (execution) =>
      execution.workstreamId === session.workstreamId &&
      !['complete', 'completed', 'cancelled', 'failed'].includes(execution.status)
  );
}

class DaemonSupervisor {
  constructor(root, tmux, paths, { store, lineages, sessions, control, io = fs, dangerous = false } = {}) {
    this.root = path.resolve(root);
    this.tmux = tmux;
    this.paths = paths;
    this.io = io;
    this.store = store || new WorkspaceCatalog(root);
    this.controller = null;
    if (!sessions) {
      const input = { on() {}, off() {}, setRawMode() {}, resume() {}, pause() {} };
      const output = { columns: 80, rows: 24, write() {}, on() {}, off() {} };
      this.controller = new TerminalSupervisor(root, { store: this.store, tmux, dangerous, input, output });
      this.controller.scheduleDraw = () => {};
      this.controller.bridge.setToolSuccessHandler?.((event) => {
        this.controller.handleToolSuccess(event);
        this.refreshLabels();
      });
    }
    this.lineages = lineages || this.controller?.lineage || new LineageCatalog(this.store);
    this.sessions = sessions || this.controller?.sessions || new SessionManager(root, this.store, { tmux, dangerous });
    this.control = control || new TmuxControlClient(tmux.command);
    this.server = null;
    this.stopping = false;
    this.railTimer = null;
    this.subscribers = new Set();
  }
  start() {
    this.controller?.acquire();
    this.controller?.bridge.start?.();
    if (this.controller?.bridge.error) throw this.controller.bridge.error;
    const createdTmuxServer = this.tmux.start();
    this.sessions.restore();
    if (!createdTmuxServer) this.rotateBridgeDescriptors();
    this.controller?.scheduler.resume?.();
    this.controller?.reconcileManagedSessions();
    this.controller?.integration.resumeIntegrationQueue?.();
    this.controller?.recoverIncompleteVerifications();
    this.controller?.recoverIncompleteIntegrations();
    this.reconcile();
    this.bindControl();
    this.server = listen(this.paths.daemonSocket, (request, socket) => this.handle(request, socket), {
      io: this.io
    });
    this.io.writeFileSync(this.paths.pid, `${process.pid}\n`, { mode: 0o600 });
    this.railTimer = setInterval(() => {
      this.refreshLabels();
      this.admitWaiting();
      this.notifySubscribers();
    }, 1000);
    this.railTimer.unref?.();
    return this;
  }
  rotateBridgeDescriptors() {
    for (const session of this.store.load().sessions.filter((item) => this.sessions.isOpen(item.id)))
      this.sessions.restart(session.id);
  }
  bindControl() {
    const sessionForPane = (paneId) => this.tmux.panes().find((pane) => pane.paneId === paneId)?.sessionId;
    this.control.on('output', ({ paneId, data }) => {
      const sessionId = sessionForPane(paneId);
      if (!sessionId) return;
      this.sessions.markOutput(sessionId);
      if (data.includes('\u0007')) {
        this.sessions.notifyAttention(sessionId);
        this.sessions.markIdle(sessionId, 'provider notification');
      }
      this.notifySubscribers();
    });
    this.control.on('exit', ({ paneId, code }) => {
      const sessionId = sessionForPane(paneId);
      if (sessionId) this.sessions.paneExited(sessionId, code);
      this.admitWaiting();
    });
    this.control.on('focus', ({ paneId }) => {
      const sessionId = sessionForPane(paneId);
      if (sessionId) this.store.markSessionViewed?.(sessionId);
      this.refreshLabels();
    });
    this.control.on('window', () => this.refreshLabels());
    this.control.start();
  }
  refreshLabels() {
    const sessions = new Map(this.store.load().sessions.map((session) => [session.id, session]));
    const panes = this.tmux.panes();
    const width = this.tmux.narrowestClientWidth();
    for (const pane of panes) {
      const session = sessions.get(pane.sessionId);
      const count = panes.filter((item) => item.windowId === pane.windowId).length;
      const columns = Math.max(1, Math.floor((width - Math.max(0, count - 1)) / count));
      if (session) this.tmux.setLabel(pane.paneId, session, pane.active === '1', columns);
    }
  }
  notifySubscribers() {
    if (!this.subscribers.size) return;
    const message = encodeMessage({ event: 'state', state: this.store.load() });
    for (const socket of this.subscribers) if (socket.writable) socket.write(message);
  }
  reconcile() {
    const state = this.store.load();
    const sessions = new Map(state.sessions.map((session) => [session.id, session]));
    for (const pane of this.tmux.panes()) {
      if (!pane.sessionId) continue;
      const session = sessions.get(pane.sessionId);
      if (!session) this.tmux.killPane(pane.sessionId);
      else this.tmux.setLabel(pane.paneId, session, pane.active === '1');
    }
    for (const session of state.sessions) {
      if (session.status === 'running' && !this.sessions.isOpen(session.id))
        this.store.update((value) => {
          const current = value.sessions.find((item) => item.id === session.id);
          current.status = 'paused';
          current.turnState = 'idle';
          current.turnStateReason = 'reconciled after provider exit';
          return value;
        });
    }
    this.refreshLabels();
    this.admitWaiting();
  }
  admitWaiting() {
    for (const session of this.store.load().sessions.filter((item) => item.waitingForRail)) {
      if (!this.sessions.canOpen(session, true)) break;
      try {
        this.sessions.open(session.id, { automatic: true, lifecycleOwner: 'managed' });
      } catch (error) {
        this.store.update((value) => {
          const current = value.sessions.find((item) => item.id === session.id);
          if (current) {
            current.status = 'failed';
            current.turnState = 'idle';
            current.turnStateReason = `queued launch failed: ${error.message}`;
            delete current.waitingForRail;
            delete current.waitingReason;
          }
          return value;
        });
      }
    }
  }
  pageRows(page) {
    const state = this.store.load();
    if (page === 'Sessions')
      return state.workstreams.flatMap((stream) =>
        state.sessions
          .filter((session) => session.workstreamId === stream.id)
          .map((session) => ({
            id: session.id,
            groupId: stream.id,
            name: session.name,
            agent: ROLE_LABELS[session.role] || session.role,
            status: session.waitingForRail
              ? 'Waiting'
              : session.turnState === 'working'
                ? 'Working'
                : session.status === 'paused'
                  ? 'Paused'
                  : 'Idle'
          }))
      );
    if (page === 'Plans')
      return this.lineages.list().map((plan) => ({
        id: plan.planId,
        groupId: plan.workstreamId,
        name: plan.name || plan.title || plan.planId,
        agent: state.sessions.find((session) => session.id === plan.originSessionId)?.name || 'Planning agent',
        status: this.controller?.planExecutionLabel(plan, plan.currentVersion) || 'Idle'
      }));
    if (page === 'Reviews')
      return (this.controller?.reviewItems(state) || []).map((item) => ({
        id: `${item.executionId}:${item.id}`,
        executionId: item.executionId,
        itemId: item.id,
        groupId: item.workstreamId,
        name: item.planTitle,
        agent: item.agentLabel,
        status: item.status === 'running' ? 'Working' : item.status === 'failed' ? 'Exited' : 'Idle'
      }));
    return [];
  }
  reviewDetail(id) {
    const item = (this.controller?.reviewItems(this.store.load()) || []).find(
      (value) => `${value.executionId}:${value.id}` === id
    );
    if (!item) throw new Error(`Unknown review item: ${id}`);
    const detail = this.controller.reviewDetailItem(item);
    return { id, lines: `${detail.diff || detail.summary || ''}`.split('\n') };
  }
  recordReviewExcerpt(params) {
    if (
      typeof params.id !== 'string' ||
      !Number.isInteger(params.start) ||
      !Number.isInteger(params.end) ||
      params.start < 0 ||
      params.end < params.start ||
      !Array.isArray(params.lines) ||
      params.lines.some((line) => typeof line !== 'string')
    )
      throw new Error('Invalid review excerpt');
    const directory = path.join(this.root, '.bdfl');
    const file = path.join(directory, 'review-excerpts.ndjson');
    this.io.mkdirSync(directory, { recursive: true });
    let existing = '';
    try {
      existing = this.io.readFileSync(file, 'utf8');
    } catch {}
    atomicWrite(
      file,
      `${existing}${JSON.stringify({
        reviewId: params.id,
        start: params.start,
        end: params.end,
        text: params.lines.join('\n'),
        createdAt: new Date().toISOString()
      })}\n`,
      this.io
    );
    this.io.chmodSync?.(file, 0o600);
    return true;
  }
  deleteSession(id, cascade = false) {
    const state = this.store.load();
    const session = state.sessions.find((item) => item.id === id);
    if (!session) throw new Error(`Unknown session: ${id}`);
    const cascading = cascade || ['delegator', 'direct'].includes(session.role);
    const affected = cascading
      ? state.sessions.filter((item) => item.workstreamId === session.workstreamId)
      : [session];
    const executions = this.controller?.scheduler.list?.() || state.executions || [];
    if (
      affected.some((item) =>
        executions.some(
          (execution) =>
            execution.workstreamId === item.workstreamId &&
            !['complete', 'completed', 'cancelled', 'failed'].includes(execution.status)
        )
      )
    ) {
      const error = new Error('An affected agent is required by an active execution');
      error.code = 'ACTIVE_EXECUTION';
      throw error;
    }
    if (cascading) {
      for (const item of affected) if (this.sessions.isOpen(item.id)) this.sessions.close(item.id, false);
      this.store.deleteWorkstream(session.workstreamId);
    } else this.sessions.delete(id);
    return true;
  }
  deletePlan(id, sessionPlans = false) {
    const plan = this.lineages.find(id).lineage;
    if (!plan) throw new Error(`Unknown plan: ${id}`);
    const plans = sessionPlans
      ? this.lineages.list().filter((item) => item.originSessionId === plan.originSessionId)
      : [plan];
    const state = this.store.load();
    const executions = this.controller?.scheduler.list?.() || state.executions || [];
    if (
      executions.some(
        (execution) =>
          plans.some((item) => item.id === execution.planId) && !['complete', 'cancelled'].includes(execution.status)
      )
    ) {
      const error = new Error('An affected plan is required by an active execution');
      error.code = 'ACTIVE_EXECUTION';
      throw error;
    }
    for (const item of plans) this.lineages.delete(item.planId);
    return true;
  }
  async handle(request, socket = null) {
    const { action, params = {} } = request || {};
    if (action === 'ping') return { pid: process.pid };
    if (action === 'state') return this.store.load();
    if (action === 'configure') {
      const dangerous = params.dangerous === true;
      const changed = this.sessions.dangerous !== dangerous;
      this.sessions.dangerous = dangerous;
      if (this.controller) this.controller.dangerous = this.sessions.dangerous;
      if (changed)
        for (const session of this.store.load().sessions)
          if (this.sessions.isOpen(session.id)) this.sessions.restart(session.id);
      return { dangerous: this.sessions.dangerous };
    }
    if (action === 'subscribe') {
      if (!socket) throw new Error('State subscriptions require a persistent socket');
      this.subscribers.add(socket);
      socket.once('close', () => this.subscribers.delete(socket));
      return this.store.load();
    }
    if (action === 'rows') return this.pageRows(params.page);
    if (action === 'review-detail') return this.reviewDetail(params.id);
    if (action === 'review-excerpt') return this.recordReviewExcerpt(params);
    if (action === 'new-context') {
      const repositories = this.store.selectableRepositories();
      return {
        repositories,
        rememberedRepositoryRoot: this.store.rememberedRepositoryRoot(),
        lastUsed: repositories[0]?.lastUsed || null
      };
    }
    if (action === 'create') {
      const config = params.config;
      const current = this.store.load();
      const profile = config.sessionType === 'direct' ? config.directProfile : config.delegatorProfile;
      const sequence =
        current.workstreams.filter((stream) => {
          const candidate = stream.sessionType === 'direct' ? stream.directProfile : stream.delegatorProfile;
          return candidate?.provider === profile.provider;
        }).length + 1;
      const name = `${planningProviderName(profile.provider)} ${sequence}`;
      if (
        !fitsRail(
          [...current.workstreams.filter((stream) => stream.status !== 'closed').map((stream) => stream.name), name],
          this.tmux.narrowestClientWidth()
        )
      ) {
        this.tmux.message('BDFL: close a session or widen the narrowest client before creating another session');
        const error = new Error('The session rail has no space for another session');
        error.code = 'RAIL_FULL';
        throw error;
      }
      const stream = this.store.createWorkstream(config, undefined, config.repositoryRoot);
      const role = config.sessionType === 'direct' ? 'direct' : 'delegator';
      const session = this.store.createSession(stream.id, role, profile, {
        turnState: 'idle',
        turnStateReason: 'awaiting start',
        lifecycleOwner: 'user'
      });
      this.sessions.open(session.id, { lifecycleOwner: 'user' });
      this.sessions.focus(session.id);
      return session;
    }
    if (action === 'open') {
      const opened = this.sessions.open(params.sessionId, { lifecycleOwner: 'user' });
      if (opened) this.sessions.focus(params.sessionId);
      return opened;
    }
    if (action === 'focus') return this.sessions.focus(params.sessionId);
    if (action === 'pause') {
      const paused = this.sessions.pause(params.sessionId);
      this.admitWaiting();
      return paused;
    }
    if (action === 'delete-session') return this.deleteSession(params.id, params.cascade);
    if (action === 'delete-plan') return this.deletePlan(params.id, params.sessionPlans);
    if (action === 'reconcile') {
      this.reconcile();
      return true;
    }
    if (action === 'active') return this.tmux.activePane();
    if (action === 'shutdown') {
      setImmediate(() => this.stop(true));
      return true;
    }
    throw new Error(`Unknown supervisor action: ${action}`);
  }
  stop(normal = false) {
    if (this.stopping) return;
    this.stopping = true;
    this.sessions.shutdown();
    if (this.railTimer) clearInterval(this.railTimer);
    this.railTimer = null;
    this.controller?.git.cancelChecks?.();
    this.controller?.bridge.close?.();
    this.controller?.release();
    this.control.stop();
    this.server?.close();
    if (normal) this.tmux.kill();
    for (const file of [this.paths.daemonSocket, this.paths.pid]) {
      try {
        this.io.unlinkSync(file);
      } catch {}
    }
    if (normal) process.nextTick(() => process.exit(0));
  }
}

module.exports = { activeExecutionForSession, DaemonSupervisor };
