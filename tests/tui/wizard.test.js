'use strict';
const test = require('node:test'); const assert = require('node:assert/strict'); const { STEPS, WorkstreamWizard } = require('../../src/tui/wizard');

function enter(wizard, value) { for (const character of value) wizard.handle(character); wizard.handle('\r'); }

test('expands each setup section directly beneath its heading', () => {
  const wizard = new WorkstreamWizard({ models: { claude: ['opus', 'sonnet'], codex: ['gpt-5.4'] } });
  const first = wizard.render();
  const plain = first.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '');
  assert.match(first, /1\. Delegator agent[^\n]*\n[^\n]*This is the main agent[^\n]*\n[^\n]*Claude Code[^\n]*\n[^\n]*Codex/);
  assert.match(first, /7\. Max worker count[^\n]*5 \(default\)/);
  assert.match(plain, /Codex\n\n○ 2\. Delegator model/);
  assert.match(plain, /^○ 1\. Delegator agent$/m);
  assert.match(plain, /Esc\/Ctrl\+\] back/);
  assert.doesNotMatch(first, /\u001b\[48;5;81m/);
  assert.doesNotMatch(first, /delegatorProvider/);
  wizard.handle('\r');
  assert.equal(wizard.key(), 'delegatorModel');
  assert.match(wizard.render(), /2\. Delegator model[^\n]*\n[^\n]*Models are read[^\n]*\n[^\n]*opus[^\n]*\n[^\n]*sonnet/);
});

test('shows only installed tools and model-specific effort levels under the model section', () => {
  const wizard = new WorkstreamWizard({ catalogs: { codex: [{ id: 'gpt-live', label: 'GPT Live', efforts: ['low', 'medium', 'high', 'xhigh', 'max'], defaultEffort: 'high' }] } });
  assert.deepEqual(wizard.options(), ['codex']);
  wizard.handle('\r');
  assert.deepEqual(wizard.options(), ['gpt-live', 'Type a model ID…']);
  wizard.handle('\r');
  assert.equal(wizard.key(), 'delegatorEffort');
  assert.deepEqual(wizard.options(), ['low', 'medium', 'high']);
  assert.match(wizard.render(), /2\. Delegator model[^\n]*gpt-live[^\n]*\n[^\n]*How much reasoning[^\n]*\n[^\n]*Low[^\n]*\n[^\n]*Medium[^\n]*\n[^\n]*High/);
  assert.doesNotMatch(wizard.render(), /Extra high|Maximum/);
});

test('accepts delegator and worker options, custom worker models, and defaults capacity to five', () => {
  const wizard = new WorkstreamWizard({ models: { claude: ['opus'], codex: ['gpt-5.4'] } });
  wizard.handle('\r');
  wizard.handle('\r');
  wizard.handle('\r');
  enter(wizard, '--chrome');
  wizard.handle('\u001b[B');
  wizard.handle('\r');
  assert.deepEqual(wizard.options(), ['gpt-5.4', 'Type a model ID…']);
  wizard.handle('\u001b[B');
  wizard.handle('\r');
  enter(wizard, 'vendor/custom-worker');
  wizard.handle('\r');
  enter(wizard, '--search');
  assert.equal(wizard.key(), 'workerCapacity');
  assert.equal(wizard.input, '5');
  wizard.handle('\r');
  const result = wizard.handle('\r');
  assert.equal(result.delegatorProfile.model, 'opus');
  assert.deepEqual(result.delegatorProfile.argv, ['--chrome']);
  assert.equal(result.workerProfile.provider, 'codex');
  assert.equal(result.workerProfile.model, 'vendor/custom-worker');
  assert.deepEqual(result.workerProfile.argv, ['--search']);
  assert.equal(result.workerCapacity, 5);
});

test('keeps every section and completed answer visible while allowing edits', () => {
  const wizard = new WorkstreamWizard({ models: { claude: ['opus'], codex: ['gpt-5.4'] } });
  wizard.handle('\r');
  assert.match(wizard.render(), /1\. Delegator agent.*Claude Code/);
  assert.match(wizard.render(), /7\. Max worker count.*5 \(default\)/);
  wizard.handle('\u001b[D');
  assert.equal(wizard.key(), 'delegatorProvider');
  wizard.handle('\u001b[B');
  wizard.handle('\r');
  assert.equal(wizard.values.delegatorProvider, 'codex');
  assert.match(wizard.render(), /1\. Delegator agent.*Codex/);
});

test('validates max worker count as a numeric field', () => {
  const wizard = new WorkstreamWizard({ models: { claude: ['opus'] } });
  wizard.step = STEPS.indexOf('workerCapacity');
  wizard.input = '9';
  wizard.submitText();
  assert.match(wizard.message, /whole number from 1 to 5/);
  wizard.input = '3';
  wizard.submitText();
  assert.equal(wizard.values.workerCapacity, 3);
});

test('offers the complete last-used setup as the first choice', () => {
  const lastUsed = { version: 1, delegatorProfile: { provider: 'claude', model: 'opus', effort: 'high', argv: ['--chrome'] }, workerProfile: { provider: 'codex', model: 'custom', effort: 'medium', permissionMode: 'workspace-write', argv: ['--search'] }, workerCapacity: 3 };
  const wizard = new WorkstreamWizard({ models: { claude: ['opus'], codex: ['custom'] }, lastUsed });
  const screen = wizard.render();
  assert.match(screen, /Last used/);
  assert.match(screen, /Claude Code · opus · High · --chrome/);
  assert.match(screen, /Codex · custom · Medium · --search/);
  assert.match(screen, /Max workers      3/);
  assert.deepEqual(wizard.handle('\r'), lastUsed);
});

test('offers manually entered models in the last-used setup', () => {
  const lastUsed = { version: 1, delegatorProfile: { provider: 'claude', model: 'custom/planner', effort: 'high' }, workerProfile: { provider: 'codex', model: 'custom/worker', effort: 'medium', permissionMode: 'workspace-write' }, workerCapacity: 3 };
  const wizard = new WorkstreamWizard({ models: { claude: ['opus'], codex: ['gpt-5.4'] }, lastUsed });
  assert.equal(wizard.key(), 'preset');
  assert.deepEqual(wizard.handle('\r'), lastUsed);
});

test('keeps all setup sections and confirmation controls visible in a standard terminal', () => {
  const wizard = new WorkstreamWizard({ models: { claude: ['opus'] } });
  wizard.step = STEPS.indexOf('confirmation');
  wizard.values = { delegatorProvider: 'claude', delegatorModel: 'opus', delegatorEffort: 'medium', delegatorArgs: [], workerProvider: 'claude', workerModel: 'worker', workerEffort: 'medium', workerArgs: [], workerCapacity: 5 };
  const lines = wizard.render().split('\n');
  assert.ok(lines.length <= 21);
  assert.match(lines.join('\n'), /Create session/);
  assert.match(lines.join('\n'), /1\. Delegator agent/);
  assert.match(lines.join('\n'), /7\. Max worker count/);
  assert.doesNotMatch(lines.join('\n'), /Worker access|workstream/i);
});
