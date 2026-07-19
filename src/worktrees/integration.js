'use strict';

const { execFileSync } = require('node:child_process');

class IntegrationBatch {
  constructor(root, runId, { git = execFileSync, run = execFileSync } = {}) {
    this.root = root;
    this.branch = `bdfl/integration-${runId}`;
    this.git = (args, options = {}) => `${git('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options })}`.trim();
    this.run = run;
    this.validated = false;
    this.applied = [];
  }

  start(base = 'HEAD') {
    this.git(['switch', '-c', this.branch, base]);
    return this.branch;
  }

  apply(commit, changedFiles) {
    if (!Array.isArray(changedFiles) || !changedFiles.length) throw new Error('Explicit changed files are required');
    this.git(['cherry-pick', '--no-commit', commit]);
    const staged = this.git(['diff', '--cached', '--name-only']).split('\n').filter(Boolean);
    const unexpected = staged.filter((file) => !changedFiles.includes(file));
    if (unexpected.length) throw new Error(`Integration contains unexpected paths: ${unexpected.join(', ')}`);
    this.git(['reset']);
    this.git(['add', '--', ...changedFiles]);
    this.applied.push({ commit, changedFiles: [...changedFiles] });
  }

  validate(commands) {
    const results = [];
    for (const [command, ...args] of commands) {
      try {
        const output = `${this.run(command, args, { cwd: this.root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })}`;
        results.push({ command: [command, ...args], ok: true, output });
      } catch (error) {
        this.validated = false;
        results.push({ command: [command, ...args], ok: false, output: `${error.stderr || error.message}` });
        return results;
      }
    }
    this.validated = true;
    return results;
  }

  integrationOffer() {
    return this.validated
      ? { ready: true, branch: this.branch, action: 'i' }
      : { ready: false, reason: 'Batch validation has not succeeded' };
  }
}

module.exports = { IntegrationBatch };
