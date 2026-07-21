'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { execSync } = require('node:child_process');

class WorktreeManager {
  constructor(root, { git = execFileSync, io = fs } = {}) {
    this.root = path.resolve(root);
    this.directory = path.join(this.root, '.bdfl', 'worktrees');
    this.git = (args, options = {}) => `${git('git', args, { cwd: this.root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options })}`.trim();
    this.io = io;
  }

  status() { return this.git(['status', '--porcelain=v1', '--untracked-files=all']); }

  assertClean() {
    const dirty = this.status();
    if (dirty) {
      const error = new Error('Main worktree is dirty; clean it, authorize a recoverable snapshot, or cancel');
      error.code = 'DIRTY_WORKTREE';
      error.files = dirty.split('\n');
      throw error;
    }
  }

  create(taskId, attempt, base = 'HEAD') {
    this.assertClean();
    const safe = `${taskId}-${attempt}`.replace(/[^a-zA-Z0-9._-]/g, '-');
    const branch = `bdfl/${safe}`;
    const worktree = path.join(this.directory, safe);
    this.io.mkdirSync(this.directory, { recursive: true });
    const baseCommit = this.git(['rev-parse', base]);
    this.git(['worktree', 'add', '-b', branch, worktree, baseCommit]);
    return { branch, worktree, taskId, attempt, base: baseCommit };
  }

  checkpoint(worktree, message) {
    execFileSync('git', ['add', '-A'], { cwd: worktree, stdio: ['ignore', 'pipe', 'pipe'] });
    const staged = `${execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: worktree, encoding: 'utf8' })}`.trim();
    if (staged) execFileSync('git', ['commit', '-m', message], { cwd: worktree, stdio: ['ignore', 'pipe', 'pipe'] });
    return `${execFileSync('git', ['rev-parse', 'HEAD'], { cwd: worktree, encoding: 'utf8' })}`.trim();
  }

  validate(worktree, commands) {
    const results = [];
    for (const command of commands || []) {
      try { results.push({ command, ok: true, output: `${execSync(command, { cwd: worktree, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })}` }); }
      catch (error) { results.push({ command, ok: false, output: `${error.stderr || error.message}` }); break; }
    }
    return results;
  }

  changedFiles(base, head) {
    const output = this.git(['diff', '--name-only', '--diff-filter=ACMRTUXB', `${base}...${head}`]);
    return output ? output.split('\n') : [];
  }

  assertAllowedChanges(base, head, allowedPaths) {
    const { pathsOverlap } = require('../core/tasks');
    const changed = this.changedFiles(base, head);
    const disallowed = changed.filter((file) => !allowedPaths.some((allowed) => pathsOverlap(file, allowed)));
    if (disallowed.length) throw new Error(`Agent changed files outside allowed paths: ${disallowed.join(', ')}`);
    return changed;
  }
}

module.exports = { WorktreeManager };
