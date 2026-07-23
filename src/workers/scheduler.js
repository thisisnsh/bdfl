'use strict';

const fs = require('node:fs'); const path = require('node:path'); const crypto = require('node:crypto'); const { EventEmitter } = require('node:events');
const { atomicWrite } = require('../core/plans');
const { normalizeTaskSnippet } = require('../state/workspace');

const ACTIVE = new Set(['running', 'waiting']);
const FEEDBACK = new Set(['running', 'waiting', 'review', 'failed']);
const TERMINAL_EXECUTIONS = new Set(['complete', 'cancelled']);

function workerTaskSnippet(source, fallback) {
  const title = source.match(/^##\s+(.+?)\s*$/mu)?.[1]; const outcomeStart = source.match(/^###\s+Outcome\s*$/imu); const outcome = outcomeStart ? source.slice(outcomeStart.index + outcomeStart[0].length).split(/^###\s+/mu)[0] : null;
  const paragraph = outcome?.trim().split(/\n\s*\n/u)[0]?.replace(/\s+/gu, ' ').trim();
  return normalizeTaskSnippet(title && paragraph ? `${title} — ${paragraph}` : fallback) || `${fallback}`;
}

class WorkerScheduler {
  constructor(root, { store, lineage, launcher, validator, worktrees, onAllAccepted, now = () => new Date(), id = () => crypto.randomUUID() } = {}) { this.root = path.resolve(root); this.store = store; this.lineage = lineage; this.launcher = launcher; this.validator = validator; this.worktrees = worktrees; this.onAllAccepted = onAllAccepted; this.now = now; this.id = id; this.emitter = new EventEmitter(); }
  roots() { return this.store?.repositoryRoots?.() || [this.root]; }
  executionFile(id, repository = this.root) { return path.join(repository, '.bdfl', 'executions', id, 'execution.json'); }
  load(id) { for (const repository of this.roots()) { try { return { ...JSON.parse(fs.readFileSync(this.executionFile(id, repository), 'utf8')), repositoryRoot: repository }; } catch {} } throw new Error(`Unknown execution: ${id}`); }
  save(execution) { const repository = execution.repositoryRoot || this.root; const stored = { ...execution }; delete stored.repositoryRoot; atomicWrite(this.executionFile(execution.id, repository), `${JSON.stringify(stored, null, 2)}\n`); this.emitter.emit(execution.id); return execution; }
  list() { return this.roots().flatMap((repository) => { const directory = path.join(repository, '.bdfl', 'executions'); let entries; try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch { return []; } return entries.filter((entry) => entry.isDirectory()).flatMap((entry) => { try { return [{ ...JSON.parse(fs.readFileSync(path.join(directory, entry.name, 'execution.json'), 'utf8')), repositoryRoot: repository }]; } catch { return []; } }); }); }
  freeze(planId, version, workstreamId, baseline = 'HEAD') {
    if (!this.lineage.executable(planId, version)) throw new Error('Execution requires approval of every plan section');
    const executions = this.list(); const existing = executions.find((item) => item.planId === planId && item.version === version && item.workstreamId === workstreamId); if (existing) return { ...existing, duplicate: true };
    const activeLineage = executions.find((item) => item.planId === planId && !TERMINAL_EXECUTIONS.has(item.status)); if (activeLineage) throw new Error(`Plan ${planId} already has active execution ${activeLineage.id}`);
    const manifest = this.lineage.readManifest(planId, version); const workspace = this.store.load(); const stream = workspace.workstreams.find((item) => item.id === workstreamId); if (!stream) throw new Error(`Unknown workstream: ${workstreamId}`); if (manifest.workstreamId && manifest.workstreamId !== workstreamId) throw new Error('Plan belongs to a different workstream');
    const repository = stream.repositoryRoot || this.root; const target = this.worktrees?.target ? this.worktrees.target(repository) : { branch: null, head: baseline }; const frozenBaseline = this.worktrees?.baseline ? this.worktrees.baseline(target.head || baseline, repository) : baseline;
    const id = `execution-${this.id()}`; const execution = { id, schema: 1, planId, version, workstreamId, baseline: frozenBaseline, targetBranch: target.branch, targetHead: target.head || frozenBaseline, integrationHead: frozenBaseline, profile: structuredClone(stream.workerProfile), capacity: stream.workerCapacity, workload: { implementationWorkers: manifest.chunks.length, verifierWorkers: 1, maxConcurrent: stream.workerCapacity }, status: 'running', createdAt: this.now().toISOString(), globalValidation: manifest.globalValidation, chunks: manifest.chunks.map((chunk) => ({ id: chunk.id, order: chunk.order, sha: chunk.sha, paths: chunk.paths, dependsOn: chunk.dependsOn, locks: chunk.locks, checks: chunk.checks || [], status: 'queued', attempts: [] })), events: [] };
    execution.repositoryRoot = repository;
    this.save(execution); this.recalculate(id); return this.load(id);
  }
  active(execution) { return execution.chunks.filter((chunk) => ACTIVE.has(chunk.status)); }
  ancestors(execution, chunk) { const found = new Set(); const visit = (id) => { const current = execution.chunks.find((item) => item.id === id); if (!current) return; for (const dependency of current.dependsOn) visit(dependency); found.add(id); }; for (const dependency of chunk.dependsOn) visit(dependency); return execution.chunks.filter((item) => found.has(item.id)).sort((left, right) => left.order - right.order); }
  resume() { return this.list().filter((execution) => execution.status === 'running').map((execution) => this.recalculate(execution.id)); }
  recalculate(id) {
    const execution = this.load(id); const active = this.active(execution); const held = new Set(active.flatMap((chunk) => chunk.locks)); let slots = Math.max(0, execution.capacity - active.length);
    for (const chunk of execution.chunks) {
      if (!slots || chunk.status !== 'queued') continue;
      if (!chunk.dependsOn.every((dependency) => execution.chunks.find((item) => item.id === dependency)?.status === 'accepted')) continue;
      if (chunk.locks.some((lock) => held.has(lock))) continue;
      const predecessors = this.ancestors(execution, chunk); const commits = predecessors.map((item) => item.commit).filter(Boolean); const base = predecessors.length && this.worktrees?.composeBase ? this.worktrees.composeBase(execution.id, chunk.id, chunk.attempts.length + 1, execution.baseline, predecessors, execution.repositoryRoot) : commits.at(-1) || execution.baseline;
      const attempt = { number: chunk.attempts.length + 1, base, startedAt: this.now().toISOString() }; chunk.attempts.push(attempt); chunk.status = 'running'; chunk.locks.forEach((lock) => held.add(lock)); slots -= 1;
      const source = this.lineage.readSection(execution.planId, execution.version, chunk.id); const taskSnippet = workerTaskSnippet(source, chunk.id); chunk.taskSnippet = taskSnippet; const context = this.materializeContext(execution, chunk); const launched = this.launcher?.({ execution, chunk, attempt, context, profile: execution.profile, taskSnippet });
      if (this.launcher && (!launched || typeof launched.sessionId !== 'string' || !launched.sessionId)) throw new Error(`Worker launch for ${chunk.id} must return its created sessionId`);
      if (launched) Object.assign(attempt, launched, { sessionId: launched.sessionId, taskSnippet });
      execution.events.push({ type: 'worker.started', chunkId: chunk.id, at: attempt.startedAt });
    }
    this.save(execution); return execution;
  }
  materializeContext(execution, chunk) { const directory = path.join(execution.repositoryRoot || this.root, '.bdfl', 'workers', execution.id, chunk.id, 'context'); fs.mkdirSync(path.join(directory, 'dependency-results'), { recursive: true }); atomicWrite(path.join(directory, 'shared.md'), this.lineage.readSection(execution.planId, execution.version, 'shared')); atomicWrite(path.join(directory, 'chunk.md'), this.lineage.readSection(execution.planId, execution.version, chunk.id)); for (const predecessor of this.ancestors(execution, chunk)) atomicWrite(path.join(directory, 'dependency-results', `${predecessor.id}.json`), `${JSON.stringify({ id: predecessor.id, commit: predecessor.commit, summary: predecessor.summary }, null, 2)}\n`); atomicWrite(path.join(directory, 'execution.json'), `${JSON.stringify({ executionId: execution.id, planId: execution.planId, version: execution.version, chunkId: chunk.id, paths: chunk.paths, checks: chunk.checks, base: chunk.attempts.at(-1).base }, null, 2)}\n`); return directory; }
  complete(id, chunkId, result) { const execution = this.load(id); const chunk = execution.chunks.find((item) => item.id === chunkId); if (!chunk || !ACTIVE.has(chunk.status)) throw new Error(`Chunk is not active: ${chunkId}`); let summary = `${result.summary || ''}`.slice(0, 800); const attempt = chunk.attempts.at(-1); let verified = result; if (result.state === 'pass' && this.validator) { try { verified = { ...result, ...this.validator({ execution, chunk, attempt, result }) }; } catch (error) { verified = { state: 'fail', error: error.message }; summary = error.message.slice(0, 800); } } Object.assign(attempt, { completedAt: this.now().toISOString(), result: verified.state, summary, error: verified.error }); Object.assign(chunk, { status: verified.state === 'pass' ? 'review' : verified.state === 'blocked' ? 'waiting' : 'failed', summary, commit: verified.commit || attempt.commit, changedPaths: verified.changedPaths || [], checkResults: verified.checks || [], diff: verified.diff || '' }); execution.events.push({ type: `worker.${chunk.status}`, chunkId, at: this.now().toISOString() }); this.save(execution); this.recalculate(id); return chunk; }
  accept(id, chunkId) { const execution = this.load(id); const chunk = execution.chunks.find((item) => item.id === chunkId); if (!chunk || chunk.status !== 'review') throw new Error(`Chunk is not ready for acceptance: ${chunkId}`); chunk.status = 'accepted'; chunk.acceptedAt = this.now().toISOString(); execution.integrationHead = chunk.commit || execution.integrationHead; execution.events.push({ type: 'worker.accepted', chunkId, at: chunk.acceptedAt }); this.save(execution); const updated = this.recalculate(id); if (updated.chunks.every((item) => item.status === 'accepted')) this.onAllAccepted?.(id); return this.load(id); }
  feedback(id, chunkId, message, sender) { if (!message?.trim()) throw new Error('Worker feedback is required'); const execution = this.load(id); const chunk = execution.chunks.find((item) => item.id === chunkId); if (!chunk || !FEEDBACK.has(chunk.status)) throw new Error(`Chunk is not ready for feedback: ${chunkId}`); chunk.status = 'running'; chunk.feedback ||= []; chunk.feedback.push({ message: message.trim().slice(0, 800), at: this.now().toISOString() }); execution.events.push({ type: 'worker.feedback', chunkId, at: this.now().toISOString() }); this.save(execution); sender?.(id, chunkId, message.trim()); return chunk; }
  setCapacity(id, capacity) { if (!Number.isInteger(capacity) || capacity < 1 || capacity > 5) throw new Error('Worker capacity must be an integer from 1 to 5'); const execution = this.load(id); execution.capacity = capacity; this.save(execution); return this.recalculate(id); }
  status(id) { const execution = this.load(id); return { id, planId: execution.planId, version: execution.version, status: execution.status, capacity: execution.capacity, chunks: execution.chunks.map(({ id: chunkId, status, commit, dependsOn, taskSnippet, attempts }) => ({ id: chunkId, status, commit, dependsOn, taskSnippet: taskSnippet || null, sessionId: attempts.at(-1)?.sessionId || null })), paths: { execution: this.executionFile(id, execution.repositoryRoot) } }; }
  events(id, cursor = 0) { const events = this.load(id).events.slice(cursor, cursor + 20); return { cursor: cursor + events.length, events: events.map(({ type, chunkId, at }) => ({ type, chunkId, at })) }; }
  wait(id, cursor = 0, timeout = 55000) { const immediate = this.events(id, cursor); if (immediate.events.length) return Promise.resolve(immediate); return new Promise((resolve) => { const finish = () => { clearTimeout(timer); this.emitter.off(id, finish); resolve(this.events(id, cursor)); }; const timer = setTimeout(finish, timeout); this.emitter.once(id, finish); }); }
}

module.exports = { WorkerScheduler, ACTIVE, FEEDBACK, TERMINAL_EXECUTIONS, workerTaskSnippet };
