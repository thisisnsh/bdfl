'use strict';

const path = require('node:path');
const MAX_VERIFIER_ATTEMPTS = 3;
const MAX_RECONCILIATION_REPAIR_ATTEMPTS = 3;
const REMEDY_VERIFICATION_PURPOSE = 'remedy-verification';

class IntegrationCoordinator {
  constructor({ scheduler, git, lineage, agentLauncher, verifierLauncher, integrationLauncher, now = () => new Date(), onChange = null }) {
    this.scheduler = scheduler; this.git = git; this.lineage = lineage; this.agentLauncher = agentLauncher || ((value) => ['verification', 'verification-retry'].includes(value.phase) ? verifierLauncher?.(value) : integrationLauncher?.(value)); this.now = now; this.onChange = onChange; this.checkJobs = new Map(); this.checkSequence = 0;
  }

  persist(execution) { const saved = this.scheduler.save(execution); this.onChange?.(); return saved; }
  launchAgent(execution, integration, { phase, context = integration.context, result = null, allowedPaths = integration.allowedPaths, fallback = null } = {}) { const agent = integration.agent || fallback; const launched = this.agentLauncher?.({ execution, integration, agent, context, result, allowedPaths, profile: execution.profile, phase }); if (!launched?.sessionId) throw new Error('Execution agent launcher did not return a session ID'); if (agent?.sessionId && launched.sessionId !== agent.sessionId && launched.replacesSessionId !== agent.sessionId) throw new Error('Execution agent launcher replaced the durable execution session without an explicit legacy migration'); return launched; }

  beginVerification(execution, integration, head, checkResults, { purpose = 'initial' } = {}) {
    const startedAt = integration.startedAt || this.now().toISOString(); const enriched = { ...integration, head, checkResults, startedAt, verificationPurpose: purpose };
    const context = this.git.verifierContext(execution, enriched, this.lineage);
    const failed = checkResults.some((check) => !check.ok);
    let verifier = null; let launchError = null;
    if (!failed) { try { verifier = this.launchAgent(execution, enriched, { phase: 'verification', context, fallback: integration.worker }); } catch (error) { launchError = error; } }
    execution.status = failed || launchError ? 'verification-failed' : 'verifying';
    const verifierAttempts = integration.verifierAttempts?.length ? structuredClone(integration.verifierAttempts) : [];
    if (verifier) verifierAttempts.push({ number: verifierAttempts.length + 1, ...verifier, startedAt: this.now().toISOString() });
    execution.integration = { ...enriched, finalDiff: this.git.patch(integration.base, head, integration.worktree), agent: verifier || integration.agent, verifier, verifierAttempts, context, verificationPurpose: purpose };
    if (launchError) execution.verification = { state: 'fail', summary: `Unable to launch verifier: ${launchError.message}`.slice(0, 800), affectedChunkIds: [], completedAt: this.now().toISOString() };
    if (purpose === 'target-reconciliation' && (failed || launchError)) { this.git.cleanupReconciliation(integration.reconciliation, this.repository(execution)); this.restoreQueueSource(execution); this.releaseQueue(execution); }
    this.persist(execution); if (purpose === 'target-reconciliation' && (failed || launchError)) this.drainIntegrationQueue(this.repository(execution)); return execution.integration;
  }

