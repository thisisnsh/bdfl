'use strict';

const fs = require('node:fs'); const path = require('node:path'); const crypto = require('node:crypto');
const { atomicWrite } = require('../core/plans'); const { validateWorkstreamConfig } = require('../core/profiles');

function defaultWorkspace() { return { schema: 1, workstreams: [], sessions: [], activeWorkstreamId: null, nextPaneNumber: 1 }; }

class WorkspaceStore {
  constructor(root, { io = fs, now = () => new Date(), id = () => crypto.randomUUID() } = {}) { this.root = path.resolve(root); this.io = io; this.now = now; this.id = id; this.directory = path.join(this.root, '.bdfl'); this.file = path.join(this.directory, 'workspace.json'); this.events = path.join(this.directory, 'events.ndjson'); }
  load() { if (!this.io.existsSync(this.file)) return defaultWorkspace(); const value = JSON.parse(this.io.readFileSync(this.file, 'utf8')); if (value.schema !== 1) { const error = new Error('Previous unreleased BDFL state requires reset or export'); error.code = 'RESET_REQUIRED'; throw error; } return value; }
  save(value) { atomicWrite(this.file, `${JSON.stringify(value, null, 2)}\n`, this.io); return value; }
  update(mutator) { const value = this.load(); return this.save(mutator(structuredClone(value)) || value); }
  event(type, data = {}) { this.io.mkdirSync(this.directory, { recursive: true }); this.io.appendFileSync(this.events, `${JSON.stringify({ id: this.id(), type, at: this.now().toISOString(), ...data })}\n`, { mode: 0o600 }); }
  createWorkstream(config, title = path.basename(this.root)) { const validated = validateWorkstreamConfig(config); const workstream = { id: `workstream-${this.id()}`, title, ...validated, status: 'active', createdAt: this.now().toISOString() }; this.update((state) => { state.workstreams.push(workstream); state.activeWorkstreamId ||= workstream.id; return state; }); this.event('workstream.created', { workstreamId: workstream.id }); return workstream; }
  setCapacity(id, capacity) { if (!Number.isInteger(capacity) || capacity < 1 || capacity > 5) throw new Error('Worker capacity must be an integer from 1 to 5'); let active = 0; const state = this.update((value) => { const stream = value.workstreams.find((item) => item.id === id); if (!stream) throw new Error(`Unknown workstream: ${id}`); stream.workerCapacity = capacity; active = value.sessions.filter((session) => session.workstreamId === id && session.role !== 'delegator' && session.status === 'running').length; return value; }); this.event('workstream.capacity', { workstreamId: id, capacity, active }); return { workstream: state.workstreams.find((item) => item.id === id), active, canStart: Math.max(0, capacity - active) }; }
  createSession(workstreamId, role, profile, fields = {}) { let session; this.update((state) => { const stream = state.workstreams.find((item) => item.id === workstreamId); if (!stream) throw new Error(`Unknown workstream: ${workstreamId}`); session = { id: `session-${this.id()}`, workstreamId, role, paneNumber: state.nextPaneNumber++, profile: structuredClone(profile), status: 'closed', explicitlyClosed: false, createdAt: this.now().toISOString(), ...fields }; state.sessions.push(session); return state; }); this.event('session.created', { sessionId: session.id, workstreamId, role }); return session; }
}

module.exports = { WorkspaceStore, defaultWorkspace };
