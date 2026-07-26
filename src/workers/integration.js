'use strict';

const MAX_VERIFIER_ATTEMPTS = 3;

class IntegrationCoordinator {
  constructor({ scheduler, git, lineage, verifierLauncher, integrationLauncher, now = () => new Date() }) {
    this.scheduler = scheduler; this.git = git; this.lineage = lineage; this.verifierLauncher = verifierLauncher; this.integrationLauncher = integrationLauncher; this.now = now;
  }

  beginVerification(execution, integration, head, checkResults) {
    const startedAt = integration.startedAt || this.now().toISOString(); const enriched = { ...integration, head, checkResults, startedAt };
    const context = this.git.verifierContext(execution, enriched, this.lineage);
    const failed = checkResults.some((check) => !check.ok);
    let verifier = null; let launchError = null;
    if (!failed) { try { verifier = this.verifierLauncher?.({ execution, integration: enriched, context, readOnly: true, profile: execution.profile }); if (!verifier?.sessionId) throw new Error('Verifier launcher did not return a session ID'); } catch (error) { launchError = error; } }
    execution.status = failed || launchError ? 'verification-failed' : 'verifying';
    const verifierAttempts = verifier ? [{ number: 1, ...verifier, startedAt: this.now().toISOString() }] : [];
    execution.integration = { ...enriched, finalDiff: this.git.patch(integration.base, head, integration.worktree), verifier, verifierAttempts, context };
    if (launchError) execution.verification = { state: 'fail', summary: `Unable to launch verifier: ${launchError.message}`.slice(0, 800), affectedChunkIds: [], completedAt: this.now().toISOString() };
    this.scheduler.save(execution); return execution.integration;
  }

  prepare(executionId) {
    const execution = this.scheduler.load(executionId);
    if (execution.chunks.some((chunk) => chunk.status !== 'accepted')) throw new Error('All chunks must be accepted before consolidation');
    const integration = this.git.createIntegration(executionId, execution.baseline, execution.repositoryRoot); const result = this.git.consolidate(integration, execution.chunks);
    if (result.state === 'conflict') {
      const allowedPaths = [...new Set(execution.chunks.flatMap((chunk) => chunk.paths))];
      const worker = this.integrationLauncher?.({ execution, integration, result, allowedPaths, profile: execution.profile });
      execution.status = 'integration-conflict'; execution.integration = { ...integration, conflict: result, worker, allowedPaths, startedAt: this.now().toISOString() }; this.scheduler.save(execution);
      return { ...result, requiresIntegrationWorker: true, integration, worker };
    }
    return this.beginVerification(execution, integration, result.head, this.git.runChecks(execution.globalValidation.checks || [], integration.worktree));
  }

  repaired(executionId, report) {
    const execution = this.scheduler.load(executionId); if (execution.status !== 'integration-conflict') throw new Error('Execution is not awaiting integration conflict repair');
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
    if (attempts.length >= MAX_VERIFIER_ATTEMPTS) { execution.status = 'verification-failed'; execution.verification = { state: 'fail', summary: `Verification could not complete after ${attempts.length} attempts: ${reason}`.slice(0, 800), affectedChunkIds: [], completedAt: this.now().toISOString() }; execution.integration = { ...integration, verifierAttempts: attempts }; this.scheduler.save(execution); return null; }
    let verifier; try { verifier = this.verifierLauncher?.({ execution, integration, context: integration.context, readOnly: true, profile: execution.profile }); if (!verifier?.sessionId) throw new Error('Verifier launcher did not return a session ID'); }
    catch (error) { execution.status = 'verification-failed'; execution.verification = { state: 'fail', summary: `Unable to retry verifier: ${error.message}`.slice(0, 800), affectedChunkIds: [], completedAt: this.now().toISOString() }; execution.integration = { ...integration, verifierAttempts: attempts }; this.scheduler.save(execution); return null; }
    attempts.push({ number: attempts.length + 1, ...verifier, startedAt: this.now().toISOString(), retryReason: `${reason}`.slice(0, 800) }); execution.integration = { ...integration, verifier, verifierAttempts: attempts }; this.scheduler.save(execution); return verifier;
  }

  verification(executionId, report) { const execution = this.scheduler.load(executionId); if (execution.status !== 'verifying') throw new Error('Execution is not awaiting global verification'); execution.verification = { state: report.state, summary: `${report.summary || ''}`.slice(0, 800), affectedChunkIds: report.affectedChunkIds || [], completedAt: this.now().toISOString() }; execution.status = report.state === 'pass' ? 'integration-review' : 'verification-failed'; this.scheduler.save(execution); return execution.verification; }
  finalize(executionId, target = {}, { override = false } = {}) { const execution = this.scheduler.load(executionId); const failedChecks = execution.integration?.checkResults?.filter((check) => !check.ok) || []; const passing = execution.status === 'integration-review' && execution.verification?.state === 'pass' && !failedChecks.length; if (!passing && !override) throw new Error('Passing global verification is required before final integration'); if (!passing && !['integration-review', 'verification-failed'].includes(execution.status)) throw new Error('Integration override requires a consolidated result with completed verification'); const completedAt = this.now().toISOString(); const overrideState = execution.verification?.state || execution.status; let planName = execution.planId; try { planName = this.lineage.load?.(execution.planId)?.title || planName; } catch {} const commit = this.git.integrate(execution.integration, { targetBranch: execution.targetBranch || target.branch, targetHead: execution.targetHead || target.head, message: target.message || `Integrate ${planName}`, repository: execution.repositoryRoot }); execution.status = 'complete'; execution.finalCommit = commit; execution.completedAt = completedAt; if (!passing) execution.integrationOverride = { at: completedAt, verificationState: overrideState, verificationSummary: execution.verification?.summary || null, failedChecks: failedChecks.map((check) => ({ command: check.command, output: check.output })) }; this.scheduler.save(execution); return commit; }
}

module.exports = { IntegrationCoordinator, MAX_VERIFIER_ATTEMPTS };