  repository(execution) { return path.resolve(execution.repositoryRoot || this.git.root || process.cwd()); }
  queueExecutions(repository, preferredId) { const listed = this.scheduler.list?.() || (preferredId ? [this.scheduler.load(preferredId)] : []); return listed.filter((execution) => this.repository(execution) === repository); }
  restoreQueueSource(execution) { const source = execution.integration?.queueSource; if (!source) return; execution.integration = { ...execution.integration, ...source, lastReconciliation: execution.integration.reconciliation }; delete execution.integration.reconciliation; delete execution.integration.queueSource; }
  releaseQueue(execution) { if (execution.integration?.queue) execution.integration.queue = { ...execution.integration.queue, active: false, releasedAt: this.now().toISOString() }; }
  completeQueued(execution, commit) { execution.status = 'complete'; execution.finalCommit = commit; execution.completedAt = this.now().toISOString(); this.releaseQueue(execution); this.persist(execution); return commit; }
  failQueued(execution, summary, checkResults = []) { execution.status = 'verification-failed'; execution.verification = { state: 'fail', summary: `${summary}`.slice(0, 800), affectedChunkIds: [], completedAt: this.now().toISOString() }; this.restoreQueueSource(execution); if (checkResults.length) execution.integration.checkResults = checkResults; this.releaseQueue(execution); this.persist(execution); return execution.verification; }
  requeueAfterTargetAdvance(execution, repository, reason) { this.git.cleanupReconciliation(execution.integration?.reconciliation, repository); this.restoreQueueSource(execution); execution.status = 'integration-queued'; execution.integration.queue = { ...execution.integration.queue, active: false, requeuedAt: this.now().toISOString(), retryReason: `${reason}`.slice(0, 800) }; this.persist(execution); return this.drainIntegrationQueue(repository, execution.id); }
  requestValidationRepair(execution, failed, checkResults) {
    const repository = this.repository(execution); const integration = execution.integration; const attempts = (integration.validationRepairAttempts || 0) + 1; const command = failed.command?.length ? failed.command.join(' ') : 'global validation'; const result = { state: 'conflict', kind: 'target', chunkIds: execution.chunks.map((chunk) => chunk.id), pendingChunkIds: [], message: `The reconciled target failed ${command}. Repair the combined tree using this validation output:\n${failed.output || '(no output captured)'}`.slice(0, 12000) };
    if (failed.timedOut || attempts > MAX_RECONCILIATION_REPAIR_ATTEMPTS) { this.git.cleanupReconciliation(integration.reconciliation, repository); const summary = failed.timedOut ? `Reconciled target validation timed out: ${command}` : `Reconciled target validation still failed after ${MAX_RECONCILIATION_REPAIR_ATTEMPTS} repair attempts: ${command}`; const failure = this.failQueued(execution, summary, checkResults); this.drainIntegrationQueue(repository); return failure; }
    const allowedPaths = integration.allowedPaths || [...new Set(execution.chunks.flatMap((chunk) => chunk.paths))]; let worker; try { worker = this.launchAgent(execution, integration, { phase: 'target-validation', result, allowedPaths }); }
    catch (error) { this.git.cleanupReconciliation(integration.reconciliation, repository); const failure = this.failQueued(execution, `Unable to launch validation-repair agent: ${error.message}`, checkResults); this.drainIntegrationQueue(repository); return failure; }
    execution.status = 'integration-conflict'; execution.integration = { ...integration, agent: worker, conflict: result, worker, allowedPaths, validationRepairAttempts: attempts, checkResults }; execution.verification = { state: 'fail', summary: `Reconciled target validation failed; visible execution agent is fixing attempt ${attempts}/${MAX_RECONCILIATION_REPAIR_ATTEMPTS} for ${command}`.slice(0, 800), affectedChunkIds: [], completedAt: this.now().toISOString() }; this.persist(execution); return { state: 'conflict', queued: true, worker, validationRepair: true };
  }

  startChecks(execution, integration, head, { purpose = 'initial', resumed = false } = {}) {
    const runId = `${execution.id}-${++this.checkSequence}`; const startedAt = this.now().toISOString(); execution.status = 'integration-checking'; execution.integration = { ...integration, head, verificationPurpose: purpose, checkRun: { id: runId, state: 'running', purpose, startedAt, ...(resumed ? { resumedAt: startedAt } : {}) } }; this.persist(execution);
    const runner = this.git.runChecksAsync?.bind(this.git) || ((checks, cwd) => Promise.resolve(this.git.runChecks(checks, cwd)));
    const job = Promise.resolve().then(() => runner(execution.globalValidation?.checks || [], execution.integration.worktree)).then((results) => this.finishChecks(execution.id, runId, results)).catch((error) => this.finishChecks(execution.id, runId, [{ command: [], ok: false, output: error.message }])).finally(() => { if (this.checkJobs.get(execution.id) === job) this.checkJobs.delete(execution.id); this.onChange?.(); });
    this.checkJobs.set(execution.id, job); return { state: 'checking', executionId: execution.id, runId };
  }

