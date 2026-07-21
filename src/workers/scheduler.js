'use strict';

const fs = require('node:fs'); const path = require('node:path'); const crypto = require('node:crypto'); const { EventEmitter } = require('node:events');
const { atomicWrite } = require('../core/plans');

const ACTIVE = new Set(['running', 'waiting']);

class WorkerScheduler {
  constructor(root, { store, lineage, launcher, validator, worktrees, now = () => new Date(), id = () => crypto.randomUUID() } = {}) { this.root = path.resolve(root); this.store = store; this.lineage = lineage; this.launcher = launcher; this.validator = validator; this.worktrees = worktrees; this.now = now; this.id = id; this.emitter = new EventEmitter(); }
  executionFile(id) { return path.join(this.root, '.bdfl', 'executions', id, 'execution.json'); }
  load(id) { return JSON.parse(fs.readFileSync(this.executionFile(id), 'utf8')); }
  save(execution) { atomicWrite(this.executionFile(execution.id), `${JSON.stringify(execution, null, 2)}\n`); this.emitter.emit(execution.id); return execution; }
  freeze(planId, version, workstreamId, baseline = 'HEAD') {
    if (!this.lineage.executable(planId, version)) throw new Error('Execution requires approval of every current plan section');
    const manifest = this.lineage.readManifest(planId, version); const workspace = this.store.load(); const stream = workspace.workstreams.find((item) => item.id === workstreamId); if (!stream) throw new Error(`Unknown workstream: ${workstreamId}`);
    const id = `execution-${this.id()}`; const execution = { id, schema: 1, planId, version, workstreamId, baseline, integrationHead: baseline, profile: structuredClone(stream.workerProfile), capacity: stream.workerCapacity, status: 'running', createdAt: this.now().toISOString(), globalValidation: manifest.globalValidation, chunks: manifest.chunks.map((chunk) => ({ id: chunk.id, order: chunk.order, sha: chunk.sha, paths: chunk.paths, dependsOn: chunk.dependsOn, locks: chunk.locks, status: 'queued', attempts: [] })), events: [] };
    this.save(execution); this.recalculate(id); return this.load(id);
  }
  active(execution) { return execution.chunks.filter((chunk) => ACTIVE.has(chunk.status)); }
  recalculate(id) {
    const execution = this.load(id); const active = this.active(execution); const held = new Set(active.flatMap((chunk) => chunk.locks)); let slots = Math.max(0, execution.capacity - active.length);
    for (const chunk of execution.chunks) {
      if (!slots || chunk.status !== 'queued') continue;
      if (!chunk.dependsOn.every((dependency) => execution.chunks.find((item) => item.id === dependency)?.status === 'accepted')) continue;
      if (chunk.locks.some((lock) => held.has(lock))) continue;
      const predecessors = chunk.dependsOn.map((dependency) => execution.chunks.find((item) => item.id === dependency)); const base = predecessors.length ? predecessors.at(-1).commit : execution.baseline;
      const attempt = { number: chunk.attempts.length + 1, base, startedAt: this.now().toISOString() }; chunk.attempts.push(attempt); chunk.status = 'running'; chunk.locks.forEach((lock) => held.add(lock)); slots -= 1;
      const context = this.materializeContext(execution, chunk); const launched = this.launcher?.({ execution, chunk, attempt, context, profile: execution.profile }); if (launched) Object.assign(attempt, launched);
      execution.events.push({ type: 'worker.started', chunkId: chunk.id, at: attempt.startedAt });
    }
    this.save(execution); return execution;
  }
  materializeContext(execution, chunk) { const directory = path.join(this.root, '.bdfl', 'workers', execution.id, chunk.id, 'context'); fs.mkdirSync(path.join(directory, 'dependency-results'), { recursive: true }); atomicWrite(path.join(directory, 'shared.md'), this.lineage.readSection(execution.planId, execution.version, 'shared')); atomicWrite(path.join(directory, 'chunk.md'), this.lineage.readSection(execution.planId, execution.version, chunk.id)); for (const id of chunk.dependsOn) { const predecessor = execution.chunks.find((item) => item.id === id); atomicWrite(path.join(directory, 'dependency-results', `${id}.json`), `${JSON.stringify({ id, commit: predecessor.commit, summary: predecessor.summary }, null, 2)}\n`); } atomicWrite(path.join(directory, 'execution.json'), `${JSON.stringify({ executionId: execution.id, planId: execution.planId, version: execution.version, chunkId: chunk.id, paths: chunk.paths, base: chunk.attempts.at(-1).base }, null, 2)}\n`); return directory; }
  complete(id, chunkId, result) { const execution = this.load(id); const chunk = execution.chunks.find((item) => item.id === chunkId); if (!chunk || !ACTIVE.has(chunk.status)) throw new Error(`Chunk is not active: ${chunkId}`); const summary = `${result.summary || ''}`.slice(0, 800); const attempt = chunk.attempts.at(-1); let verified = result; if (result.state === 'pass' && this.validator) verified = { ...result, ...this.validator({ execution, chunk, attempt, result }) }; Object.assign(attempt, { completedAt: this.now().toISOString(), result: verified.state, summary }); Object.assign(chunk, { status: verified.state === 'pass' ? 'review' : verified.state === 'blocked' ? 'waiting' : 'failed', summary, commit: verified.commit || attempt.commit, changedPaths: verified.changedPaths || [], checks: verified.checks || [] }); execution.events.push({ type: `worker.${chunk.status}`, chunkId, at: this.now().toISOString() }); this.save(execution); this.recalculate(id); return chunk; }
  accept(id, chunkId) { const execution = this.load(id); const chunk = execution.chunks.find((item) => item.id === chunkId); if (!chunk || chunk.status !== 'review') throw new Error(`Chunk is not ready for acceptance: ${chunkId}`); chunk.status = 'accepted'; chunk.acceptedAt = this.now().toISOString(); execution.integrationHead = chunk.commit || execution.integrationHead; execution.events.push({ type: 'worker.accepted', chunkId, at: chunk.acceptedAt }); this.save(execution); return this.recalculate(id); }
  setCapacity(id, capacity) { if (!Number.isInteger(capacity) || capacity < 1 || capacity > 5) throw new Error('Worker capacity must be an integer from 1 to 5'); const execution = this.load(id); execution.capacity = capacity; this.save(execution); return this.recalculate(id); }
  status(id) { const execution = this.load(id); return { id, planId: execution.planId, version: execution.version, status: execution.status, capacity: execution.capacity, chunks: execution.chunks.map(({ id: chunkId, status, commit, dependsOn }) => ({ id: chunkId, status, commit, dependsOn })), paths: { execution: this.executionFile(id) } }; }
  events(id, cursor = 0) { const events = this.load(id).events.slice(cursor, cursor + 20); return { cursor: cursor + events.length, events: events.map(({ type, chunkId, at }) => ({ type, chunkId, at })) }; }
  wait(id, cursor = 0, timeout = 55000) { const immediate = this.events(id, cursor); if (immediate.events.length) return Promise.resolve(immediate); return new Promise((resolve) => { const finish = () => { clearTimeout(timer); this.emitter.off(id, finish); resolve(this.events(id, cursor)); }; const timer = setTimeout(finish, timeout); this.emitter.once(id, finish); }); }
}

module.exports = { WorkerScheduler, ACTIVE };
