'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { atomicWrite } = require('../core/plans');
const { validateProfile, validateWorkstreamConfig } = require('../core/profiles');

const WORKSPACE_SCHEMA = 2;
const RESET_MESSAGE =
  "BDFL development state uses an older schema. Stop BDFL, remove this repository's .bdfl/ directory, and start again.";
const INVALID_STATE_MESSAGE = 'BDFL durable state contains an invalid record and was not changed';

function defaultWorkspace() {
  return { schema: WORKSPACE_SCHEMA, workstreams: [], sessions: [], activeWorkstreamId: null, nextPaneNumber: 1 };
}
function printable(value) {
  return typeof value === 'string' && !/[\u0000-\u001f\u007f-\u009f]/u.test(value);
}
function characters(value) {
  return [...value];
}
function normalizeTaskSnippet(value) {
  if (value === null || value === undefined) return null;
  const normalized = `${value}`
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
  if (!normalized) return null;
  return characters(normalized).slice(0, 200).join('').trim();
}
function planningProviderName(provider) {
  if (provider === 'claude') return 'Claude';
  if (provider === 'codex') return 'Codex';
  const value = `${provider || 'Agent'}`;
  return value ? `${value[0].toUpperCase()}${value.slice(1)}` : 'Agent';
}
function validTimestamp(value) {
  return value === undefined || (typeof value === 'string' && Number.isFinite(Date.parse(value)));
}
function validName(value) {
  return printable(value) && value === value.trim() && Boolean(value) && characters(value).length <= 24;
}
function validateSessionRecord(session) {
  if (
    !session ||
    !validName(session.name) ||
    !Number.isInteger(session.roleSequence) ||
    session.roleSequence < 1 ||
    !(
      session.taskSnippet === null ||
      (printable(session.taskSnippet) &&
        characters(session.taskSnippet).length <= 200 &&
        session.taskSnippet === normalizeTaskSnippet(session.taskSnippet))
    )
  )
    throw new Error(`Invalid session metadata${session?.id ? ` for ${session.id}` : ''}`);
  if (
    !['planning', 'direct'].includes(session.sessionType || 'planning') ||
    (session.role === 'direct' && session.sessionType !== 'direct')
  )
    throw new Error(`Invalid session type${session?.id ? ` for ${session.id}` : ''}`);
  if (!['activityAt', 'viewedAt', 'pausedAt', 'resumedAt'].every((field) => validTimestamp(session[field])))
    throw new Error(`Invalid session timestamp${session?.id ? ` for ${session.id}` : ''}`);
  if (
    (session.turnState !== undefined && !['working', 'idle'].includes(session.turnState)) ||
    (session.turnStateReason !== undefined && !printable(session.turnStateReason)) ||
    (session.lifecycleOwner !== undefined && !['managed', 'user'].includes(session.lifecycleOwner))
  )
    throw new Error(`Invalid session turn state${session?.id ? ` for ${session.id}` : ''}`);
}

function historicalSession(session) {
  return Boolean(
    session.accepted ||
    session.completed ||
    session.superseded ||
    ['accepted', 'cancelled', 'complete', 'completed', 'done', 'integrated', 'rejected', 'superseded'].includes(
      session.status
    )
  );
}

