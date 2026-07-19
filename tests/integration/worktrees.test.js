'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { WorktreeManager } = require('../../src/worktrees/manager');

function git(root, args) {
  return `${execFileSync('git', args, { cwd: root, encoding: 'utf8' })}`.trim();
}

function repository(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bdfl-git-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  git(root, ['init', '-q']);
  git(root, ['config', 'user.name', 'BDFL Tests']);
  git(root, ['config', 'user.email', 'tests@example.com']);
  fs.writeFileSync(path.join(root, '.gitignore'), '.bdfl/\n');
  fs.writeFileSync(path.join(root, 'base.txt'), 'base\n');
  git(root, ['add', '.gitignore', 'base.txt']);
  git(root, ['commit', '-qm', 'base']);
  return root;
}

test('refuses dirty main worktrees without making a snapshot', (t) => {
  const root = repository(t);
  fs.writeFileSync(path.join(root, 'base.txt'), 'dirty\n');
  const manager = new WorktreeManager(root);
  assert.throws(() => manager.create('task', 1), (error) => error.code === 'DIRTY_WORKTREE');
  assert.equal(git(root, ['log', '--oneline']).split('\n').length, 1);
});

test('creates isolated branches and enforces allowed changed paths', (t) => {
  const root = repository(t);
  const manager = new WorktreeManager(root);
  const attempt = manager.create('task-a', 1);
  assert.notEqual(attempt.worktree, root);
  fs.mkdirSync(path.join(attempt.worktree, 'src'));
  fs.writeFileSync(path.join(attempt.worktree, 'src', 'ok.js'), 'ok\n');
  fs.writeFileSync(path.join(attempt.worktree, 'bad.txt'), 'bad\n');
  git(attempt.worktree, ['add', 'src/ok.js', 'bad.txt']);
  git(attempt.worktree, ['commit', '-qm', 'attempt']);
  assert.throws(() => manager.assertAllowedChanges('HEAD', attempt.branch, ['src']), /outside allowed paths/);
  assert.deepEqual(manager.assertAllowedChanges('HEAD', attempt.branch, ['src', 'bad.txt']).sort(), ['bad.txt', 'src/ok.js']);
});
