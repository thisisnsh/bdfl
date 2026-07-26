'use strict';

const path = require('node:path');
const MAX_VERIFIER_ATTEMPTS = 3;

class IntegrationCoordinator {
  constructor({ scheduler, git, lineage, verifierLauncher, integrationLauncher, now = () => new Date() }) {
    this.scheduler = scheduler; this.git = git; this.lineage = lineage; this.verifierLauncher = verifierLauncher; this.integrationLauncher = integrationLauncher; this.now = now;
  }

  beginVerification(execution, integration, head, checkResults, { purpose = 'initial' } = {}) {
    const startedAt = integration.startedAt || this.now().toISOString(); const enriched = { ...integration, head, checkResults, startedAt };
    const context = this.git.verifierContext(execution, enriched, this.lineage);
    const failed = checkResults.some((check) => !check.ok);
    let verifier = null; let launchError = null;
    if (!failed) { try { verifier = this.verifierLauncher?.({ execution, integration: enriched, context, readOnly: true, profile: execution.profile }); if (!verifier?.sessionId) throw new Error('Verifier launcher did not return a session ID'); } catch (error) { launchError = error; } }
    execution.status = failed || launchError ? 'verification-failed' : 'verifying';
    const verifierAttempts = verifier ? [{ number: 1, ...verifier, startedAt: this.now().toISOString() }] : [];
    execution.integration = { ...enriched, finalDiff: this.git.patch(integration.base, head, integration.worktree), verifier, verifierAttempts, context, verificationPurpose: purpose };
    if (launchError) execution.verification = { state: 'fail', summary: `Unable to launch verifier: ${launchError.message}`.slice(0, 800), affectedChunkIds: [], completedAt: this.now().toISOString() };
    if (purpose === 'target-reconciliation' && (failed || launchError)) { this.git.cleanupReconciliation(integration.reconciliation, this.repository(execution)); this.restoreQueueSource(execution); this.releaseQueue(execution); }
    this.scheduler.save(execution); if (purpose === 'target-reconciliation' && (failed || launchError)) this.drainIntegrationQueue(this.repository(execution)); return execution.integration;
  }

  repository(execution) { return path.resolve(execution.repositoryRoot || this.git.root || process.cwd()); }
  queueExecutions(repository, preferredId) { const listed = this.scheduler.list?.() || (preferredId ? [this.scheduler.load(preferredId)] : []); return listed.filter((execution) => this.repository(execution) === repository); }
  restoreQueueSource(execution) { const source = execution.integration?.queueSource; if (!source) return; execution.integration = { ...execution.integration, ...source, lastReconciliation: execution.integration.reconciliation }; delete execution.integration.reconciliation; delete execution.integration.queueSource; }
  releaseQueue(execution) { if (execution.integration?.queue) execution.integration.queue = { ...execution.integration.queue, active: false, releasedAt: this.now().toISOString() }; }
  completeQueued(execution, commit) { execution.status = 'complete'; execution.finalCommit = commit; execution.completedAt = this.now().toISOString(); this.releaseQueue(execution); this.scheduler.save(execution); return commit; }
  failQueued(execution, summary, checkResults = []) { execution.status = 'verification-failed'; execution.verification = { state: 'fail', summary: `${summary}`.slice(0, 800), affectedChunkIds: [], completedAt: this.now().toISOString() }; this.restoreQueueSource(execution); if (checkResults.length) execution.integration.checkResults = checkResults; this.releaseQueue(execution); this.scheduler.save(execution); return execution.verification; }

  drainIntegrationQueue(repository, preferredId) {
    const executions = this.queueExecutions(repository, preferredId); if (executions.some((execution) => execution.integration?.queue?.active)) return null;
    const queued = executions.filter((execution) => execution.status === 'integration-queued' && execution.integration?.queue).sort((left, right) => `${left.integration.queue.requestedAt}`.localeCompare(`${right.integration.queue.requestedAt}`))[0]; if (!queued) return null;
    const execution = this.scheduler.load(queued.id); execution.status = 'integrating'; execution.integration.queue = { ...execution.integration.queue, active: true, startedAt: this.now().toISOString() }; this.scheduler.save(execution); return this.processQueuedIntegration(execution);
  }

