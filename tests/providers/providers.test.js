'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildInvocation, preflight, normalizeEvent } = require('../../src/providers');

test('builds exact Codex JSONL invocation with model and effort', () => {
  const invocation = buildInvocation('codex:gpt-5.6:high', {
    host: 'codex', permissionMode: 'default', prompt: 'do work'
  });
  assert.equal(invocation.command, 'codex');
  assert.deepEqual(invocation.args, [
    'exec', '--json', '-m', 'gpt-5.6', '-c', 'model_reasoning_effort="high"', '--sandbox', 'workspace-write', 'do work'
  ]);
});

test('uses the parent host Ollama harness without losing tag colons', () => {
  const invocation = buildInvocation('ollama:qwen3.5:9b:medium', {
    host: 'codex', permissionMode: 'read-only', prompt: 'do work', ollamaBaseUrl: 'http://localhost:11434'
  });
  assert.equal(invocation.command, 'codex');
  assert.equal(invocation.args[invocation.args.indexOf('-m') + 1], 'qwen3.5:9b');
  assert.ok(invocation.args.includes('--oss'));
});

test('preflight exposes missing executables and models as visible states', () => {
  const missing = preflight('codex:gpt-5.6:medium', { host: 'codex', permissionMode: 'default' }, () => ({ status: 1 }));
  assert.deepEqual(missing, { ok: false, code: 'executable', message: 'codex is unavailable' });
  const fakeRun = (command, args) => command === 'ollama' && args[0] === 'list'
    ? { status: 0, stdout: 'NAME\nllama3:latest' }
    : { status: 0, stdout: 'version' };
  const model = preflight('ollama:qwen3.5:9b:medium', {
    host: 'codex', permissionMode: 'default', ollamaBaseUrl: 'http://localhost:11434'
  }, fakeRun);
  assert.equal(model.code, 'model');
});

test('preflight exposes authentication failures without fallback', () => {
  const fakeRun = (_command, args) => args[0] === '--version' ? { status: 0, stdout: 'version' } : { status: 1, stderr: 'not logged in' };
  const result = preflight('codex:gpt-5.6:medium', { host: 'codex', permissionMode: 'default' }, fakeRun);
  assert.deepEqual(result, { ok: false, code: 'authentication', message: 'Codex authentication is unavailable' });
});


test('normalizes provider sessions, permissions, questions, and failures', () => {
  assert.deepEqual(normalizeEvent('codex', { type: 'thread.started', thread_id: 's1' }).sessionId, 's1');
  assert.equal(normalizeEvent('codex', { type: 'approval.requested' }).type, 'permission');
  assert.equal(normalizeEvent('claude', { type: 'question', question: 'Which?' }).type, 'question');
  assert.equal(normalizeEvent('codex', { type: 'turn.failed', message: 'boom' }).type, 'error');
});
