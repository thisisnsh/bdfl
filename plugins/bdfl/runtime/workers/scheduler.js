'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { atomicWrite } = require('../core/plans');
const { normalizeTaskSnippet } = require('../state/workspace');

const ACTIVE = new Set(['running', 'waiting', 'checking']);
const FEEDBACK = new Set(['running', 'waiting', 'review', 'failed']);
const TERMINAL_EXECUTIONS = new Set(['complete', 'cancelled']);
const MAX_FEEDBACK_MESSAGE = 800;
const MAX_FEEDBACK_SELECTIONS = 20;
const MAX_SELECTION_TEXT = 4000;
const MAX_WORKER_FEEDBACK = 12000;

function boundedText(value, maximum, { trim = false } = {}) {
  const text = `${value ?? ''}`.replace(/\r\n?/gu, '\n');
  return (trim ? text.trim() : text).slice(0, maximum);
}

function normalizeFeedback(value) {
  const input = typeof value === 'string' ? { message: value } : value && typeof value === 'object' ? value : {};
  const message = boundedText(input.message, MAX_FEEDBACK_MESSAGE, { trim: true });
  if (!message) throw new Error('Worker feedback is required');
  const selections = (Array.isArray(input.selections) ? input.selections : [])
    .slice(0, MAX_FEEDBACK_SELECTIONS)
    .map((selection, index) => {
      const source = selection && typeof selection === 'object' ? selection : {};
      const startLine = Number.isSafeInteger(source.startLine)
        ? source.startLine
        : Number.isSafeInteger(source.sourceStartLine)
          ? source.sourceStartLine
          : Number.isSafeInteger(source.start)
            ? source.start
            : 0;
      const endLine = Number.isSafeInteger(source.endLine)
        ? source.endLine
        : Number.isSafeInteger(source.sourceEndLine)
          ? source.sourceEndLine
          : Number.isSafeInteger(source.end)
            ? source.end
            : startLine;
      const normalized = {
        file: boundedText(source.file, 200, { trim: true }),
        hunk: boundedText(source.hunk, 200, { trim: true }),
        startLine,
        endLine,
        text: boundedText(source.text ?? source.selectedText, MAX_SELECTION_TEXT)
      };
      if (!normalized.file || !normalized.hunk || !normalized.text.trim() || startLine < 1 || endLine < startLine)
        throw new Error(
          `Worker feedback selection ${index + 1} requires file, hunk, text, and positive ordered source lines`
        );
      return Object.freeze(normalized);
    });
  return Object.freeze({ message, selections: Object.freeze(selections) });
}

function workerFeedbackMessage(feedback) {
  if (!feedback.selections.length) return feedback.message;
  const prefix = `${feedback.message}\n\nSelected diff excerpts:\n\n`;
  const headers = feedback.selections.map(
    (selection, index) =>
      `Selection ${index + 1}: ${selection.file || '(unknown file)'} | ${selection.hunk || '(unknown hunk)'} | source lines ${selection.startLine}-${selection.endLine}`
  );
  const fixedLength =
    prefix.length +
    headers.reduce((length, header) => length + header.length + 1, 0) +
    Math.max(0, headers.length - 1) * 2;
  const excerptLimit = Math.max(0, Math.floor((MAX_WORKER_FEEDBACK - fixedLength) / headers.length));
  const excerpts = feedback.selections.map(
    (selection, index) => `${headers[index]}\n${selection.text.slice(0, excerptLimit)}`
  );
  return boundedText(`${prefix}${excerpts.join('\n\n')}`, MAX_WORKER_FEEDBACK);
}

