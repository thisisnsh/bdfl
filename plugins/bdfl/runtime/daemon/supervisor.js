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
const { ROLE_LABELS, agentRail } = require('../tmux/status');
const { PROTOCOL_VERSION, SURFACE_SNAPSHOT_VERSION, encodeMessage, listen } = require('./protocol');

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
    this.control.on('window', () => {
      const active = this.tmux.activePane();
      if (active?.sessionId && !this.tmux.overview()) this.sessions.focus(active.sessionId);
      this.refreshLabels();
    });
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
    this.tmux.setStatusRail?.(agentRail(this.store.load(), panes, width));
  }
  orderedOpenSessions() {
    const state = this.store.load();
    const panes = new Map(
      this.tmux
        .panes()
        .filter((pane) => pane.dead !== '1')
        .map((pane) => [pane.sessionId, pane])
    );
    return state.workstreams.flatMap((stream) =>
      state.sessions
        .filter((session) => session.workstreamId === stream.id && panes.has(session.id))
        .sort((left, right) => (left.paneNumber || 0) - (right.paneNumber || 0))
    );
  }
  focusRelative(direction = 'next') {
    const sessions = this.orderedOpenSessions();
    if (!sessions.length) return null;
    const active = this.tmux.activePane()?.sessionId;
    const index = Math.max(
      0,
      sessions.findIndex((session) => session.id === active)
    );
    const offset = direction === 'previous' ? -1 : 1;
    const selected = sessions[(index + sessions.length + offset) % sessions.length];
    this.sessions.focus(selected.id);
    this.refreshLabels();
    return selected;
  }
  pauseActive() {
    const active = this.tmux.activePane()?.sessionId;
    if (!active) return null;
    const sessions = this.orderedOpenSessions();
    const index = sessions.findIndex((session) => session.id === active);
    const sameStream = sessions.find(
      (session) => session.id !== active && session.workstreamId === sessions[index]?.workstreamId
    );
    const fallback = sameStream || sessions[(index + 1) % sessions.length];
    const paused = this.sessions.pause(active);
    if (fallback && fallback.id !== active) this.sessions.focus(fallback.id);
    this.admitWaiting();
    this.refreshLabels();
    return paused;
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
  surfaceSnapshot(page, params = {}) {
    const state = this.store.load();
    const base = {
      protocolVersion: PROTOCOL_VERSION,
      snapshotVersion: SURFACE_SNAPSHOT_VERSION,
      page,
      generatedAt: new Date().toISOString()
    };
    if (page === 'Sessions') {
      const activeId = this.tmux.activePane()?.sessionId || null;
      return {
        ...base,
        activeId,
        groups: state.workstreams.map((stream) => ({
          id: stream.id,
          name: stream.name || stream.title || 'Session',
          status: stream.status,
          sessionType: stream.sessionType,
          updatedAt: stream.updatedAt || stream.createdAt,
          agents: state.sessions
            .filter((session) => session.workstreamId === stream.id)
            .sort((left, right) => (left.paneNumber || 0) - (right.paneNumber || 0))
            .map((session) => ({
              id: session.id,
              name: session.name,
              role: session.role,
              status: session.status,
              turnState: session.turnState,
              turnStateReason: session.turnStateReason,
              taskSnippet: session.taskSnippet,
              attention: Boolean(session.attention),
              lifecycleOwner: session.lifecycleOwner,
              open: this.sessions.isOpen(session.id),
              active: session.id === activeId,
              createdAt: session.createdAt,
              updatedAt: session.updatedAt
            }))
        }))
      };
    }
    if (page === 'Plans') {
      const plans = this.lineages.list().map((plan) => ({
        id: plan.planId,
        workstreamId: plan.workstreamId,
        originSessionId: plan.originSessionId,
        name: plan.name || plan.title || plan.planId,
        currentVersion: plan.currentVersion,
        createdAt: plan.createdAt,
        updatedAt: plan.updatedAt,
        status: this.controller?.planExecutionLabel(plan, plan.currentVersion) || 'Idle'
      }));
      let detail = null;
      if (params.id) {
        const lineage = this.lineages.load(params.id);
        const version = Math.max(1, Math.min(Number(params.version) || lineage.currentVersion, lineage.currentVersion));
        const manifest = this.lineages.readManifest(params.id, version);
        const sections = [manifest.summary, manifest.shared, ...(manifest.chunks || []), manifest.globalValidation]
          .filter(Boolean)
          .map((section) => ({
            ...section,
            approved: manifest.approvals?.[section.id]?.sectionSha === section.sha,
            content: this.lineages.readSection(params.id, version, section.id)
          }));
        let diff = '';
        if (version > 1) {
          const before = this.io.readFileSync(
            path.join(this.lineages.versionDirectory(params.id, version - 1), 'consolidated.md'),
            'utf8'
          );
          const after = this.io.readFileSync(
            path.join(this.lineages.versionDirectory(params.id, version), 'consolidated.md'),
            'utf8'
          );
          diff = require('../core/plans')
            .diffLines(before, after)
            .map((line) => `${line.type === 'addition' ? '+' : line.type === 'removal' ? '-' : ' '} ${line.text}`)
            .join('\n');
        }
        detail = {
          id: lineage.planId,
          name: lineage.name || lineage.title || lineage.planId,
          version,
          currentVersion: lineage.currentVersion,
          workstreamId: lineage.workstreamId,
          executable: this.lineages.executable(params.id, version),
          executionStatus: this.controller?.planExecutionLabel(lineage, version) || 'Idle',
          sections,
          diff
        };
      }
      return { ...base, plans, detail };
    }
    if (page === 'Reviews') {
      const items = (this.controller?.reviewItems(state) || []).map((item) => ({
        id: `${item.executionId}:${item.id}`,
        executionId: item.executionId,
        itemId: item.id,
        workstreamId: item.workstreamId,
        kind: item.kind,
        status: item.status,
        planTitle: item.planTitle,
        agentLabel: item.agentLabel,
        summary: item.summary,
        changedPaths: item.changedPaths || [],
        attention: Boolean(item.attention)
      }));
      let detail = null;
      if (params.id) {
        const source = (this.controller?.reviewItems(state) || []).find(
          (item) => `${item.executionId}:${item.id}` === params.id
        );
        if (!source) throw new Error(`Unknown review item: ${params.id}`);
        const item = this.controller.reviewDetailItem(source);
        detail = {
          ...items.find((candidate) => candidate.id === params.id),
          diff: item.diff || '',
          checks: item.checks || item.checkResults || [],
          verification: item.verification,
          phase: item.phase
        };
      }
      return { ...base, items, detail };
    }
    throw new Error(`Unknown workflow surface: ${page}`);
  }
  sessionAction(params) {
    if (params.name === 'focus' || params.name === 'resume') {
      if (params.name === 'resume' || !this.sessions.isOpen(params.id))
        this.sessions.open(params.id, { lifecycleOwner: 'user' });
      this.sessions.focus(params.id);
      return true;
    }
    if (params.name === 'rename') return this.store.renameWorkstream(params.id, params.value);
    if (params.name === 'delete-agent') return this.deleteSession(params.id, false);
    if (params.name === 'delete-session') {
      const session = this.store
        .load()
        .sessions.find((item) => item.workstreamId === params.id && ['delegator', 'direct'].includes(item.role));
      if (!session) throw new Error(`Unknown session: ${params.id}`);
      return this.deleteSession(session.id, true);
    }
    throw new Error(`Unknown Sessions action: ${params.name}`);
  }
  planAction(params) {
    if (params.name === 'rename') return this.lineages.rename(params.id, params.value);
    if (params.name === 'delete') return this.deletePlan(params.id, false);
    if (params.name === 'delete-session-plans') return this.deletePlan(params.id, true);
    if (params.name === 'toggle-approval') {
      const manifest = this.lineages.readManifest(params.id, params.version);
      const section = [manifest.summary, manifest.shared, ...(manifest.chunks || []), manifest.globalValidation]
        .filter(Boolean)
        .find((item) => item.id === params.sectionId);
      if (!section) throw new Error(`Unknown plan section: ${params.sectionId}`);
      if (manifest.approvals?.[section.id]?.sectionSha === section.sha)
        return this.lineages.removeApproval(params.id, params.version, section.id);
      return this.lineages.approve(params.id, params.version, section.id);
    }
    if (params.name === 'execute') {
      const manifest = this.lineages.readManifest(params.id, params.version);
      return this.controller.scheduler.freeze(params.id, params.version, manifest.workstreamId);
    }
    throw new Error(`Unknown Plans action: ${params.name}`);
  }
  reviewAction(params) {
    if (params.name === 'accept') return this.controller.scheduler.accept(params.executionId, params.itemId);
    if (params.name === 'feedback')
      return this.controller.scheduler.feedback(
        params.executionId,
        params.itemId,
        { message: params.message || '', selections: params.selections || [] },
        (executionId, chunkId, message) => this.controller.sendWorker(executionId, chunkId, message)
      );
    if (params.name === 'remedy') return this.controller.integration.remedy(params.executionId, params.message || '');
    if (params.name === 'integrate' || params.name === 'override')
      return this.controller.integration.finalize(params.executionId, {}, { override: params.name === 'override' });
    throw new Error(`Unknown Reviews action: ${params.name}`);
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
    if (action === 'ping') return { pid: process.pid, protocolVersion: PROTOCOL_VERSION };
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
    if (action === 'surface-snapshot') return this.surfaceSnapshot(params.page, params);
    if (action === 'sessions-action') return this.sessionAction(params);
    if (action === 'plans-action') return this.planAction(params);
    if (action === 'reviews-action') return this.reviewAction(params);
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
    if (action === 'focus-relative') return this.focusRelative(params.direction);
    if (action === 'toggle-overview') return this.tmux.toggleOverview();
    if (action === 'pause-active') return this.pauseActive();
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