class WorkspaceStore {
  constructor(root, { io = fs, now = () => new Date(), id = () => crypto.randomUUID() } = {}) {
    this.root = path.resolve(root);
    this.io = io;
    this.now = now;
    this.id = id;
    this.directory = path.join(this.root, '.bdfl');
    this.file = path.join(this.directory, 'workspace.json');
    this.configFile = path.join(this.directory, 'config.json');
    this.events = path.join(this.directory, 'events.ndjson');
  }
  load() {
    if (!this.io.existsSync(this.file)) return defaultWorkspace();
    const value = JSON.parse(this.io.readFileSync(this.file, 'utf8'));
    if (value.schema !== WORKSPACE_SCHEMA) {
      const error = new Error(RESET_MESSAGE);
      error.code = 'RESET_REQUIRED';
      throw error;
    }
    try {
      for (const stream of value.workstreams || []) {
        stream.sessionType ||= 'planning';
        validateWorkstreamConfig({ ...stream, version: 1 });
      }
      for (const session of value.sessions || []) {
        const stream = value.workstreams.find((item) => item.id === session.workstreamId);
        session.sessionType ||= stream?.sessionType || 'planning';
        session.lifecycleOwner ||=
          ['worker', 'verifier', 'integration'].includes(session.role) && !session.explicitlyClosed
            ? 'managed'
            : 'user';
        session.taskSnippet = normalizeTaskSnippet(session.taskSnippet);
        validateSessionRecord(session);
      }
      for (const stream of value.workstreams || []) {
        const sessions = value.sessions.filter((session) => session.workstreamId === stream.id);
        const primary = sessions.find((session) => ['delegator', 'direct'].includes(session.role));
        stream.name ||=
          primary?.name ||
          `${planningProviderName((stream.sessionType === 'direct' ? stream.directProfile : stream.delegatorProfile)?.provider)} ${stream.providerSequence || 1}`;
        if (!validName(stream.name)) throw new Error(`Invalid workstream name for ${stream.id}`);
        const current = sessions.filter((session) => !historicalSession(session));
        const names = current.map((session) => session.name.toLocaleLowerCase());
        const sequences = current.map((session) => `${session.role}:${session.roleSequence}`);
        if (new Set(names).size !== names.length || new Set(sequences).size !== sequences.length)
          throw new Error('Duplicate agent metadata');
      }
    } catch (cause) {
      const error = new Error(`${INVALID_STATE_MESSAGE}: ${cause.message}`, { cause });
      error.code = 'STATE_INVALID';
      throw error;
    }
    return value;
  }
  loadConfig() {
    if (!this.io.existsSync(this.configFile)) return null;
    const value = JSON.parse(this.io.readFileSync(this.configFile, 'utf8'));
    if (value.schema !== WORKSPACE_SCHEMA) {
      const error = new Error(RESET_MESSAGE);
      error.code = 'RESET_REQUIRED';
      throw error;
    }
    try {
      const result = { version: 1 };
      if (value.profiles?.delegator || value.profiles?.worker || value.workerCapacity !== undefined)
        Object.assign(
          result,
          validateWorkstreamConfig({
            version: 1,
            sessionType: 'planning',
            delegatorProfile: value.profiles?.delegator,
            workerProfile: value.profiles?.worker,
            workerCapacity: value.workerCapacity
          })
        );
      if (value.profiles?.direct) result.directProfile = validateProfile(value.profiles.direct, { worker: true });
      return Object.keys(result).length > 1 ? result : null;
    } catch (cause) {
      const error = new Error(`${INVALID_STATE_MESSAGE}: ${cause.message}`, { cause });
      error.code = 'STATE_INVALID';
      throw error;
    }
  }
  activateWorkstream(id) {
    return this.update((state) => {
      if (!state.workstreams.some((stream) => stream.id === id && stream.status !== 'closed'))
        throw new Error(`Unknown active session: ${id}`);
      state.activeWorkstreamId = id;
      return state;
    });
  }
  save(value) {
    atomicWrite(this.file, `${JSON.stringify(value, null, 2)}\n`, this.io);
    return value;
  }
  update(mutator) {
    const value = this.load();
    return this.save(mutator(structuredClone(value)) || value);
  }
  event(type, data = {}) {
    this.io.mkdirSync(this.directory, { recursive: true });
    this.io.appendFileSync(
      this.events,
      `${JSON.stringify({ id: this.id(), type, at: this.now().toISOString(), ...data })}\n`,
      { mode: 0o600 }
    );
  }
  createWorkstream(config, title = path.basename(this.root)) {
    const validated = validateWorkstreamConfig(config);
    let workstream;
    this.update((state) => {
      const profile = validated.sessionType === 'direct' ? validated.directProfile : validated.delegatorProfile;
      const provider = profile.provider;
      const providerSequence =
        Math.max(
          0,
          ...state.workstreams.map((item, index) => {
            const candidateProfile = item.sessionType === 'direct' ? item.directProfile : item.delegatorProfile;
            return candidateProfile?.provider === provider
              ? item.providerSequence ||
                  state.workstreams
                    .slice(0, index + 1)
                    .filter(
                      (candidate) =>
                        (candidate.sessionType === 'direct' ? candidate.directProfile : candidate.delegatorProfile)
                          ?.provider === provider
                    ).length
              : 0;
          })
        ) + 1;
      const createdAt = this.now().toISOString();
      workstream = {
        id: `workstream-${this.id()}`,
        name: `${planningProviderName(provider)} ${providerSequence}`,
        title,
        ...validated,
        providerSequence,
        status: 'active',
        createdAt,
        updatedAt: createdAt
      };
      state.workstreams.push(workstream);
      state.activeWorkstreamId = workstream.id;
      return state;
    });
    let saved = { schema: WORKSPACE_SCHEMA, profiles: {} };
    if (this.io.existsSync(this.configFile)) {
      saved = JSON.parse(this.io.readFileSync(this.configFile, 'utf8'));
      if (saved.schema !== WORKSPACE_SCHEMA) {
        const error = new Error(RESET_MESSAGE);
        error.code = 'RESET_REQUIRED';
        throw error;
      }
      saved.profiles ||= {};
    }
    if (validated.sessionType === 'direct') saved.profiles.direct = validated.directProfile;
    else {
      saved.profiles.delegator = validated.delegatorProfile;
      saved.profiles.worker = validated.workerProfile;
      saved.workerCapacity = validated.workerCapacity;
    }
    atomicWrite(this.configFile, `${JSON.stringify(saved, null, 2)}\n`, this.io);
    this.event('workstream.created', { workstreamId: workstream.id, sessionType: validated.sessionType });
    return workstream;
  }
  setCapacity(id, capacity) {
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 5)
      throw new Error('Worker capacity must be an integer from 1 to 5');
    let active = 0;
    const state = this.update((value) => {
      const stream = value.workstreams.find((item) => item.id === id);
      if (!stream) throw new Error(`Unknown session: ${id}`);
      stream.workerCapacity = capacity;
      stream.updatedAt = this.now().toISOString();
      active = value.sessions.filter(
        (session) => session.workstreamId === id && session.role !== 'delegator' && session.status === 'running'
      ).length;
      return value;
    });
    this.event('workstream.capacity', { workstreamId: id, capacity, active });
    return {
      workstream: state.workstreams.find((item) => item.id === id),
      active,
      canStart: Math.max(0, capacity - active)
    };
  }
  closeWorkstream(id) {
    const state = this.update((value) => {
      const stream = value.workstreams.find((item) => item.id === id);
      if (!stream) throw new Error(`Unknown workstream: ${id}`);
      const updatedAt = this.now().toISOString();
      stream.status = 'closed';
      stream.updatedAt = updatedAt;
      for (const session of value.sessions.filter((item) => item.workstreamId === id)) {
        session.status = 'closed';
        session.explicitlyClosed = true;
        session.updatedAt = updatedAt;
        delete session.pid;
      }
      if (value.activeWorkstreamId === id)
        value.activeWorkstreamId = value.workstreams.find((item) => item.status !== 'closed')?.id || null;
      return value;
    });
    this.event('workstream.closed', { workstreamId: id });
    return state.workstreams.find((item) => item.id === id);
  }
  reopenWorkstream(id) {
    const state = this.update((value) => {
      const stream = value.workstreams.find((item) => item.id === id);
      if (!stream) throw new Error(`Unknown workstream: ${id}`);
      const updatedAt = this.now().toISOString();
      stream.status = 'active';
      stream.updatedAt = updatedAt;
      for (const session of value.sessions.filter((item) => item.workstreamId === id)) {
        session.explicitlyClosed = false;
        session.updatedAt = updatedAt;
      }
      value.activeWorkstreamId = id;
      return value;
    });
    this.event('workstream.reopened', { workstreamId: id });
    return state.workstreams.find((item) => item.id === id);
  }
  deleteWorkstream(id) {
    const state = this.update((value) => {
      if (!value.workstreams.some((item) => item.id === id)) throw new Error(`Unknown workstream: ${id}`);
      value.workstreams = value.workstreams.filter((item) => item.id !== id);
      value.sessions = value.sessions.filter((item) => item.workstreamId !== id);
      if (value.activeWorkstreamId === id)
        value.activeWorkstreamId = value.workstreams.find((item) => item.status !== 'closed')?.id || null;
      return value;
    });
    this.event('workstream.deleted', { workstreamId: id });
    return state;
  }
  deleteSession(id) {
    const state = this.update((value) => {
      if (!value.sessions.some((item) => item.id === id)) throw new Error(`Unknown session: ${id}`);
      value.sessions = value.sessions.filter((item) => item.id !== id);
      return value;
    });
    this.event('session.deleted', { sessionId: id });
    return state;
  }
  deleteAllWorkstreams() {
    let workstreams = 0;
    let sessions = 0;
    this.update((value) => {
      workstreams = value.workstreams.length;
      sessions = value.sessions.length;
      value.workstreams = [];
      value.sessions = [];
      value.activeWorkstreamId = null;
      value.nextPaneNumber = 1;
      return value;
    });
    this.event('workstreams.deleted', { workstreams, sessions });
    return { workstreams, sessions };
  }
  createSession(workstreamId, role, profile, fields = {}) {
    let session;
    this.update((state) => {
      const stream = state.workstreams.find((item) => item.id === workstreamId);
      if (!stream) throw new Error(`Unknown workstream: ${workstreamId}`);
      if (stream.sessionType === 'direct' && role !== 'direct')
        throw new Error('Direct workstreams require a direct primary session');
      if (stream.sessionType !== 'direct' && role === 'direct')
        throw new Error('Direct sessions require a direct workstream');
      const siblings = state.sessions.filter((item) => item.workstreamId === workstreamId);
      const paneNumber = Math.max(
        stream.nextPaneNumber || 1,
        Math.max(0, ...siblings.map((item) => item.paneNumber || 0)) + 1
      );
      stream.nextRoleSequence ||= {};
      const roleSequence =
        role === 'delegator' || role === 'direct'
          ? stream.providerSequence
          : Math.max(
              stream.nextRoleSequence[role] || 1,
              Math.max(0, ...siblings.filter((item) => item.role === role).map((item) => item.roleSequence || 0)) + 1
            );
      const defaultName =
        role === 'delegator' || role === 'direct'
          ? `${planningProviderName(profile?.provider)} ${roleSequence}`
          : role === 'worker'
            ? `Worker ${roleSequence}`
            : `${planningProviderName(role)} ${roleSequence}`;
      const createdAt = this.now().toISOString();
      session = {
        ...fields,
        id: `session-${this.id()}`,
        workstreamId,
        sessionType: stream.sessionType || 'planning',
        role,
        paneNumber,
        roleSequence,
        name: fields.name || defaultName,
        taskSnippet: normalizeTaskSnippet(fields.taskSnippet),
        profile: structuredClone(profile),
        status: fields.status || 'closed',
        explicitlyClosed: Boolean(fields.explicitlyClosed),
        lifecycleOwner:
          fields.lifecycleOwner || (['worker', 'verifier', 'integration'].includes(role) ? 'managed' : 'user'),
        createdAt,
        updatedAt: createdAt
      };
      validateSessionRecord(session);
      if (siblings.some((item) => item.name.toLocaleLowerCase() === session.name.toLocaleLowerCase()))
        throw new Error('Agent names must be unique within this session');
      stream.updatedAt = session.updatedAt;
      stream.nextPaneNumber = paneNumber + 1;
      if (role !== 'delegator' && role !== 'direct') stream.nextRoleSequence[role] = roleSequence + 1;
      state.sessions.push(session);
      state.nextPaneNumber = Math.max(state.nextPaneNumber || 1, paneNumber + 1);
      return state;
    });
    this.event('session.created', { sessionId: session.id, workstreamId, role, sessionType: session.sessionType });
    return session;
  }
  renameWorkstream(id, name) {
    if (!validName(name)) throw new Error('Session names must be 1–24 printable characters');
    const state = this.update((value) => {
      const stream = value.workstreams.find((item) => item.id === id);
      if (!stream) throw new Error(`Unknown workstream: ${id}`);
      if (
        value.workstreams.some((item) => item.id !== id && item.name.toLocaleLowerCase() === name.toLocaleLowerCase())
      )
        throw new Error('Session names must be unique');
      stream.name = name;
      stream.updatedAt = this.now().toISOString();
      return value;
    });
    this.event('workstream.renamed', { workstreamId: id });
    return state.workstreams.find((item) => item.id === id);
  }
  setSessionTaskSnippet(id, input) {
    const taskSnippet = normalizeTaskSnippet(input);
    const state = this.update((value) => {
      const session = value.sessions.find((item) => item.id === id);
      if (!session) throw new Error(`Unknown session: ${id}`);
      session.taskSnippet = taskSnippet;
      session.updatedAt = this.now().toISOString();
      const stream = value.workstreams.find((item) => item.id === session.workstreamId);
      if (stream) stream.updatedAt = session.updatedAt;
      return value;
    });
    return state.sessions.find((item) => item.id === id);
  }
  setSessionAttention(id, attention) {
    const value = this.load();
    const session = value.sessions.find((item) => item.id === id);
    if (!session) throw new Error(`Unknown session: ${id}`);
    const next = Boolean(attention);
    if (Boolean(session.attention) === next) return value;
    session.attention = next;
    return this.save(value);
  }
  setSessionTurnState(id, turnState, reason = null) {
    if (!['working', 'idle'].includes(turnState)) throw new Error('Session turn state must be working or idle');
    if (reason !== null && !printable(reason)) throw new Error('Session turn-state reason must be printable');
    const value = this.load();
    const session = value.sessions.find((item) => item.id === id);
    if (!session) throw new Error(`Unknown session: ${id}`);
    const nextReason = reason === null ? undefined : `${reason}`;
    if (session.turnState === turnState && session.turnStateReason === nextReason) return value;
    session.turnState = turnState;
    if (nextReason === undefined) delete session.turnStateReason;
    else session.turnStateReason = nextReason;
    session.turnStateAt = this.now().toISOString();
    return this.save(value);
  }
  markSessionViewed(id) {
    const state = this.update((value) => {
      const session = value.sessions.find((item) => item.id === id);
      if (!session) throw new Error(`Unknown session: ${id}`);
      session.viewedAt = this.now().toISOString();
      return value;
    });
    return state.sessions.find((item) => item.id === id);
  }
  viewSession(id) {
    return this.markSessionViewed(id);
  }
  pauseSession(id) {
    let changed = false;
    const state = this.update((value) => {
      const session = value.sessions.find((item) => item.id === id);
      if (!session) throw new Error(`Unknown session: ${id}`);
      if (session.status === 'paused' && session.explicitlyClosed) return value;
      const updatedAt = this.now().toISOString();
      session.status = 'paused';
      session.explicitlyClosed = true;
      session.pausedAt = updatedAt;
      session.updatedAt = updatedAt;
      delete session.pid;
      changed = true;
      return value;
    });
    if (changed) this.event('session.paused', { sessionId: id });
    return state.sessions.find((item) => item.id === id);
  }
  resumeSession(id) {
    let changed = false;
    const state = this.update((value) => {
      const session = value.sessions.find((item) => item.id === id);
      if (!session) throw new Error(`Unknown session: ${id}`);
      const stream = value.workstreams.find((item) => item.id === session.workstreamId);
      if (!stream || stream.status === 'closed') throw new Error(`Cannot resume session in a closed workstream: ${id}`);
      if (!session.explicitlyClosed && session.status !== 'paused') return value;
      const updatedAt = this.now().toISOString();
      session.status = 'closed';
      session.explicitlyClosed = false;
      session.resumedAt = updatedAt;
      session.updatedAt = updatedAt;
      delete session.pid;
      changed = true;
      return value;
    });
    if (changed) this.event('session.resumed', { sessionId: id });
    return state.sessions.find((item) => item.id === id);
  }
  touchSession(id, activity = false) {
    return this.update((state) => {
      const session = state.sessions.find((item) => item.id === id);
      if (!session) throw new Error(`Unknown session: ${id}`);
      const options = activity && typeof activity === 'object' ? activity : { conversation: activity };
      const updatedAt = options.at === undefined ? this.now().toISOString() : new Date(options.at).toISOString();
      session.activityAt = updatedAt;
      session.updatedAt = updatedAt;
      if (options.conversation) session.conversationAt = updatedAt;
      const stream = state.workstreams.find((item) => item.id === session.workstreamId);
      if (stream) stream.updatedAt = updatedAt;
      return state;
    });
  }
}

module.exports = {
  WORKSPACE_SCHEMA,
  RESET_MESSAGE,
  INVALID_STATE_MESSAGE,
  WorkspaceStore,
  defaultWorkspace,
  normalizeTaskSnippet,
  planningProviderName
};