function workerTaskSnippet(source, fallback) {
  const title = source.match(/^##\s+(.+?)\s*$/mu)?.[1];
  const outcomeStart = source.match(/^###\s+Outcome\s*$/imu);
  const outcome = outcomeStart ? source.slice(outcomeStart.index + outcomeStart[0].length).split(/^###\s+/mu)[0] : null;
  const paragraph = outcome
    ?.trim()
    .split(/\n\s*\n/u)[0]
    ?.replace(/\s+/gu, ' ')
    .trim();
  return normalizeTaskSnippet(title && paragraph ? `${title} — ${paragraph}` : fallback) || `${fallback}`;
}

class WorkerScheduler {
  constructor(
    root,
    {
      store,
      lineage,
      launcher,
      validator,
      worktrees,
      onAllAccepted,
      onRepairsAccepted,
      now = () => new Date(),
      id = () => crypto.randomUUID()
    } = {}
  ) {
    this.root = path.resolve(root);
    this.store = store;
    this.lineage = lineage;
    this.launcher = launcher;
    this.validator = validator;
    this.worktrees = worktrees;
    this.onAllAccepted = onAllAccepted;
    this.onRepairsAccepted = onRepairsAccepted;
    this.now = now;
    this.id = id;
    this.emitter = new EventEmitter();
    this.validationJobs = new Map();
  }
  roots() {
    return this.store?.repositoryRoots?.() || [this.root];
  }
  executionFile(id, repository = this.root) {
    return path.join(repository, '.bdfl', 'executions', id, 'execution.json');
  }
  load(id) {
    for (const repository of this.roots()) {
      try {
        return {
          ...JSON.parse(fs.readFileSync(this.executionFile(id, repository), 'utf8')),
          repositoryRoot: repository
        };
      } catch {}
    }
    throw new Error(`Unknown execution: ${id}`);
  }
  save(execution) {
    const repository = execution.repositoryRoot || this.root;
    const stored = { ...execution };
    delete stored.repositoryRoot;
    atomicWrite(this.executionFile(execution.id, repository), `${JSON.stringify(stored, null, 2)}\n`);
    this.emitter.emit(execution.id);
    this.onChange?.(execution);
    return execution;
  }
  list() {
    return this.roots().flatMap((repository) => {
      const directory = path.join(repository, '.bdfl', 'executions');
      let entries;
      try {
        entries = fs.readdirSync(directory, { withFileTypes: true });
      } catch {
        return [];
      }
      return entries
        .filter((entry) => entry.isDirectory())
        .flatMap((entry) => {
          try {
            return [
              {
                ...JSON.parse(fs.readFileSync(path.join(directory, entry.name, 'execution.json'), 'utf8')),
                repositoryRoot: repository
              }
            ];
          } catch {
            return [];
          }
        });
    });
  }
  freeze(planId, version, workstreamId, baseline = 'HEAD') {
    if (!this.lineage.executable(planId, version)) throw new Error('Execution requires approval of every plan section');
    const executions = this.list();
    const existing = executions.find(
      (item) => item.planId === planId && item.version === version && item.workstreamId === workstreamId
    );
    if (existing) return { ...existing, duplicate: true };
    const activeLineage = executions.find((item) => item.planId === planId && !TERMINAL_EXECUTIONS.has(item.status));
    if (activeLineage) throw new Error(`Plan ${planId} already has active execution ${activeLineage.id}`);
    const manifest = this.lineage.readManifest(planId, version);
    const workspace = this.store.load();
    const stream = workspace.workstreams.find((item) => item.id === workstreamId);
    if (!stream) throw new Error(`Unknown workstream: ${workstreamId}`);
    if (manifest.workstreamId && manifest.workstreamId !== workstreamId)
      throw new Error('Plan belongs to a different workstream');
    const repository = stream.repositoryRoot || this.root;
    const target = this.worktrees?.target ? this.worktrees.target(repository) : { branch: null, head: baseline };
    const frozenBaseline = this.worktrees?.baseline
      ? this.worktrees.baseline(target.head || baseline, repository)
      : baseline;
    const id = `execution-${this.id()}`;
    const execution = {
      id,
      schema: 1,
      planId,
      version,
      workstreamId,
      baseline: frozenBaseline,
      targetBranch: target.branch,
      targetHead: target.head || frozenBaseline,
      integrationHead: frozenBaseline,
      approvedTitle: manifest.title,
      approvedSummary: manifest.summary?.bullets || [],
      profile: structuredClone(stream.workerProfile),
      capacity: stream.workerCapacity,
      workload: {
        implementationWorkers: manifest.chunks.length,
        verifierWorkers: 1,
        maxConcurrent: stream.workerCapacity
      },
      status: 'running',
      createdAt: this.now().toISOString(),
      globalValidation: manifest.globalValidation,
      chunks: manifest.chunks.map((chunk) => ({
        id: chunk.id,
        title: chunk.title || null,
        order: chunk.order,
        sha: chunk.sha,
        paths: chunk.paths,
        dependsOn: chunk.dependsOn,
        locks: chunk.locks,
        checks: chunk.checks || [],
        status: 'queued',
        attempts: []
      })),
      events: []
    };
    execution.repositoryRoot = repository;
    this.save(execution);
    this.recalculate(id);
    return this.load(id);
  }
  active(execution) {
    return execution.chunks.filter((chunk) => ACTIVE.has(chunk.status));
  }
  ancestors(execution, chunk) {
    const found = new Set();
    const visit = (id) => {
      const current = execution.chunks.find((item) => item.id === id);
      if (!current) return;
      for (const dependency of current.dependsOn) visit(dependency);
      found.add(id);
    };
    for (const dependency of chunk.dependsOn) visit(dependency);
    return execution.chunks.filter((item) => found.has(item.id)).sort((left, right) => left.order - right.order);
  }
  resume() {
    const resumed = [];
    for (const execution of this.list().filter((item) => ['running', 'verification-repair'].includes(item.status))) {
      if (execution.status === 'verification-repair') {
        for (const chunk of execution.chunks) {
          const repair = chunk.verificationRepairs?.at(-1);
          if (repair?.status === 'checking') this.startRepairValidation(execution.id, chunk.id, repair.round);
        }
        resumed.push(this.recalculateRepairs(execution.id));
        continue;
      }
      for (const chunk of execution.chunks.filter((item) => item.status === 'checking'))
        this.startValidation(execution.id, chunk.id, { resumed: true });
      resumed.push(this.recalculate(execution.id));
    }
    return resumed;
  }
  recalculate(id) {
    const execution = this.load(id);
    const active = this.active(execution);
    const held = new Set(active.flatMap((chunk) => chunk.locks));
    let slots = Math.max(0, execution.capacity - active.length);
    for (const chunk of execution.chunks) {
      if (!slots || chunk.status !== 'queued') continue;
      if (
        !chunk.dependsOn.every(
          (dependency) => execution.chunks.find((item) => item.id === dependency)?.status === 'accepted'
        )
      )
        continue;
      if (chunk.locks.some((lock) => held.has(lock))) continue;
      const predecessors = this.ancestors(execution, chunk);
      const commits = predecessors.map((item) => item.commit).filter(Boolean);
      const base =
        predecessors.length && this.worktrees?.composeBase
          ? this.worktrees.composeBase(
              execution.id,
              chunk.id,
              chunk.attempts.length + 1,
              execution.baseline,
              predecessors,
              execution.repositoryRoot
            )
          : commits.at(-1) || execution.baseline;
      const attempt = { number: chunk.attempts.length + 1, base, startedAt: this.now().toISOString() };
      chunk.attempts.push(attempt);
      chunk.status = 'running';
      chunk.locks.forEach((lock) => held.add(lock));
      slots -= 1;
      const source = this.lineage.readSection(execution.planId, execution.version, chunk.id);
      chunk.title ||= source.match(/^##\s+(.+?)\s*$/mu)?.[1]?.trim() || null;
      const taskSnippet = workerTaskSnippet(source, chunk.id);
      chunk.taskSnippet = taskSnippet;
      const context = this.materializeContext(execution, chunk);
      const launched = this.launcher?.({ execution, chunk, attempt, context, profile: execution.profile, taskSnippet });
      if (this.launcher && (!launched || typeof launched.sessionId !== 'string' || !launched.sessionId))
        throw new Error(`Worker launch for ${chunk.id} must return its created sessionId`);
      if (launched) Object.assign(attempt, launched, { sessionId: launched.sessionId, taskSnippet });
      execution.events.push({ type: 'worker.started', chunkId: chunk.id, at: attempt.startedAt });
    }
    this.save(execution);
    return execution;
  }
  materializeContext(execution, chunk) {
    const directory = path.join(
      execution.repositoryRoot || this.root,
      '.bdfl',
      'workers',
      execution.id,
      chunk.id,
      'context'
    );
    fs.mkdirSync(path.join(directory, 'dependency-results'), { recursive: true });
    fs.mkdirSync(path.join(directory, 'chunks'), { recursive: true });
    const manifest = this.lineage.readManifest(execution.planId, execution.version);
    const summary = manifest.summary ? this.lineage.readSection(execution.planId, execution.version, 'summary') : '';
    if (summary) atomicWrite(path.join(directory, 'summary.md'), summary);
    atomicWrite(
      path.join(directory, 'shared.md'),
      this.lineage.readSection(execution.planId, execution.version, 'shared')
    );
    atomicWrite(
      path.join(directory, 'chunk.md'),
      this.lineage.readSection(execution.planId, execution.version, chunk.id)
    );
    for (const planned of execution.chunks)
      atomicWrite(
        path.join(directory, 'chunks', `${planned.id}.md`),
        this.lineage.readSection(execution.planId, execution.version, planned.id)
      );
    atomicWrite(
      path.join(directory, 'global-validation.md'),
      this.lineage.readSection(execution.planId, execution.version, 'global-validation')
    );
    for (const predecessor of this.ancestors(execution, chunk))
      atomicWrite(
        path.join(directory, 'dependency-results', `${predecessor.id}.json`),
        `${JSON.stringify({ id: predecessor.id, commit: predecessor.commit, summary: predecessor.summary }, null, 2)}\n`
      );
    atomicWrite(
      path.join(directory, 'assignment.json'),
      `${JSON.stringify(
        {
          executionId: execution.id,
          planId: execution.planId,
          version: execution.version,
          approvedTitle: manifest.title,
          approvedSummary: manifest.summary?.bullets || [],
          assignment: { chunkId: chunk.id, paths: chunk.paths, checks: chunk.checks },
          base: chunk.attempts.at(-1).base,
          chunks: execution.chunks.map(({ id, title, paths, dependsOn, locks, checks }) => ({
            id,
            title,
            paths,
            dependsOn,
            locks,
            checks
          })),
          globalValidation: execution.globalValidation
        },
        null,
        2
      )}\n`
    );
    const completePlan = [
      `# ${manifest.title}`,
      summary.trimEnd(),
      this.lineage.readSection(execution.planId, execution.version, 'shared').trimEnd(),
      ...execution.chunks.map((planned) =>
        this.lineage.readSection(execution.planId, execution.version, planned.id).trimEnd()
      ),
      this.lineage.readSection(execution.planId, execution.version, 'global-validation').trimEnd()
    ]
      .filter(Boolean)
      .join('\n\n');
    atomicWrite(path.join(directory, 'plan.md'), `${completePlan}\n`);
    return directory;
  }
  complete(id, chunkId, result) {
    const execution = this.load(id);
    const chunk = execution.chunks.find((item) => item.id === chunkId);
    const repair = chunk?.verificationRepairs?.at(-1);
    if (repair && ['running', 'waiting', 'checking'].includes(repair.status))
      return this.completeRepair(execution, chunk, repair, result);
    if (!chunk || !ACTIVE.has(chunk.status)) throw new Error(`Chunk is not active: ${chunkId}`);
    if (chunk.status === 'checking') return chunk;
    const summary = `${result.summary || ''}`.slice(0, 800);
    const attempt = chunk.attempts.at(-1);
    if (result.state === 'pass' && this.validator) {
      chunk.status = 'checking';
      Object.assign(attempt, { reportedAt: this.now().toISOString(), reportedSummary: summary });
      execution.events.push({ type: 'worker.checking', chunkId, at: attempt.reportedAt });
      this.save(execution);
      this.startValidation(id, chunkId);
      return this.load(id).chunks.find((item) => item.id === chunkId);
    }
    this.finishWorker(execution, chunk, attempt, result, summary);
    this.save(execution);
    this.recalculate(id);
    return chunk;
  }
  finishWorker(execution, chunk, attempt, verified, reportedSummary = '') {
    const summary = `${verified.error || reportedSummary || verified.summary || ''}`.slice(0, 800);
    Object.assign(attempt, {
      completedAt: this.now().toISOString(),
      result: verified.state,
      summary,
      error: verified.error
    });
    Object.assign(chunk, {
      status: verified.state === 'pass' ? 'review' : verified.state === 'blocked' ? 'waiting' : 'failed',
      summary,
      commit: verified.commit || attempt.commit,
      changedPaths: verified.changedPaths || [],
      checkResults: verified.checks || [],
      diff: verified.diff || ''
    });
    execution.events.push({ type: `worker.${chunk.status}`, chunkId: chunk.id, at: this.now().toISOString() });
    return chunk;
  }
  startValidation(id, chunkId, { resumed = false } = {}) {
    const key = `${id}:${chunkId}`;
    if (this.validationJobs.has(key)) return this.validationJobs.get(key);
    const job = Promise.resolve()
      .then(() => {
        const execution = this.load(id);
        const chunk = execution.chunks.find((item) => item.id === chunkId);
        if (!chunk || chunk.status !== 'checking') return null;
        const attempt = chunk.attempts.at(-1);
        if (resumed) attempt.validationResumedAt = this.now().toISOString();
        return this.validator({
          execution,
          chunk,
          attempt,
          result: { state: 'pass', summary: attempt.reportedSummary }
        });
      })
      .then((verified) => {
        if (!verified) return null;
        const execution = this.load(id);
        const chunk = execution.chunks.find((item) => item.id === chunkId);
        if (!chunk || chunk.status !== 'checking') return null;
        this.finishWorker(
          execution,
          chunk,
          chunk.attempts.at(-1),
          { state: 'pass', ...verified },
          chunk.attempts.at(-1).reportedSummary
        );
        this.save(execution);
        this.recalculate(id);
        return chunk;
      })
      .catch((error) => {
        const execution = this.load(id);
        const chunk = execution.chunks.find((item) => item.id === chunkId);
        if (!chunk || chunk.status !== 'checking') return null;
        this.finishWorker(
          execution,
          chunk,
          chunk.attempts.at(-1),
          { state: 'fail', error: error.message },
          chunk.attempts.at(-1).reportedSummary
        );
        this.save(execution);
        this.recalculate(id);
        return chunk;
      })
      .finally(() => this.validationJobs.delete(key));
    this.validationJobs.set(key, job);
    return job;
  }
  waitForValidation(id, chunkId) {
    return this.validationJobs.get(`${id}:${chunkId}`) || Promise.resolve();
  }
  accept(id, chunkId) {
    const execution = this.load(id);
    const chunk = execution.chunks.find((item) => item.id === chunkId);
    const repair = chunk?.verificationRepairs?.at(-1);
    if (repair?.status === 'review') {
      repair.status = 'accepted';
      repair.acceptedAt = this.now().toISOString();
      const currentRound = repair.round;
      const currentRepairs = execution.chunks
        .map((item) => item.verificationRepairs?.at(-1))
        .filter((item) => item?.round === currentRound);
      const accepted = currentRepairs.filter((item) => item.status === 'accepted').length;
      if (execution.integration?.phase)
        execution.integration.phase = {
          ...execution.integration.phase,
          progress: `${accepted}/${currentRepairs.length} repairs accepted`,
          updatedAt: this.now().toISOString()
        };
      execution.events.push({
        type: 'verification-repair.accepted',
        chunkId,
        round: repair.round,
        at: repair.acceptedAt
      });
      this.save(execution);
      const updated = this.recalculateRepairs(id);
      const round = updated.verificationRepair?.round;
      const affected = updated.chunks.filter((item) => item.verificationRepairs?.at(-1)?.round === round);
      if (affected.length && affected.every((item) => item.verificationRepairs.at(-1).status === 'accepted'))
        this.onRepairsAccepted?.(id, round);
      return this.load(id);
    }
    if (!chunk || chunk.status !== 'review') throw new Error(`Chunk is not ready for acceptance: ${chunkId}`);
    chunk.status = 'accepted';
    chunk.acceptedAt = this.now().toISOString();
    execution.integrationHead = chunk.commit || execution.integrationHead;
    execution.events.push({ type: 'worker.accepted', chunkId, at: chunk.acceptedAt });
    this.save(execution);
    const updated = this.recalculate(id);
    if (updated.chunks.every((item) => item.status === 'accepted')) this.onAllAccepted?.(id);
    return this.load(id);
  }
  feedback(id, chunkId, value, sender) {
    const feedback = normalizeFeedback(value);
    const execution = this.load(id);
    const chunk = execution.chunks.find((item) => item.id === chunkId);
    const repair = chunk?.verificationRepairs?.at(-1);
    const repairFeedback = repair && ['running', 'waiting', 'review', 'failed'].includes(repair.status);
    if (!chunk || (!FEEDBACK.has(chunk.status) && !repairFeedback))
      throw new Error(`Chunk is not ready for feedback: ${chunkId}`);
    sender?.(id, chunkId, workerFeedbackMessage(feedback));
    const at = this.now().toISOString();
    if (repairFeedback) repair.status = 'running';
    else chunk.status = 'running';
    chunk.feedback ||= [];
    chunk.feedback.push({
      message: feedback.message,
      selections: feedback.selections.map((selection) => ({ ...selection })),
      at
    });
    execution.events.push({ type: 'worker.feedback', chunkId, at });
    this.save(execution);
    return chunk;
  }
  materializeRepairContext(execution, chunk, repair) {
    const original = this.materializeContext(execution, chunk);
    const directory = path.join(
      execution.repositoryRoot || this.root,
      '.bdfl',
      'workers',
      execution.id,
      chunk.id,
      'verification-repairs',
      `round-${repair.round}`,
      'context'
    );
    fs.mkdirSync(path.dirname(directory), { recursive: true });
    fs.cpSync(original, directory, { recursive: true });
    atomicWrite(
      path.join(directory, 'repair.json'),
      `${JSON.stringify(
        {
          round: repair.round,
          base: repair.base,
          findings: repair.findings,
          userGuidance: repair.userGuidance,
          priorResult: repair.priorResult,
          originalSessionId: repair.originalSessionId,
          approvedPaths: chunk.paths
        },
        null,
        2
      )}\n`
    );
    return directory;
  }
  startVerificationRepairs(id, { base, chunkIds, findings, guidance = '' }) {
    const execution = this.load(id);
    const requested = new Set(chunkIds || []);
    const affected = execution.chunks.filter((chunk) => requested.has(chunk.id));
    if (!affected.length) throw new Error('Verification repair requires at least one affected chunk ID');
    const round = (execution.verificationRepair?.round || 0) + 1;
    for (const chunk of affected) {
      const originalAttempt = chunk.attempts.at(-1);
      chunk.verificationRepairs ||= [];
      chunk.verificationRepairs.push({
        round,
        status: 'queued',
        base,
        findings: `${findings || ''}`.slice(0, 12000),
        userGuidance: `${guidance || ''}`.trim().slice(0, 800),
        originalSessionId: originalAttempt?.sessionId || null,
        priorResult: {
          commit: chunk.commit || null,
          summary: chunk.summary || '',
          changedPaths: chunk.changedPaths || []
        },
        attempts: []
      });
    }
    execution.status = 'verification-repair';
    execution.integration = {
      ...execution.integration,
      phase: {
        kind: 'verification-repair',
        label: 'Verification repair',
        activeAgentSessionIds: [],
        worktree: null,
        attempt: round,
        progress: `0/${affected.length} repairs accepted`,
        nextStep: 'Affected original workers repair isolated chunks; every result returns to Review.',
        startedAt: this.now().toISOString()
      }
    };
    execution.verificationRepair = {
      round,
      status: 'running',
      base,
      affectedChunkIds: affected.map((chunk) => chunk.id),
      findings: `${findings || ''}`.slice(0, 12000),
      userGuidance: `${guidance || ''}`.trim().slice(0, 800),
      startedAt: this.now().toISOString(),
      nextStep: 'Affected original workers repair isolated chunks; every result returns to Review.'
    };
    execution.events.push({
      type: 'verification-repair.started',
      round,
      chunkIds: affected.map((chunk) => chunk.id),
      at: execution.verificationRepair.startedAt
    });
    this.save(execution);
    return this.recalculateRepairs(id);
  }
  recalculateRepairs(id) {
    const execution = this.load(id);
    if (execution.status !== 'verification-repair') return execution;
    const round = execution.verificationRepair?.round;
    const current = execution.chunks
      .map((chunk) => ({ chunk, repair: chunk.verificationRepairs?.at(-1) }))
      .filter(({ repair }) => repair?.round === round);
    const active = current.filter(({ repair }) => ['running', 'waiting', 'checking'].includes(repair.status));
    const held = new Set(active.flatMap(({ chunk }) => chunk.locks));
    let slots = Math.max(0, execution.capacity - active.length);
    for (const { chunk, repair } of current) {
      if (!slots || repair.status !== 'queued' || chunk.locks.some((lock) => held.has(lock))) continue;
      const attempt = {
        number: repair.attempts.length + 1,
        base: repair.base,
        startedAt: this.now().toISOString()
      };
      repair.attempts.push(attempt);
      repair.status = 'running';
      chunk.locks.forEach((lock) => held.add(lock));
      slots -= 1;
      const context = this.materializeRepairContext(execution, chunk, repair);
      const launched = this.launcher?.({
        execution,
        chunk,
        attempt,
        context,
        profile: execution.profile,
        taskSnippet: `Verification repair ${round}: ${chunk.title || chunk.id}`,
        repair
      });
      if (this.launcher && !launched?.sessionId)
        throw new Error(`Verification repair launch for ${chunk.id} must return its sessionId`);
      if (launched) Object.assign(attempt, launched, { sessionId: launched.sessionId });
      execution.events.push({
        type: 'verification-repair.worker-started',
        chunkId: chunk.id,
        round,
        replacement: Boolean(launched?.replacement),
        at: attempt.startedAt
      });
    }
    this.save(execution);
    return execution;
  }
  completeRepair(execution, chunk, repair, result) {
    if (repair.status === 'checking') return repair;
    const attempt = repair.attempts.at(-1);
    const summary = `${result.summary || ''}`.slice(0, 800);
    if (result.state === 'pass' && this.validator) {
      repair.status = 'checking';
      Object.assign(attempt, { reportedAt: this.now().toISOString(), reportedSummary: summary });
      execution.events.push({
        type: 'verification-repair.checking',
        chunkId: chunk.id,
        round: repair.round,
        at: attempt.reportedAt
      });
      this.save(execution);
      this.startRepairValidation(execution.id, chunk.id, repair.round);
      return this.load(execution.id)
        .chunks.find((item) => item.id === chunk.id)
        .verificationRepairs.at(-1);
    }
    this.finishRepair(execution, chunk, repair, attempt, result, summary);
    this.save(execution);
    this.recalculateRepairs(execution.id);
    return repair;
  }
  finishRepair(execution, chunk, repair, attempt, verified, reportedSummary = '') {
    const summary = `${verified.error || reportedSummary || verified.summary || ''}`.slice(0, 800);
    Object.assign(attempt, {
      completedAt: this.now().toISOString(),
      result: verified.state,
      summary,
      error: verified.error
    });
    Object.assign(repair, {
      status: verified.state === 'pass' ? 'review' : verified.state === 'blocked' ? 'waiting' : 'failed',
      summary,
      commit: verified.commit || attempt.commit,
      changedPaths: verified.changedPaths || [],
      checkResults: verified.checks || [],
      diff: verified.diff || ''
    });
    execution.events.push({
      type: `verification-repair.${repair.status}`,
      chunkId: chunk.id,
      round: repair.round,
      at: this.now().toISOString()
    });
  }
  startRepairValidation(id, chunkId, round) {
    const key = `${id}:${chunkId}:repair:${round}`;
    if (this.validationJobs.has(key)) return this.validationJobs.get(key);
    const job = Promise.resolve()
      .then(() => {
        const execution = this.load(id);
        const chunk = execution.chunks.find((item) => item.id === chunkId);
        const repair = chunk?.verificationRepairs?.find((item) => item.round === round);
        if (!repair || repair.status !== 'checking') return null;
        const attempt = repair.attempts.at(-1);
        return this.validator({
          execution,
          chunk,
          attempt,
          repair,
          result: { state: 'pass', summary: attempt.reportedSummary }
        });
      })
      .then((verified) => {
        if (!verified) return null;
        const execution = this.load(id);
        const chunk = execution.chunks.find((item) => item.id === chunkId);
        const repair = chunk?.verificationRepairs?.find((item) => item.round === round);
        if (!repair || repair.status !== 'checking') return null;
        this.finishRepair(
          execution,
          chunk,
          repair,
          repair.attempts.at(-1),
          { state: 'pass', ...verified },
          repair.attempts.at(-1).reportedSummary
        );
        this.save(execution);
        this.recalculateRepairs(id);
        return repair;
      })
      .catch((error) => {
        const execution = this.load(id);
        const chunk = execution.chunks.find((item) => item.id === chunkId);
        const repair = chunk?.verificationRepairs?.find((item) => item.round === round);
        if (!repair || repair.status !== 'checking') return null;
        this.finishRepair(
          execution,
          chunk,
          repair,
          repair.attempts.at(-1),
          { state: 'fail', error: error.message },
          repair.attempts.at(-1).reportedSummary
        );
        this.save(execution);
        this.recalculateRepairs(id);
        return repair;
      })
      .finally(() => this.validationJobs.delete(key));
    this.validationJobs.set(key, job);
    return job;
  }
  setCapacity(id, capacity) {
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 5)
      throw new Error('Worker capacity must be an integer from 1 to 5');
    const execution = this.load(id);
    execution.capacity = capacity;
    this.save(execution);
    return this.recalculate(id);
  }
  status(id) {
    const execution = this.load(id);
    return {
      id,
      planId: execution.planId,
      version: execution.version,
      status: execution.status,
      capacity: execution.capacity,
      chunks: execution.chunks.map(
        ({ id: chunkId, title, status, commit, dependsOn, taskSnippet, attempts, verificationRepairs }) => {
          const repair = verificationRepairs?.at(-1);
          return {
            id: chunkId,
            title: title || taskSnippet || chunkId,
            status: repair && repair.status !== 'accepted' ? `verification-repair-${repair.status}` : status,
            commit: repair?.commit || commit,
            dependsOn,
            taskSnippet: taskSnippet || null,
            sessionId: repair?.attempts?.at(-1)?.sessionId || attempts.at(-1)?.sessionId || null,
            ...(repair
              ? {
                  repair: {
                    round: repair.round,
                    status: repair.status,
                    replacement: Boolean(repair.attempts?.at(-1)?.replacement),
                    worktree: repair.attempts?.at(-1)?.worktree || null
                  }
                }
              : {})
          };
        }
      ),
      paths: { execution: this.executionFile(id, execution.repositoryRoot) }
    };
  }
  events(id, cursor = 0) {
    const events = this.load(id).events.slice(cursor, cursor + 20);
    return { cursor: cursor + events.length, events: events.map(({ type, chunkId, at }) => ({ type, chunkId, at })) };
  }
  wait(id, cursor = 0, timeout = 55000) {
    const immediate = this.events(id, cursor);
    if (immediate.events.length) return Promise.resolve(immediate);
    return new Promise((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        this.emitter.off(id, finish);
        resolve(this.events(id, cursor));
      };
      const timer = setTimeout(finish, timeout);
      this.emitter.once(id, finish);
    });
  }
}

module.exports = {
  WorkerScheduler,
  ACTIVE,
  FEEDBACK,
  TERMINAL_EXECUTIONS,
  workerTaskSnippet,
  normalizeFeedback,
  workerFeedbackMessage
};