  processQueuedIntegration(execution) {
    const integration = execution.integration; const queue = integration.queue; const repository = this.repository(execution); let staged;
    try { staged = this.git.stageIntegration(integration, { targetBranch: execution.targetBranch, targetHead: execution.targetHead, message: queue.message, repository }); }
    catch (error) { const failed = this.failQueued(execution, error.message); this.drainIntegrationQueue(repository); if (error.code && error.code !== 'TARGET_CHANGED') throw error; return failed; }
    if (!staged.advanced) { try { const commit = this.git.completeIntegration(staged, { targetBranch: execution.targetBranch, repository }); const completed = this.completeQueued(execution, commit); this.drainIntegrationQueue(repository); return completed; } catch (error) { const failed = this.failQueued(execution, error.message); this.drainIntegrationQueue(repository); if (error.code && error.code !== 'TARGET_CHANGED') throw error; return failed; } }
    execution.integration = { ...integration, queueSource: { branch: integration.branch, worktree: integration.worktree, base: integration.base }, reconciliation: staged, base: staged.targetHead, worktree: staged.worktree };
    if (staged.state === 'conflict') {
      const allowedPaths = integration.allowedPaths || [...new Set(execution.chunks.flatMap((chunk) => chunk.paths))]; const result = { state: 'conflict', kind: 'target', chunkIds: execution.chunks.map((chunk) => chunk.id), pendingChunkIds: [], message: staged.message };
      let worker; try { worker = this.integrationLauncher?.({ execution, integration: execution.integration, result, allowedPaths, profile: execution.profile, phase: 'target' }); if (!worker?.sessionId) throw new Error('Integration launcher did not return a session ID'); }
      catch (error) { this.git.cleanupReconciliation(staged, repository); const failed = this.failQueued(execution, `Unable to launch conflict-resolution agent: ${error.message}`); this.drainIntegrationQueue(repository); return failed; }
      execution.status = 'integration-conflict'; execution.integration = { ...execution.integration, conflict: result, worker, allowedPaths }; this.scheduler.save(execution); return { state: 'conflict', queued: true, worker };
    }
    const checkResults = this.git.runChecks(execution.globalValidation?.checks || [], staged.worktree); if (checkResults.some((check) => !check.ok)) { this.git.cleanupReconciliation(staged, repository); const failed = this.failQueued(execution, 'Reconciled target validation failed', checkResults); this.drainIntegrationQueue(repository); return failed; }
    return this.beginVerification(execution, { ...execution.integration, checkResults }, staged.commit, checkResults, { purpose: 'target-reconciliation' });
  }

  resumeIntegrationQueue() {
    const executions = this.scheduler.list?.() || []; const repositories = new Set();
    for (const current of executions) { repositories.add(this.repository(current)); if (current.status === 'integrating' && current.integration?.queue?.active) { const execution = this.scheduler.load(current.id); execution.status = 'integration-queued'; execution.integration.queue = { ...execution.integration.queue, active: false, resumedAt: this.now().toISOString() }; this.scheduler.save(execution); } }
    for (const repository of repositories) this.drainIntegrationQueue(repository); return [...repositories];
  }

  prepare(executionId) {
    const execution = this.scheduler.load(executionId);
    if (execution.chunks.some((chunk) => chunk.status !== 'accepted')) throw new Error('All chunks must be accepted before consolidation');
    const integration = this.git.createIntegration(executionId, execution.baseline, execution.repositoryRoot); const result = this.git.consolidate(integration, execution.chunks);
    if (result.state === 'conflict') {
      const allowedPaths = [...new Set(execution.chunks.flatMap((chunk) => chunk.paths))];
      const worker = this.integrationLauncher?.({ execution, integration, result, allowedPaths, profile: execution.profile });
      execution.status = 'integration-conflict'; execution.integration = { ...integration, conflict: { ...result, kind: 'consolidation' }, worker, allowedPaths, startedAt: this.now().toISOString() }; this.scheduler.save(execution);
      return { ...result, requiresIntegrationWorker: true, integration, worker };
    }
    return this.beginVerification(execution, integration, result.head, this.git.runChecks(execution.globalValidation.checks || [], integration.worktree));
  }