  finishChecks(executionId, runId, checkResults) {
    const execution = this.scheduler.load(executionId); if (execution.status !== 'integration-checking' || execution.integration?.checkRun?.id !== runId) return null; const purpose = execution.integration.checkRun.purpose; execution.integration.checkRun = { ...execution.integration.checkRun, state: 'complete', completedAt: this.now().toISOString() }; execution.integration.checkResults = checkResults;
    const failed = checkResults.find((check) => !check.ok); if (failed) { const summary = `${purpose === 'target-reconciliation' ? 'Reconciled target' : purpose === REMEDY_VERIFICATION_PURPOSE ? 'Post-repair global' : 'Global'} validation failed${failed.timedOut ? ' because a check timed out' : failed.command?.length ? `: ${failed.command.join(' ')}` : ''}`; if (purpose === 'target-reconciliation') return this.requestValidationRepair(execution, failed, checkResults); execution.status = 'verification-failed'; execution.verification = { state: 'fail', summary: summary.slice(0, 800), affectedChunkIds: [], completedAt: this.now().toISOString() }; this.persist(execution); return execution.verification; }
    if (purpose === 'target-reconciliation' && this.git.baseline && this.git.baseline('HEAD', this.repository(execution)) !== execution.integration.reconciliation.targetHead) return this.requeueAfterTargetAdvance(execution, this.repository(execution), 'Target advanced while reconciled validation was running');
    return this.beginVerification(execution, execution.integration, execution.integration.head, checkResults, { purpose });
  }

  waitForChecks(executionId) { return this.checkJobs.get(executionId) || Promise.resolve(); }

  drainIntegrationQueue(repository, preferredId) {
    const executions = this.queueExecutions(repository, preferredId); if (executions.some((execution) => execution.integration?.queue?.active)) return null;
    const queued = executions.filter((execution) => execution.status === 'integration-queued' && execution.integration?.queue).sort((left, right) => `${left.integration.queue.requestedAt}`.localeCompare(`${right.integration.queue.requestedAt}`))[0]; if (!queued) return null;
    const execution = this.scheduler.load(queued.id); execution.status = 'integrating'; execution.integration.queue = { ...execution.integration.queue, active: true, startedAt: this.now().toISOString() }; this.persist(execution); return this.processQueuedIntegration(execution);
  }

  processQueuedIntegration(execution) {
    const integration = execution.integration; const queue = integration.queue; const repository = this.repository(execution); let staged;
    try { staged = this.git.stageIntegration(integration, { targetBranch: execution.targetBranch, targetHead: execution.targetHead, message: queue.message, repository }); }
    catch (error) { const failed = this.failQueued(execution, error.message); this.drainIntegrationQueue(repository); if (error.code && error.code !== 'TARGET_CHANGED') throw error; return failed; }
    if (!staged.advanced) { try { const commit = this.git.completeIntegration(staged, { targetBranch: execution.targetBranch, repository }); const completed = this.completeQueued(execution, commit); this.drainIntegrationQueue(repository); return completed; } catch (error) { const failed = this.failQueued(execution, error.message); this.drainIntegrationQueue(repository); if (error.code && error.code !== 'TARGET_CHANGED') throw error; return failed; } }
    execution.integration = { ...integration, queueSource: { branch: integration.branch, worktree: integration.worktree, base: integration.base }, reconciliation: staged, base: staged.targetHead, worktree: staged.worktree };
    if (staged.state === 'conflict') {
      const allowedPaths = integration.allowedPaths || [...new Set(execution.chunks.flatMap((chunk) => chunk.paths))]; const result = { state: 'conflict', kind: 'target', chunkIds: execution.chunks.map((chunk) => chunk.id), pendingChunkIds: [], message: staged.message };
      let worker; try { worker = this.launchAgent(execution, execution.integration, { phase: 'target', result, allowedPaths }); }
      catch (error) { this.git.cleanupReconciliation(staged, repository); const failed = this.failQueued(execution, `Unable to launch conflict-resolution agent: ${error.message}`); this.drainIntegrationQueue(repository); return failed; }
      execution.status = 'integration-conflict'; execution.integration = { ...execution.integration, agent: worker, conflict: result, worker, allowedPaths }; this.persist(execution); return { state: 'conflict', queued: true, worker };
    }
    return this.startChecks(execution, execution.integration, staged.commit, { purpose: 'target-reconciliation' });
  }

