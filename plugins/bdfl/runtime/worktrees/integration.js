'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, execSync } = require('node:child_process');

class IntegrationBatch {
  constructor(root, runId, { git = execFileSync, run = execSync, io = fs } = {}) {
    this.root = root;
    this.branch = `bdfl/integration-${runId}`;
    this.worktree = path.join(root, '.bdfl', 'worktrees', `integration-${runId}`);
    this.execGit = git;
    this.run = run;
    this.io = io;
    this.validated = false;
    this.applied = [];
  }

  git(args, cwd = this.root) { return `${this.execGit('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })}`.trim(); }

  start(base = 'HEAD') {
    const baseCommit = this.git(['rev-parse', base]);
    this.io.mkdirSync(path.dirname(this.worktree), { recursive: true });
    this.git(['worktree', 'add', '-b', this.branch, this.worktree, baseCommit]);
    this.base = baseCommit;
    return { branch: this.branch, worktree: this.worktree, base: baseCommit };
  }

  apply(commit, changedFiles) {
    if (!Array.isArray(changedFiles) || !changedFiles.length) throw new Error('Explicit changed files are required');
    this.git(['cherry-pick', commit], this.worktree);
    const actual = this.git(['diff', '--name-only', `${commit}^`, commit], this.worktree).split('\n').filter(Boolean);
    const unexpected = actual.filter((file) => !changedFiles.includes(file));
    if (unexpected.length) throw new Error(`Integration contains unexpected paths: ${unexpected.join(', ')}`);
    this.applied.push({ commit, changedFiles: [...changedFiles] });
  }

  validate(commands) {
    const results = [];
    for (const command of commands) {
      try {
        const value = Array.isArray(command)
          ? this.execGit(command[0], command.slice(1), { cwd: this.worktree, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
          : this.run(command, { cwd: this.worktree, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
        results.push({ command, ok: true, output: `${value || ''}` });
      } catch (error) {
        this.validated = false;
        results.push({ command, ok: false, output: `${error.stderr || error.message}` });
        return results;
      }
    }
    this.validated = true;
    return results;
  }

  head() { return this.git(['rev-parse', 'HEAD'], this.worktree); }
  diff() { return this.git(['diff', '--no-ext-diff', `${this.base}..HEAD`], this.worktree); }
  files() { return this.git(['diff', '--name-only', `${this.base}..HEAD`], this.worktree).split('\n').filter(Boolean); }
  diffstat() { return this.git(['diff', '--stat', `${this.base}..HEAD`], this.worktree); }
  accept() { this.git(['merge', '--ff-only', this.branch], this.root); return this.git(['rev-parse', 'HEAD'], this.root); }

  integrationOffer() {
    return this.validated ? { ready: true, branch: this.branch, worktree: this.worktree } : { ready: false, reason: 'Batch validation has not succeeded' };
  }
}

module.exports = { IntegrationBatch };
