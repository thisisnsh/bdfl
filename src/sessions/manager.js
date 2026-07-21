'use strict';

const fs = require('node:fs'); const path = require('node:path');
const { buildLaunch, skillDestination } = require('../providers/adapters');

class SessionManager {
  constructor(root, store, { pty = null, io = fs, packageRoot = path.resolve(__dirname, '../..') } = {}) { this.root = path.resolve(root); this.store = store; this.pty = pty || require('node-pty'); this.io = io; this.packageRoot = packageRoot; this.processes = new Map(); }
  injectSkill(session) { const destination = skillDestination(this.root, session.profile.provider, session.id); this.io.mkdirSync(path.dirname(destination), { recursive: true }); this.io.cpSync(path.join(this.packageRoot, 'skills', 'bdfl-plan'), destination, { recursive: true }); return destination; }
  open(sessionId, { columns = 80, rows = 24 } = {}) { const state = this.store.load(); const session = state.sessions.find((item) => item.id === sessionId); if (!session) throw new Error(`Unknown session: ${sessionId}`); if (this.processes.has(sessionId)) return session; const skillDirectory = session.role === 'delegator' ? this.injectSkill(session) : null; const invocation = buildLaunch(session.profile, { role: session.role, permissionMode: session.role === 'delegator' ? 'read-only' : session.profile.permissionMode, cwd: session.worktree || this.root, skillDirectory, resume: Boolean(session.providerSessionId), sessionId: session.providerSessionId }); const child = this.pty.spawn(invocation.command, invocation.args, { cwd: invocation.cwd, env: { ...process.env, ...invocation.env }, cols: columns, rows }); this.processes.set(sessionId, child); this.store.update((value) => { const current = value.sessions.find((item) => item.id === sessionId); current.status = 'running'; current.explicitlyClosed = false; current.pid = child.pid; current.launchProfile = structuredClone(session.profile); return value; }); child.onExit?.(({ exitCode, signal }) => { this.processes.delete(sessionId); this.store.update((value) => { const current = value.sessions.find((item) => item.id === sessionId); if (current) { current.status = 'closed'; current.exitCode = exitCode; current.signal = signal; delete current.pid; } return value; }); }); return session; }
  close(sessionId, explicit = true) { const child = this.processes.get(sessionId); child?.kill(); this.processes.delete(sessionId); this.store.update((value) => { const session = value.sessions.find((item) => item.id === sessionId); if (!session) throw new Error(`Unknown session: ${sessionId}`); session.status = 'closed'; session.explicitlyClosed = explicit; delete session.pid; return value; }); }
  restore() { return this.store.load().sessions.filter((session) => session.status === 'running' && !session.explicitlyClosed).map((session) => this.open(session.id)); }
  write(sessionId, value) { const child = this.processes.get(sessionId); if (!child) throw new Error(`Session is not running: ${sessionId}`); child.write(value); }
  resize(sessionId, columns, rows) { this.processes.get(sessionId)?.resize(columns, rows); }
}

module.exports = { SessionManager };
