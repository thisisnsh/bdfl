'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { IntegrationBatch } = require('../../src/worktrees/integration');

function git(root, args) { return `${execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })}`.trim(); }

function repository(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bdfl-batch-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  git(root, ['init', '-q']);
  git(root, ['config', 'user.name', 'BDFL Tests']);
  git(root, ['config', 'user.email', 'tests@example.com']);
  fs.writeFileSync(path.join(root, 'value.txt'), 'base\n');
  git(root, ['add', 'value.txt']); git(root, ['commit', '-qm', 'base']);
  return { root, main: git(root, ['branch', '--show-current']) };
}

test('stages approved files on a temporary branch and offers only validated work', (t) => {
  const { root, main } = repository(t);
  git(root, ['switch', '-qc', 'agent/task']);
  fs.writeFileSync(path.join(root, 'value.txt'), 'agent\n');
  git(root, ['add', 'value.txt']); git(root, ['commit', '-qm', 'agent']);
  const commit = git(root, ['rev-parse', 'HEAD']);
  git(root, ['switch', '-q', main]);
  const batch = new IntegrationBatch(root, 'run-1');
  const started = batch.start();
  assert.deepEqual(batch.integrationOffer(), { ready: false, reason: 'Batch validation has not succeeded' });
  batch.apply(commit, ['value.txt']);
  assert.equal(git(started.worktree, ['diff', '--name-only', `${started.base}..HEAD`]), 'value.txt');
  assert.equal(batch.validate([['node', '-e', 'process.exit(0)']])[0].ok, true);
  assert.deepEqual(batch.integrationOffer(), { ready: true, branch: 'bdfl/integration-run-1', worktree: started.worktree });
  assert.equal(git(root, ['branch', '--show-current']), main);
  batch.accept();
  assert.equal(fs.readFileSync(path.join(root, 'value.txt'), 'utf8'), 'agent\n');
});

test('keeps integration conflicts away from the main branch', (t) => {
  const { root, main } = repository(t);
  git(root, ['switch', '-qc', 'agent/conflict']);
  fs.writeFileSync(path.join(root, 'value.txt'), 'agent\n');
  git(root, ['add', 'value.txt']); git(root, ['commit', '-qm', 'agent']);
  const commit = git(root, ['rev-parse', 'HEAD']);
  git(root, ['switch', '-q', main]);
  fs.writeFileSync(path.join(root, 'value.txt'), 'parent\n');
  git(root, ['add', 'value.txt']); git(root, ['commit', '-qm', 'parent']);
  const batch = new IntegrationBatch(root, 'run-conflict');
  const started = batch.start();
  assert.throws(() => batch.apply(commit, ['value.txt']));
  assert.equal(git(root, ['branch', '--show-current']), main);
  assert.match(fs.readFileSync(path.join(started.worktree, 'value.txt'), 'utf8'), /<<<<<<<|>>>>>>>/);
});
