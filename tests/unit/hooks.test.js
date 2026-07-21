'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { PlanStore } = require('../../src/core/plans');
const { handleHook, newestProposedPlan } = require('../../src/hooks/capture-plan');

function repository(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bdfl-hooks-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q', root]);
  fs.mkdirSync(path.join(root, '.bdfl'), { recursive: true });
  fs.writeFileSync(path.join(root, '.bdfl', 'state.json'), JSON.stringify({ runs: [{ status: 'running' }] }));
  let id = 0;
  return { root, store: new PlanStore(root, { id: () => `id${++id}abcdef`, now: () => new Date('2026-01-01T00:00:00Z') }) };
}

test('Claude captures rejected revisions in one episode and separates a later episode', (t) => {
  const { root, store } = repository(t);
  const base = { cwd: root, session_id: 'session', hook_event_name: 'PreToolUse', tool_name: 'ExitPlanMode' };
  const options = { store, hostIsLive: () => true };
  handleHook('claude', { ...base, tool_input: { plan: '# Initial', planFilePath: '/plans/one.md' } }, options);
  handleHook('claude', { ...base, tool_input: { plan: '# Revised', planFilePath: '/plans/one.md' } }, options);
  assert.equal(store.list().length, 1);
  assert.equal(store.list()[0].versions.length, 2);
  handleHook('claude', { ...base, hook_event_name: 'PostToolUse', tool_input: {} }, options);
  handleHook('claude', { ...base, tool_input: { plan: '# Later', planFilePath: '/plans/two.md' } }, options);
  assert.equal(store.list().length, 2);
});

test('Codex captures the newest complete proposed plan and recognizes plan episodes', (t) => {
  const { root, store } = repository(t);
  const transcript = path.join(root, 'transcript.jsonl');
  fs.writeFileSync(transcript, 'old <proposed_plan># One</proposed_plan> newer <proposed_plan># Two</proposed_plan>');
  assert.equal(newestProposedPlan(transcript), '# Two');
  const base = { cwd: root, session_id: 'session', transcript_path: transcript, hook_event_name: 'Stop' };
  const options = { store, hostIsLive: () => true };
  handleHook('codex', { ...base, permission_mode: 'plan' }, options);
  handleHook('codex', { ...base, permission_mode: 'default' }, options);
  fs.appendFileSync(transcript, '<proposed_plan># Three</proposed_plan>');
  handleHook('codex', { ...base, permission_mode: 'plan' }, options);
  assert.equal(store.list().length, 2);
});

test('hooks are silent outside active Git repositories', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bdfl-nohook-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.equal(handleHook('codex', { cwd: root, hook_event_name: 'Stop', permission_mode: 'plan' }, { hostIsLive: () => true }), null);
});

test('plan capture is gated by matching host MCP presence, not an activation record', (t) => {
  const { root, store } = repository(t);
  fs.rmSync(path.join(root, '.bdfl', 'state.json'));
  const payload = { cwd: root, session_id: 'session', hook_event_name: 'PreToolUse', tool_name: 'ExitPlanMode', tool_input: { plan: '# Captured' } };
  assert.equal(handleHook('claude', payload, { store, hostIsLive: () => false }), null);
  handleHook('claude', payload, { store, hostIsLive: (host) => host === 'claude' });
  assert.equal(store.list().length, 1);
});