  resumeIntegrationQueue() {
    const executions = this.scheduler.list?.() || []; const repositories = new Set();
    for (const current of executions) {
      const repository = this.repository(current); repositories.add(repository); const execution = this.scheduler.load(current.id);
      if (execution.status === 'integrating' && execution.integration?.queue?.active) { execution.status = 'integration-queued'; execution.integration.queue = { ...execution.integration.queue, active: false, resumedAt: this.now().toISOString() }; this.persist(execution); }
      else if (execution.status === 'integration-checking') this.startChecks(execution, execution.integration, execution.integration.head, { purpose: execution.integration.checkRun?.purpose || 'initial', resumed: true });
      else if (execution.status === 'integration-conflict' && execution.integration?.queue?.active && execution.integration?.conflict?.kind === 'target' && this.git.reconciliationResolved?.(execution.integration.reconciliation)) { if (this.git.baseline && this.git.baseline('HEAD', repository) !== execution.integration.reconciliation.targetHead) this.requeueAfterTargetAdvance(execution, repository, 'Target advanced while conflict resolution was interrupted'); else { const reconciled = this.git.finishReconciliation(execution.integration.reconciliation, repository); execution.integration = { ...execution.integration, reconciliation: reconciled, base: reconciled.targetHead, worktree: reconciled.worktree, repairedAt: this.now().toISOString() }; this.startChecks(execution, execution.integration, reconciled.commit, { purpose: 'target-reconciliation', resumed: true }); } }
      else if (execution.status === 'verification-failed' && execution.integration?.queue && execution.integration?.lastReconciliation?.commit && /^Reconciled target validation failed/.test(execution.verification?.summary || '') && (execution.integration.validationRepairAttempts || 0) < MAX_RECONCILIATION_REPAIR_ATTEMPTS) { execution.status = 'integration-queued'; execution.integration.queue = { ...execution.integration.queue, active: false, resumedAt: this.now().toISOString(), retryReason: 'Retrying a reconciled validation failure with a visible repair agent' }; this.persist(execution); }
    }
    for (const repository of repositories) this.drainIntegrationQueue(repository); return [...repositories];
  }

  prepare(executionId) {
    const execution = this.scheduler.load(executionId);
    if (execution.chunks.some((chunk) => chunk.status !== 'accepted')) throw new Error('All chunks must be accepted before consolidation');
    const integration = this.git.createIntegration(executionId, execution.baseline, execution.repositoryRoot); const result = this.git.consolidate(integration, execution.chunks);
    if (result.state === 'conflict') {
      const allowedPaths = [...new Set(execution.chunks.flatMap((chunk) => chunk.paths))];
      const worker = this.launchAgent(execution, integration, { phase: 'consolidation', result, allowedPaths });
      execution.status = 'integration-conflict'; execution.integration = { ...integration, agent: worker, conflict: { ...result, kind: 'consolidation' }, worker, allowedPaths, startedAt: this.now().toISOString() }; this.persist(execution);
      return { ...result, requiresIntegrationWorker: true, integration, worker };
    }
    return this.startChecks(execution, integration, result.head);
  }

  repaired(executionId, report) {
    const execution = this.scheduler.load(executionId); if (execution.status !== 'integration-conflict') throw new Error('Execution is not awaiting integration conflict repair');
    if (!['pass', 'fail'].includes(report.state)) throw new Error('Integration repair requires state pass or fail');
    if (execution.integration?.conflict?.kind === 'target') {
      const repository = this.repository(execution); const staged = execution.integration.reconciliation;
      if (report.state !== 'pass') { this.git.cleanupReconciliation(staged, repository); const failed = this.failQueued(execution, report.summary || 'Target integration repair failed'); this.drainIntegrationQueue(repository); return failed; }
      let reconciled; try { reconciled = this.git.finishReconciliation(staged, repository); }
      catch (error) { this.git.cleanupReconciliation(staged, repository); const failed = this.failQueued(execution, error.message, error.checkResults || []); this.drainIntegrationQueue(repository); return failed; }
      execution.integration = { ...execution.integration, reconciliation: reconciled, base: reconciled.targetHead, worktree: reconciled.worktree, repairedAt: this.now().toISOString() };
      return this.startChecks(execution, execution.integration, reconciled.commit, { purpose: 'target-reconciliation' });
    }
    if (report.state !== 'pass') { execution.status = 'verification-failed'; execution.verification = { state: report.state, summary: `${report.summary || 'Integration repair failed'}`.slice(0, 800), completedAt: this.now().toISOString() }; this.persist(execution); return execution.verification; }
    const integration = execution.integration; let head = this.git.checkpoint(integration.worktree, `Repair integration for ${execution.planId}`); const pending = integration.conflict?.pendingChunkIds || [];
    for (let index = 0; index < pending.length; index += 1) {
      const chunk = execution.chunks.find((item) => item.id === pending[index]);
      try { this.git.git(['cherry-pick', chunk.commit], integration.worktree); head = this.git.git(['rev-parse', 'HEAD'], integration.worktree); }
      catch (error) { execution.integration.conflict = { state: 'conflict', chunkIds: [chunk.id], pendingChunkIds: pending.slice(index + 1), message: `${error.stderr || error.message}`.slice(0, 800) }; this.persist(execution); return execution.integration.conflict; }
    }
    this.git.verifyResult({ base: integration.base, head, ownedPaths: integration.allowedPaths, checks: [], worktree: integration.worktree });
    const purpose = integration.conflict?.kind === 'verification' ? REMEDY_VERIFICATION_PURPOSE : 'initial';
    return this.startChecks(execution, { ...integration, repairedAt: this.now().toISOString() }, head, { purpose });
  }

