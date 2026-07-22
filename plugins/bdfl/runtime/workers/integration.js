'use strict';

class IntegrationCoordinator {
  constructor({ scheduler, git, lineage, verifierLauncher, integrationLauncher, now = () => new Date() }) {
    this.scheduler = scheduler; this.git = git; this.lineage = lineage; this.verifierLauncher = verifierLauncher; this.integrationLauncher = integrationLauncher; this.now = now;
  }

  beginVerification(execution, integration, head, checkResults) {
    const enriched = { ...integration, head, checkResults };
    const context = this.git.verifierContext(execution, enriched, this.lineage);
    const failed = checkResults.some((check) => !check.ok);
    const verifier = failed ? null : this.verifierLauncher?.({ execution, integration: enriched, context, readOnly: true, profile: execution.profile });
    execution.status = failed ? 'verification-failed' : 'verifying';
    execution.integration = { ...enriched, finalDiff: this.git.patch(integration.base, head, integration.worktree), verifier, context, startedAt: integration.startedAt || this.now().toISOString() };
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

  verification(executionId, report) { const execution = this.scheduler.load(executionId); if (execution.status !== 'verifying') throw new Error('Execution is not awaiting global verification'); execution.verification = { state: report.state, summary: `${report.summary || ''}`.slice(0, 800), affectedChunkIds: report.affectedChunkIds || [], completedAt: this.now().toISOString() }; execution.status = report.state === 'pass' ? 'integration-review' : 'verification-failed'; this.scheduler.save(execution); return execution.verification; }
  finalize(executionId, target = {}) { const execution = this.scheduler.load(executionId); if (execution.status !== 'integration-review' || execution.verification?.state !== 'pass' || execution.integration?.checkResults?.some((check) => !check.ok)) throw new Error('Passing global verification is required before final integration'); const commit = this.git.integrate(execution.integration, { targetBranch: execution.targetBranch || target.branch, targetHead: execution.targetHead || target.head, message: target.message || `Integrate ${execution.planId}`, repository: execution.repositoryRoot }); execution.status = 'complete'; execution.finalCommit = commit; execution.completedAt = this.now().toISOString(); this.scheduler.save(execution); return commit; }
}

module.exports = { IntegrationCoordinator };
