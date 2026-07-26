'use strict';
const test = require('node:test'); const assert = require('node:assert/strict'); const { WorkstreamWizard } = require('../../src/tui/wizard');

function enter(wizard, value = '') { for (const character of value) wizard.handle(character); return wizard.handle('\r'); }
function planning(wizard) { assert.equal(wizard.key(), 'sessionType'); enter(wizard); }
function direct(wizard) { assert.equal(wizard.key(), 'sessionType'); wizard.handle('\u001b[B'); enter(wizard); }
const models = { claude: ['opus'], codex: ['gpt-5.4'], ollama: [] };
const planningPreset = { version: 1, delegatorProfile: { provider: 'claude', model: 'opus', effort: 'high', argv: ['--chrome'] }, workerProfile: { provider: 'codex', model: 'gpt-5.4', effort: 'medium', permissionMode: 'workspace-write', argv: ['--search'] }, workerCapacity: 3 };
const directProfile = { provider: 'codex', model: 'gpt-5.4', effort: 'high', permissionMode: 'workspace-write', argv: ['--search'] };

test('preselects the remembered committed repository and asks for session type next', () => {
  const repositories = [{ root: '/projects/alpha', label: 'alpha', lastUsed: null }, { root: '/projects/claudia', label: 'claudia', lastUsed: planningPreset }];
  const wizard = new WorkstreamWizard({ models, repositories, rememberedRepositoryRoot: '/projects/claudia' });
  assert.equal(wizard.key(), 'repository'); assert.equal(wizard.selection, 1); assert.match(wizard.render(), /claudia/); enter(wizard); assert.equal(wizard.key(), 'sessionType'); assert.equal(wizard.values.repositoryRoot, '/projects/claudia');
});

test('falls back to the first repository and explains an empty picker', () => {
  const one = new WorkstreamWizard({ models, repositories: [{ root: '/one', label: 'one', lastUsed: null }], rememberedRepositoryRoot: '/missing' }); assert.equal(one.selection, 0);
  const empty = new WorkstreamWizard({ models, repositories: [] }); assert.match(empty.render(), /No Git repository with at least one commit/);
});

test('distinguishes planning and direct sessions before agent setup', () => {
  const wizard = new WorkstreamWizard({ models }); const screen = wizard.render().replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '');
  assert.match(screen, /Plan and delegate/); assert.match(screen, /read-only planning agent and isolated managed workers/); assert.match(screen, /Work directly/); assert.match(screen, /workspace-write agent without BDFL delegation tools/);
  planning(wizard); assert.equal(wizard.key(), 'delegatorProvider'); wizard.back(); direct(wizard); assert.equal(wizard.key(), 'directProvider');
});

test('creates a planning configuration with read-only planning and editable worker presets', () => {
  const wizard = new WorkstreamWizard({ models: { claude: ['opus'], codex: ['gpt-5.4'] } }); planning(wizard);
  enter(wizard); enter(wizard); wizard.handle('\u001b[B'); enter(wizard); enter(wizard, '--chrome'); wizard.handle('\u001b[B'); enter(wizard); enter(wizard); enter(wizard); enter(wizard, '--search'); wizard.input = ''; enter(wizard, '3'); const result = enter(wizard);
  assert.equal(result.sessionType, 'planning'); assert.equal(result.delegatorProfile.model, 'opus'); assert.deepEqual(result.delegatorProfile.argv, ['--chrome']); assert.equal(result.workerProfile.provider, 'codex'); assert.equal(result.workerProfile.permissionMode, 'workspace-write'); assert.deepEqual(result.workerProfile.argv, ['--search']); assert.equal(result.workerCapacity, 3);
});

test('creates a direct configuration with only one editable profile', () => {
  const wizard = new WorkstreamWizard({ models: { codex: ['gpt-5.4'] } }); direct(wizard); enter(wizard); enter(wizard); wizard.handle('\u001b[B'); enter(wizard); enter(wizard, '--search'); const result = enter(wizard);
  assert.deepEqual(result, { version: 1, sessionType: 'direct', directProfile: { provider: 'codex', model: 'gpt-5.4', effort: 'medium', permissionMode: 'workspace-write', argv: ['--search'] } }); assert.equal(result.delegatorProfile, undefined); assert.equal(result.workerProfile, undefined); assert.match(wizard.summary(result).join('\n'), /Direct agent/);
});

test('offers independent last-used presets for each session type', () => {
  const lastUsed = { ...planningPreset, directProfile }; const planningWizard = new WorkstreamWizard({ models, lastUsed }); planning(planningWizard); assert.equal(planningWizard.key(), 'preset'); assert.match(planningWizard.render(), /Planning agent.*Claude Code/); const restoredPlanning = enter(planningWizard); assert.equal(restoredPlanning.sessionType, 'planning'); assert.equal(restoredPlanning.workerCapacity, 3);
  const directWizard = new WorkstreamWizard({ models, lastUsed }); direct(directWizard); assert.equal(directWizard.key(), 'preset'); assert.match(directWizard.render(), /Direct agent.*Codex/); assert.deepEqual(enter(directWizard).directProfile, directProfile);
});

test('preserves type-specific values and cursor choices when going back', () => {
  const wizard = new WorkstreamWizard({ models: { claude: ['opus'], codex: ['gpt-5.4'] } }); direct(wizard); wizard.handle('\u001b[B'); enter(wizard); assert.equal(wizard.values.directProvider, 'codex'); wizard.back(); assert.equal(wizard.key(), 'directProvider'); assert.equal(wizard.selection, 1); wizard.back(); assert.equal(wizard.key(), 'sessionType'); assert.equal(wizard.selection, 1); enter(wizard); assert.equal(wizard.key(), 'directProvider'); assert.equal(wizard.selection, 1);
});

test('accepts manual Ollama models and validates worker capacity', () => {
  const directWizard = new WorkstreamWizard({ catalogs: { ollama: [] } }); direct(directWizard); enter(directWizard); assert.equal(directWizard.key(), 'directModel'); assert.match(directWizard.render(), /Enter the model ID/); enter(directWizard, 'qwen3:4b'); assert.equal(directWizard.values.directModel, 'qwen3:4b');
  const planningWizard = new WorkstreamWizard({ models: { claude: ['opus'] } }); planning(planningWizard); planningWizard.values.workerCapacity = 5; planningWizard.step = planningWizard.steps.indexOf('workerCapacity'); planningWizard.input = '9'; planningWizard.submitText(); assert.match(planningWizard.message, /whole number from 1 to 5/);
});

test('renders either setup and confirmation within a standard terminal', () => {
  const wizard = new WorkstreamWizard({ models: { claude: ['opus'] } }); planning(wizard); wizard.step = wizard.steps.indexOf('confirmation'); wizard.values = { sessionType: 'planning', delegatorProvider: 'claude', delegatorModel: 'opus', delegatorEffort: 'medium', delegatorArgs: [], workerProvider: 'claude', workerModel: 'opus', workerEffort: 'medium', workerArgs: [], workerCapacity: 5 }; const lines = wizard.render().split('\n'); assert.ok(lines.length <= 21); assert.match(lines.join('\n'), /Create session/); assert.match(lines.join('\n'), /1\. Planning agent/); assert.match(lines.join('\n'), /7\. Max worker count/);
});