  repaired(executionId, report) {
    const execution = this.scheduler.load(executionId); if (execution.status !== 'integration-conflict') throw new Error('Execution is not awaiting integration conflict repair');
    if (execution.integration?.conflict?.kind === 'target') {
      const repository = this.repository(execution); const staged = execution.integration.reconciliation;
      if (report.state !== 'pass') { this.git.cleanupReconciliation(staged, repository); const failed = this.failQueued(execution, report.summary || 'Target integration repair failed'); this.drainIntegrationQueue(repository); return failed; }
      let reconciled; try { reconciled = this.git.finishReconciliation(staged, execution.globalValidation?.checks || [], repository); }
      catch (error) { this.git.cleanupReconciliation(staged, repository); const failed = this.failQueued(execution, error.message, error.checkResults || []); this.drainIntegrationQueue(repository); return failed; }
      execution.integration = { ...execution.integration, reconciliation: reconciled, base: reconciled.targetHead, worktree: reconciled.worktree, repairedAt: this.now().toISOString() };
      return this.beginVerification(execution, execution.integration, reconciled.commit, reconciled.checkResults || [], { purpose: 'target-reconciliation' });
    }
    if (report.state !== 'pass') { execution.status = 'verification-failed'; execution.verification = { state: report.state, summary: `${report.summary || 'Integration repair failed'}`.slice(0, 800), completedAt: this.now().toISOString() }; this.scheduler.save(execution); return execution.verification; }
    const integration = execution.integration; let head = this.git.checkpoint(integration.worktree, `Repair integration for ${execution.planId}`); const pending = integration.conflict?.pendingChunkIds || [];
    for (let index = 0; index < pending.length; index += 1) {
      const chunk = execution.chunks.find((item) => item.id === pending[index]);
      try { this.git.git(['cherry-pick', chunk.commit], integration.worktree); head = this.git.git(['rev-parse', 'HEAD'], integration.worktree); }
      catch (error) { execution.integration.conflict = { state: 'conflict', chunkIds: [chunk.id], pendingChunkIds: pending.slice(index + 1), message: `${error.stderr || error.message}`.slice(0, 800) }; this.scheduler.save(execution); return execution.integration.conflict; }
    }
    const verified = this.git.verifyResult({ base: integration.base, head, ownedPaths: integration.allowedPaths, checks: [], worktree: integration.worktree });
    return this.beginVerification(execution, { ...integration, repairedAt: this.now().toISOString() }, head, this.git.runChecks(execution.globalValidation.checks || [], integration.worktree));
  }

  retryVerification(executionId, { sessionId, reason = 'Verifier exited before reporting' } = {}) {
    const execution = this.scheduler.load(executionId); if (execution.status !== 'verifying') return null;
    const integration = execution.integration || {}; const current = integration.verifier;
    if (sessionId && current?.sessionId !== sessionId) return null;
    const attempts = integration.verifierAttempts?.length ? structuredClone(integration.verifierAttempts) : current ? [{ number: 1, ...current, startedAt: integration.startedAt || execution.createdAt }] : [];
    const previous = attempts.findLast((attempt) => attempt.sessionId === current?.sessionId); if (previous && !previous.completedAt) { previous.completedAt = this.now().toISOString(); previous.result = 'interrupted'; previous.summary = `${reason}`.slice(0, 800); }
    if (attempts.length >= MAX_VERIFIER_ATTEMPTS) { execution.status = 'verification-failed'; execution.verification = { state: 'fail', summary: `Verification could not complete after ${attempts.length} attempts: ${reason}`.slice(0, 800), affectedChunkIds: [], completedAt: this.now().toISOString() }; execution.integration = { ...integration, verifierAttempts: attempts }; if (integration.verificationPurpose === 'target-reconciliation') { this.git.cleanupReconciliation(integration.reconciliation, this.repository(execution)); this.restoreQueueSource(execution); } this.releaseQueue(execution); this.scheduler.save(execution); if (integration.verificationPurpose === 'target-reconciliation') this.drainIntegrationQueue(this.repository(execution)); return null; }
    let verifier; try { verifier = this.verifierLauncher?.({ execution, integration, context: integration.context, readOnly: true, profile: execution.profile }); if (!verifier?.sessionId) throw new Error('Verifier launcher did not return a session ID'); }
    catch (error) { execution.status = 'verification-failed'; execution.verification = { state: 'fail', summary: `Unable to retry verifier: ${error.message}`.slice(0, 800), affectedChunkIds: [], completedAt: this.now().toISOString() }; execution.integration = { ...integration, verifierAttempts: attempts }; if (integration.verificationPurpose === 'target-reconciliation') { this.git.cleanupReconciliation(integration.reconciliation, this.repository(execution)); this.restoreQueueSource(execution); } this.releaseQueue(execution); this.scheduler.save(execution); if (integration.verificationPurpose === 'target-reconciliation') this.drainIntegrationQueue(this.repository(execution)); return null; }
    attempts.push({ number: attempts.length + 1, ...verifier, startedAt: this.now().toISOString(), retryReason: `${reason}`.slice(0, 800) }); execution.integration = { ...integration, verifier, verifierAttempts: attempts }; this.scheduler.save(execution); return verifier;
  }