  remedy(executionId, message = '') {
    const execution = this.scheduler.load(executionId); if (execution.status !== 'verification-failed') throw new Error('Verifier remedy requires a failed verification state');
    const integration = execution.integration; if (!integration?.worktree || !integration?.base) throw new Error('Verifier remedy context is missing');
    const requested = new Set(execution.verification?.affectedChunkIds || []); const affected = execution.chunks.filter((chunk) => requested.has(chunk.id)); const chunks = affected.length ? affected : execution.chunks;
    const chunkIds = chunks.map((chunk) => chunk.id); const allowedPaths = [...new Set(execution.chunks.flatMap((chunk) => chunk.paths || []))]; const repairPaths = allowedPaths; if (!repairPaths.length) throw new Error('Verifier remedy has no approved paths');
    const suggestion = `${message || ''}`.trim(); const findings = execution.verification?.summary || 'Verification failed without a recorded summary.'; const result = { state: 'conflict', kind: 'verification', chunkIds, pendingChunkIds: [], message: `Repair the failed verification findings:\n${findings}${suggestion ? `\n\nUser guidance:\n${suggestion}` : ''}`.slice(0, 12000) };
    let worker; try { worker = this.launchAgent(execution, integration, { phase: 'verification-remedy', result, allowedPaths: repairPaths, fallback: integration.verifier || integration.worker }); }
    catch (error) { throw new Error(`Unable to continue the execution agent for verifier remedies: ${error.message}`); }
    const attempts = integration.remedyAttempts?.length ? structuredClone(integration.remedyAttempts) : []; attempts.push({ number: attempts.length + 1, ...worker, startedAt: this.now().toISOString(), findings: findings.slice(0, 800), userGuidance: suggestion.slice(0, 800), affectedChunkIds: chunkIds });
    const verificationRemedyRound = (integration.verificationRemedyRound || 0) + 1;
    execution.status = 'integration-conflict'; execution.integration = { ...integration, agent: worker, conflict: result, worker, allowedPaths, repairPaths, remedyAttempts: attempts, verificationRemedyRound }; execution.events ||= []; execution.events.push({ type: 'verification.remedy-started', round: verificationRemedyRound, chunkIds, at: this.now().toISOString() }); this.persist(execution); return { ...result, requiresIntegrationWorker: true, worker };
  }

  retryVerification(executionId, { sessionId, reason = 'Verifier exited before reporting' } = {}) {
    const execution = this.scheduler.load(executionId); if (execution.status !== 'verifying') return null;
    const integration = execution.integration || {}; const current = integration.verifier;
    if (sessionId && current?.sessionId !== sessionId) return null;
    const attempts = integration.verifierAttempts?.length ? structuredClone(integration.verifierAttempts) : current ? [{ number: 1, ...current, startedAt: integration.startedAt || execution.createdAt }] : [];
    const previous = attempts.findLast((attempt) => attempt.sessionId === current?.sessionId); if (previous && !previous.completedAt) { previous.completedAt = this.now().toISOString(); previous.result = 'interrupted'; previous.summary = `${reason}`.slice(0, 800); }
    if (attempts.length >= MAX_VERIFIER_ATTEMPTS) { execution.status = 'verification-failed'; execution.verification = { state: 'fail', summary: `Verification could not complete after ${attempts.length} attempts: ${reason}`.slice(0, 800), affectedChunkIds: [], completedAt: this.now().toISOString() }; execution.integration = { ...integration, verifierAttempts: attempts }; if (integration.verificationPurpose === 'target-reconciliation') { this.git.cleanupReconciliation(integration.reconciliation, this.repository(execution)); this.restoreQueueSource(execution); } this.releaseQueue(execution); this.persist(execution); if (integration.verificationPurpose === 'target-reconciliation') this.drainIntegrationQueue(this.repository(execution)); return null; }
    let verifier; try { verifier = this.launchAgent(execution, integration, { phase: 'verification-retry', fallback: current }); }
    catch (error) { execution.status = 'verification-failed'; execution.verification = { state: 'fail', summary: `Unable to retry verifier: ${error.message}`.slice(0, 800), affectedChunkIds: [], completedAt: this.now().toISOString() }; execution.integration = { ...integration, verifierAttempts: attempts }; if (integration.verificationPurpose === 'target-reconciliation') { this.git.cleanupReconciliation(integration.reconciliation, this.repository(execution)); this.restoreQueueSource(execution); } this.releaseQueue(execution); this.persist(execution); if (integration.verificationPurpose === 'target-reconciliation') this.drainIntegrationQueue(this.repository(execution)); return null; }
    attempts.push({ number: attempts.length + 1, ...verifier, startedAt: this.now().toISOString(), retryReason: `${reason}`.slice(0, 800) }); execution.integration = { ...integration, agent: verifier, verifier, verifierAttempts: attempts }; this.persist(execution); return verifier;
  }

