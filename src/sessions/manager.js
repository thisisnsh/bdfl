'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { atomicWrite } = require('../core/plans');
const { buildLaunch, codexRuntime, skillDestination, pluginDestination, ROLE } = require('../providers/adapters');
const { CodexSessionIndex } = require('../providers/codex-index');
const { fitsRail } = require('../tmux/cells');
const { agentLabel } = require('../tmux/status');

function substantivePlanningPrompt(value) {
  const prompt = `${value || ''}`
    .replace(/[\u0000-\u001f\u007f-\u009f]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
  if (
    !prompt ||
    prompt.startsWith('/') ||
    /^(?:y|yes|yes please|n|no|ok|okay|sure|confirm|confirmed|continue|approve|approved|retry|cancel|skip|go ahead|proceed|do it|sounds good|looks good|lgtm|[1-9])(?:[.!])?$/iu.test(
      prompt
    )
  )
    return null;
  return prompt;
}

class SessionManager {
  constructor(
    root,
    store,
    {
      tmux,
      io = fs,
      packageRoot = path.resolve(__dirname, '../..'),
      codexSessions = path.join(os.homedir(), '.codex', 'sessions'),
      bridge = null,
      requireBridge = false,
      dangerous = false,
      now = Date.now,
      setTimeout: schedule = setTimeout,
      clearTimeout: cancel = clearTimeout
    } = {}
  ) {
    if (!tmux) throw new Error('SessionManager requires an isolated tmux server');
    this.root = path.resolve(root);
    this.store = store;
    this.tmux = tmux;
    this.io = io;
    this.packageRoot = packageRoot;
    this.bridge = bridge;
    this.requireBridge = requireBridge;
    this.dangerous = dangerous;
    this.now = now;
    this.schedule = schedule;
    this.cancel = cancel;
    this.codexIndex = new CodexSessionIndex(codexSessions, { io, now });
    this.codexPending = new Map();
    this.codexTimer = null;
    this.openSessions = new Set();
    this.onOutput = null;
    this.onActivity = null;
    this.onAttention = null;
    this.onExit = null;
    this.bridge?.setProxyLossHandler?.((sessionId) => this.restartForBridge(sessionId));
  }
  rootFor(session) {
    return path.resolve(session?.repositoryRoot || this.root);
  }
  session(sessionId) {
    return this.store.load().sessions.find((item) => item.id === sessionId);
  }
  stream(session) {
    return this.store.load().workstreams.find((item) => item.id === session.workstreamId);
  }
  injectSkill(session) {
    const destination = skillDestination(this.rootFor(session), session.profile.provider, session.id);
    this.io.mkdirSync(path.dirname(destination), { recursive: true });
    this.io.cpSync(path.join(this.packageRoot, 'skills', 'bdfl-plan'), destination, { recursive: true });
    return destination;
  }
  instructions() {
    return [
      ROLE,
      this.io.readFileSync(path.join(this.packageRoot, 'skills', 'bdfl-plan', 'SKILL.md'), 'utf8'),
      this.io.readFileSync(path.join(this.packageRoot, 'skills', 'bdfl-plan', 'references', 'plan-format.md'), 'utf8')
    ].join('\n\n');
  }
  providerBridge(session) {
    if (session.role === 'direct' || session.sessionType === 'direct') return {};
    if (!this.bridge) {
      if (this.requireBridge) throw new Error('Required BDFL MCP bridge is unavailable');
      return {};
    }
    if (this.bridge.error) throw new Error(`Required BDFL MCP bridge failed: ${this.bridge.error.message}`);
    const scope = this.bridge.issue({
      sessionId: session.id,
      workstreamId: session.workstreamId,
      role: session.role,
      executionId: session.executionId || null,
      chunkId: session.chunkId || null
    });
    const sessionRoot = this.rootFor(session);
    const descriptor = path.join(sessionRoot, '.bdfl', 'sessions', session.id, 'capability.json');
    atomicWrite(descriptor, `${JSON.stringify(scope, null, 2)}\n`, this.io);
    this.io.chmodSync?.(descriptor, 0o600);
    const command = process.execPath;
    const args = [path.join(this.packageRoot, 'bin', 'bdfl-mcp.js'), '--descriptor', descriptor];
    const tools = session.role === 'delegator' ? ['bdfl_plan', 'bdfl_workers'] : ['bdfl_workers'];
    if (codexRuntime(session.profile.provider))
      return {
        bridge: { command, args, tools },
        instructions: session.role === 'delegator' ? this.instructions() : session.roleInstruction || null
      };
    const pluginDirectory = pluginDestination(sessionRoot, session.id);
    this.io.mkdirSync(path.join(pluginDirectory, '.claude-plugin'), { recursive: true });
    if (session.role === 'delegator')
      this.io.cpSync(
        path.join(this.packageRoot, 'skills', 'bdfl-plan'),
        path.join(pluginDirectory, 'skills', 'bdfl-plan'),
        { recursive: true }
      );
    atomicWrite(
      path.join(pluginDirectory, '.claude-plugin', 'plugin.json'),
      `${JSON.stringify({ name: 'bdfl-session', version: '0.1.0', description: 'Session-scoped BDFL delegation bridge' }, null, 2)}\n`,
      this.io
    );
    const mcpConfig = path.join(pluginDirectory, '.mcp.json');
    atomicWrite(
      mcpConfig,
      `${JSON.stringify({ mcpServers: { bdfl: { command, args, env: {} } } }, null, 2)}\n`,
      this.io
    );
    return { pluginDirectory, mcpConfig, allowedTools: tools.map((tool) => `mcp__bdfl__${tool}`) };
  }
  admissionLabels(streamId, extra = null) {
    const state = this.store.load();
    const labels = state.sessions
      .filter((session) => session.workstreamId === streamId && this.isOpen(session.id))
      .map((session) => agentLabel(session));
    if (extra) labels.push(agentLabel(extra));
    return labels;
  }
  canOpen(session, automatic = false) {
    const columns = this.tmux.narrowestClientWidth();
    const opening = { ...session, status: 'running', turnState: 'working' };
    const windows = this.tmux.windows();
    const liveWorkstreams = new Set(windows.map((window) => window.workstreamId).filter(Boolean));
    const state = this.store.load();
    const stream = state.workstreams.find((item) => item.id === session.workstreamId);
    const windowLabels = state.workstreams.filter((item) => liveWorkstreams.has(item.id)).map((item) => item.name);
    if (!liveWorkstreams.has(session.workstreamId) && stream) windowLabels.push(stream.name);
    if (fitsRail(windowLabels, columns) && fitsRail(this.admissionLabels(session.workstreamId, opening), columns))
      return true;
    if (automatic) {
      this.store.update((value) => {
        const current = value.sessions.find((item) => item.id === session.id);
        if (current && !current.waitingForRail) {
          current.waitingForRail = true;
          current.waitingReason = 'Waiting for rail space';
          current.turnState = 'idle';
        }
        return value;
      });
    } else
      this.tmux.message('BDFL: close an agent or session, or widen the narrowest client before opening another agent');
    return false;
  }
  invocation(session) {
    const bridge = this.providerBridge(session);
    const resume = Boolean(session.providerSessionId && session.providerSessionReady !== false);
    const direct = session.role === 'direct' || session.sessionType === 'direct';
    return buildLaunch(session.profile, {
      role: session.role,
      permissionMode: direct
        ? 'workspace-write'
        : session.role === 'delegator' || session.role === 'verifier'
          ? 'read-only'
          : session.profile.permissionMode,
      dangerous: this.dangerous,
      cwd: session.worktree || this.rootFor(session),
      ...bridge,
      roleInstruction: direct
        ? null
        : session.role === 'delegator' && !resume && this.bridge
          ? ROLE
          : session.roleInstruction,
      resume,
      sessionId: session.providerSessionId
    });
  }
  claimedProviderIds() {
    return new Set(
      this.store
        .load()
        .sessions.map((session) => session.providerSessionId)
        .filter(Boolean)
    );
  }
  pollCodexIndex() {
    this.codexTimer = null;
    if (!this.codexPending.size) return;
    const claimed = this.claimedProviderIds();
    const indexed = this.codexIndex.refresh();
    for (const [sessionId, pending] of this.codexPending) {
      const match = indexed.find(
        (item) =>
          item.cwd === path.resolve(pending.cwd) && item.created >= pending.launchedAt - 2000 && !claimed.has(item.id)
      );
      if (!match) continue;
      claimed.add(match.id);
      this.store.update((value) => {
        const session = value.sessions.find((item) => item.id === sessionId);
        if (session && !session.providerSessionId) {
          session.providerSessionId = match.id;
          session.providerSessionReady = true;
        }
        return value;
      });
      this.codexPending.delete(sessionId);
    }
    if (this.codexPending.size) {
      this.codexTimer = this.schedule(() => this.pollCodexIndex(), 500);
      this.codexTimer.unref?.();
    }
  }
  captureCodexIdentity(session, invocation, launchedAt) {
    if (!codexRuntime(session.profile.provider) || session.providerSessionId) return;
    this.codexPending.set(session.id, { cwd: invocation.cwd, launchedAt });
    if (!this.codexTimer) {
      this.codexTimer = this.schedule(() => this.pollCodexIndex(), 100);
      this.codexTimer.unref?.();
    }
  }
  restartForBridge(sessionId) {
    const session = this.session(sessionId);
    if (!session || session.role === 'direct' || session.sessionType === 'direct') return false;
    return this.restart(sessionId);
  }
  restart(sessionId) {
    const session = this.session(sessionId);
    if (!session) return false;
    const owner = session.lifecycleOwner || 'managed';
    this.snapshot(sessionId);
    this.tmux.killPane(sessionId);
    this.openSessions.delete(sessionId);
    return Boolean(
      this.open(sessionId, { lifecycleOwner: owner, automatic: owner === 'managed', bypassAdmission: true })
    );
  }
  open(sessionId, { automatic, lifecycleOwner, bypassAdmission = false } = {}) {
    let session = this.session(sessionId);
    if (!session) throw new Error(`Unknown session: ${sessionId}`);
    lifecycleOwner ||= ['worker', 'verifier', 'integration'].includes(session.role) ? 'managed' : 'user';
    automatic ??= lifecycleOwner === 'managed';
    if (this.isOpen(sessionId)) return session;
    if (!bypassAdmission && !this.canOpen(session, automatic)) return null;
    if (session.profile.provider === 'claude' && !session.providerSessionId) {
      const providerSessionId = crypto.randomUUID();
      this.store.update((value) => {
        const current = value.sessions.find((item) => item.id === sessionId);
        current.providerSessionId = providerSessionId;
        current.providerSessionReady = false;
        return value;
      });
      session = this.session(sessionId);
    }
    const stream = this.stream(session);
    if (!stream) throw new Error(`Unknown session window: ${session.workstreamId}`);
    const launchedAt = this.now();
    const invocation = this.invocation(session);
    const paneId = this.tmux.openPane(stream, session, invocation);
    this.captureCodexIdentity(session, invocation, launchedAt);
    this.openSessions.add(sessionId);
    this.store.update((value) => {
      const current = value.sessions.find((item) => item.id === sessionId);
      current.status = 'running';
      current.explicitlyClosed = false;
      current.lifecycleOwner = lifecycleOwner;
      current.turnState = 'working';
      current.turnStateReason = 'provider launched';
      current.paneId = paneId;
      current.launchedAt = new Date(launchedAt).toISOString();
      delete current.waitingForRail;
      delete current.waitingReason;
      return value;
    });
    this.tmux.setLabel(paneId, this.session(sessionId));
    return this.session(sessionId);
  }
  markOutput(sessionId) {
    if (!this.session(sessionId)) return;
    this.store.update((value) => {
      const session = value.sessions.find((item) => item.id === sessionId);
      session.activityAt = new Date(this.now()).toISOString();
      if (session.profile.provider === 'claude' && session.providerSessionId) session.providerSessionReady = true;
      if (session.status === 'running') {
        session.turnState = 'working';
        session.turnStateReason = 'provider output';
      }
      return value;
    });
    this.onActivity?.(sessionId, true);
    this.onOutput?.(sessionId);
  }
  markIdle(sessionId, reason = 'provider completed') {
    if (!this.session(sessionId)) return;
    this.store.update((value) => {
      const session = value.sessions.find((item) => item.id === sessionId);
      session.turnState = 'idle';
      session.turnStateReason = reason;
      return value;
    });
    const pane = this.tmux.paneFor(sessionId);
    if (pane) this.tmux.setLabel(pane.paneId, this.session(sessionId));
    this.onActivity?.(sessionId, false);
  }
  paneExited(sessionId, code = 0) {
    this.openSessions.delete(sessionId);
    if (!this.session(sessionId)) return;
    this.store.update((value) => {
      const session = value.sessions.find((item) => item.id === sessionId);
      session.status = code ? 'failed' : 'exited';
      session.exitCode = code;
      session.turnState = 'idle';
      session.turnStateReason = 'provider exited';
      return value;
    });
    this.onExit?.(sessionId, code);
  }
  isOpen(sessionId) {
    const pane = this.tmux.paneFor(sessionId);
    return Boolean(pane && pane.dead !== '1');
  }
  isActive(sessionId) {
    return this.session(sessionId)?.turnState === 'working';
  }
  activityState(sessionId) {
    return this.isActive(sessionId) ? 'running' : 'idle';
  }
  focus(sessionId) {
    const focused = this.tmux.focus(sessionId);
    if (focused) this.store.markSessionViewed?.(sessionId);
    return focused;
  }
  view(sessionId) {
    return this.focus(sessionId);
  }
  snapshot(sessionId) {
    const session = this.session(sessionId);
    if (!session) return null;
    const file = path.join(this.rootFor(session), '.bdfl', 'sessions', sessionId, 'terminal.txt');
    return this.tmux.snapshot(sessionId, file);
  }
  screen(sessionId, rows = 24) {
    const file = this.snapshot(sessionId);
    if (!file) return [];
    try {
      return this.io.readFileSync(file, 'utf8').replace(/\n$/u, '').split('\n').slice(-rows);
    } catch {
      return [];
    }
  }
  presentation(sessionId, rows) {
    return { lines: this.screen(sessionId, rows), cursor: null };
  }
  close(sessionId, explicit = true) {
    const session = this.session(sessionId);
    if (!session) return false;
    this.snapshot(sessionId);
    this.tmux.killPane(sessionId);
    this.openSessions.delete(sessionId);
    this.store.update((value) => {
      const current = value.sessions.find((item) => item.id === sessionId);
      current.status = explicit ? 'paused' : 'closed';
      current.explicitlyClosed = explicit;
      current.turnState = 'idle';
      current.turnStateReason = explicit ? 'paused by user' : 'closed by supervisor';
      if (explicit) current.lifecycleOwner = 'user';
      return value;
    });
    return true;
  }
  pause(sessionId) {
    return this.close(sessionId, true);
  }
  resume(sessionId, options = {}) {
    return this.open(sessionId, { ...options, lifecycleOwner: 'user' });
  }
  delete(sessionId) {
    this.close(sessionId, false);
    if (this.store.deleteSession) this.store.deleteSession(sessionId);
    else
      this.store.update((value) => {
        value.sessions = value.sessions.filter((session) => session.id !== sessionId);
        return value;
      });
    return true;
  }
  restore() {
    const state = this.store.load();
    const live = new Set(
      this.tmux
        .panes()
        .filter((pane) => pane.dead !== '1')
        .map((pane) => pane.sessionId)
    );
    const restored = [];
    const errors = [];
    for (const session of state.sessions) {
      if (live.has(session.id)) {
        this.openSessions.add(session.id);
        restored.push(session.id);
        if (session.turnState === 'working' && session.status !== 'running') this.markIdle(session.id, 'restored');
      } else if (session.status === 'running' && !session.explicitlyClosed) {
        try {
          if (
            this.open(session.id, {
              lifecycleOwner: session.lifecycleOwner,
              automatic: session.lifecycleOwner === 'managed',
              bypassAdmission: true
            })
          )
            restored.push(session.id);
        } catch (error) {
          errors.push({ sessionId: session.id, error });
          this.store.update((value) => {
            const current = value.sessions.find((item) => item.id === session.id);
            if (current) {
              current.status = 'failed';
              current.turnState = 'idle';
              current.turnStateReason = `restore failed: ${error.message}`;
            }
            return value;
          });
        }
      } else if (session.turnState === 'working') this.markIdle(session.id, 'restored without a live pane');
    }
    restored.errors = errors;
    return restored;
  }
  resize() {
    for (const window of this.tmux.windows())
      this.tmux.command.tryRun(['select-layout', '-t', window.windowId, 'tiled']);
  }
  write(sessionId, value) {
    const pane = this.tmux.paneFor(sessionId);
    if (!pane) return false;
    this.tmux.command.run(['send-keys', '-t', pane.paneId, '-l', `${value}`]);
    return true;
  }
  acknowledgeAttention(sessionId) {
    this.store.setSessionAttention?.(sessionId, false);
  }
  notifyAttention(sessionId) {
    this.store.setSessionAttention?.(sessionId, true);
    this.onAttention?.(sessionId);
  }
  continueWhenReady(sessionId, prompt) {
    if (!this.isOpen(sessionId)) this.resume(sessionId);
    this.write(sessionId, prompt);
    this.tmux.command.run(['send-keys', '-t', this.tmux.paneFor(sessionId).paneId, 'Enter']);
    return true;
  }
  shutdown() {
    if (this.codexTimer) this.cancel(this.codexTimer);
    this.codexTimer = null;
    this.codexPending.clear();
    for (const session of this.store.load().sessions) if (this.isOpen(session.id)) this.snapshot(session.id);
  }
}

module.exports = { SessionManager, substantivePlanningPrompt };