  verification(executionId, report) {
    const execution = this.scheduler.load(executionId); if (execution.status !== 'verifying') throw new Error('Execution is not awaiting global verification'); execution.verification = { state: report.state, summary: `${report.summary || ''}`.slice(0, 800), affectedChunkIds: report.affectedChunkIds || [], completedAt: this.now().toISOString() };
    if (execution.integration?.verificationPurpose !== 'target-reconciliation') { execution.status = report.state === 'pass' ? 'integration-review' : 'verification-failed'; this.scheduler.save(execution); return execution.verification; }
    const repository = this.repository(execution); if (report.state !== 'pass') { this.git.cleanupReconciliation(execution.integration.reconciliation, repository); execution.status = 'verification-failed'; this.restoreQueueSource(execution); this.releaseQueue(execution); this.scheduler.save(execution); this.drainIntegrationQueue(repository); return execution.verification; }
    try { const commit = this.git.completeIntegration(execution.integration.reconciliation, { targetBranch: execution.targetBranch, repository }); this.completeQueued(execution, commit); }
    catch (error) { this.git.cleanupReconciliation(execution.integration.reconciliation, repository); this.failQueued(execution, error.message); }
    this.drainIntegrationQueue(repository); return execution.verification;
  }
  finalize(executionId, target = {}, { override = false } = {}) {
    const execution = this.scheduler.load(executionId); if (execution.status === 'complete') return execution.finalCommit; if (['integration-queued', 'integrating', 'integration-conflict'].includes(execution.status) && execution.integration?.queue) return null;
    const failedChecks = execution.integration?.checkResults?.filter((check) => !check.ok) || []; const passing = execution.status === 'integration-review' && execution.verification?.state === 'pass' && !failedChecks.length; if (!passing && !override) throw new Error('Passing global verification is required before final integration'); if (!passing && !['integration-review', 'verification-failed'].includes(execution.status)) throw new Error('Integration override requires a consolidated result with completed verification');
    const requestedAt = this.now().toISOString(); const overrideState = execution.verification?.state || execution.status; let planName = execution.planId; try { planName = this.lineage.load?.(execution.planId)?.title || planName; } catch {}
    execution.targetBranch ||= target.branch; execution.targetHead ||= target.head; execution.status = 'integration-queued'; execution.integration.queue = { requestedAt, active: false, message: target.message || `Integrate ${planName}` };
    if (!passing) execution.integrationOverride = { at: requestedAt, verificationState: overrideState, verificationSummary: execution.verification?.summary || null, failedChecks: failedChecks.map((check) => ({ command: check.command, output: check.output })) };
    this.scheduler.save(execution); return this.drainIntegrationQueue(this.repository(execution), execution.id);
  }
}

module.exports = { IntegrationCoordinator, MAX_VERIFIER_ATTEMPTS };