  verification(executionId, report) {
    const execution = this.scheduler.load(executionId); if (execution.status !== 'verifying') throw new Error('Execution is not awaiting global verification'); if (!['pass', 'fail'].includes(report.state)) throw new Error('Verification requires state pass or fail'); execution.verification = { state: report.state, summary: `${report.summary || ''}`.slice(0, 12000), affectedChunkIds: report.affectedChunkIds || [], completedAt: this.now().toISOString() };
    const attempts = execution.integration?.verifierAttempts?.length ? structuredClone(execution.integration.verifierAttempts) : []; const current = attempts.findLast((attempt) => attempt.sessionId === execution.integration?.verifier?.sessionId); if (current && !current.completedAt) Object.assign(current, { completedAt: execution.verification.completedAt, result: report.state, summary: execution.verification.summary, affectedChunkIds: execution.verification.affectedChunkIds }); execution.integration = { ...execution.integration, verifierAttempts: attempts };
    if (execution.integration?.verificationPurpose !== 'target-reconciliation') { execution.status = report.state === 'pass' ? 'integration-review' : 'verification-failed'; this.persist(execution); return execution.verification; }
    const repository = this.repository(execution); if (report.state !== 'pass') { this.git.cleanupReconciliation(execution.integration.reconciliation, repository); execution.status = 'verification-failed'; this.restoreQueueSource(execution); this.releaseQueue(execution); this.persist(execution); this.drainIntegrationQueue(repository); return execution.verification; }
    try { const commit = this.git.completeIntegration(execution.integration.reconciliation, { targetBranch: execution.targetBranch, repository }); this.completeQueued(execution, commit); }
    catch (error) { if (error.code === 'TARGET_CHANGED') return this.requeueAfterTargetAdvance(execution, repository, error.message); this.git.cleanupReconciliation(execution.integration.reconciliation, repository); this.failQueued(execution, error.message); }
    this.drainIntegrationQueue(repository); return execution.verification;
  }
  finalize(executionId, target = {}, { override = false } = {}) {
    const execution = this.scheduler.load(executionId); if (execution.status === 'complete') return execution.finalCommit; if (['integration-queued', 'integrating', 'integration-conflict'].includes(execution.status) && execution.integration?.queue) return null;
    const failedChecks = execution.integration?.checkResults?.filter((check) => !check.ok) || []; const passing = execution.status === 'integration-review' && execution.verification?.state === 'pass' && !failedChecks.length; if (!passing && !override) throw new Error('Passing global verification is required before final integration'); if (!passing && !['integration-review', 'verification-failed'].includes(execution.status)) throw new Error('Integration override requires a consolidated result with completed verification');
    const requestedAt = this.now().toISOString(); const overrideState = execution.verification?.state || execution.status; let planName = execution.planId; try { planName = this.lineage.load?.(execution.planId)?.title || planName; } catch {}
    execution.targetBranch ||= target.branch; execution.targetHead ||= target.head; execution.status = 'integration-queued'; execution.integration.queue = { requestedAt, active: false, message: target.message || `Integrate ${planName}` };
    if (!passing) execution.integrationOverride = { at: requestedAt, verificationState: overrideState, verificationSummary: execution.verification?.summary || null, failedChecks: failedChecks.map((check) => ({ command: check.command, output: check.output })) };
    this.persist(execution); return this.drainIntegrationQueue(this.repository(execution), execution.id);
  }
}

module.exports = { IntegrationCoordinator, MAX_VERIFIER_ATTEMPTS, MAX_RECONCILIATION_REPAIR_ATTEMPTS, REMEDY_VERIFICATION_PURPOSE };
