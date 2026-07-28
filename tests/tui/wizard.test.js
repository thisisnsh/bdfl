'use strict';
const test = require('node:test'); const assert = require('node:assert/strict'); const { WorkstreamWizard } = require('../../src/tui/wizard');

function enter(wizard, value = '') { for (const character of value) wizard.handle(character); return wizard.handle('\r'); }
function select(wizard, index) { wizard.selection = index; return enter(wizard); }
function planning(wizard) { if (wizard.key() === 'repository') enter(wizard); assert.equal(wizard.key(), 'sessionType'); enter(wizard); assert.equal(wizard.key(), 'preset'); enter(wizard); }
function direct(wizard) { if (wizard.key() === 'repository') enter(wizard); assert.equal(wizard.key(), 'sessionType'); select(wizard, 1); assert.equal(wizard.key(), 'preset'); enter(wizard); }
const models = { claude: ['opus'], codex: ['gpt-5.4'], ollama: [] };
const planningPreset = { version: 1, delegatorProfile: { provider: 'claude', model: 'opus', effort: 'high', argv: ['--chrome'] }, workerProfile: { provider: 'codex', model: 'gpt-5.4', effort: 'medium', permissionMode: 'workspace-write', argv: ['--search'] }, workerCapacity: 3 };
const directProfile = { provider: 'codex', model: 'gpt-5.4', effort: 'high', permissionMode: 'workspace-write', argv: ['--search'] };

test('preselects the remembered committed repository and asks for session type next', () => {
  const repositories = [{ root: '/projects/alpha', label: 'alpha', lastUsed: null }, { root: '/projects/claudia', label: 'claudia', lastUsed: planningPreset }];
  const wizard = new WorkstreamWizard({ models, repositories, rememberedRepositoryRoot: '/projects/claudia' });
  assert.equal(wizard.key(), 'repository'); assert.equal(wizard.selection, 1); assert.match(wizard.render(), /Repository[\s\S]*claudia[\s\S]*Session type/); enter(wizard); assert.equal(wizard.key(), 'sessionType'); assert.equal(wizard.values.repositoryRoot, '/projects/claudia'); assert.match(wizard.render(), /Repository.*claudia[\s\S]*Session type[\s\S]*Planning agent/);
});

test('falls back to the first repository and explains an empty picker', () => {
  const one = new WorkstreamWizard({ models, repositories: [{ root: '/one', label: 'one', lastUsed: null }], rememberedRepositoryRoot: '/missing' }); assert.equal(one.selection, 0);
  assert.equal(one.key(), 'repository'); enter(one); enter(one); assert.equal(one.key(), 'preset'); assert.deepEqual(one.options(), ['Customize']);
  const empty = new WorkstreamWizard({ models, repositories: [] }); assert.match(empty.render(), /No Git repository with at least one commit/);
});

test('arrows choose wizard options, left goes back, and no body click targets are exposed', () => {
  const repositories = Array.from({ length: 7 }, (_, index) => ({ root: `/repo/${index}`, label: `repo-${index}`, lastUsed: null })); const wizard = new WorkstreamWizard({ models, repositories }); wizard.render(); for (let index = 0; index < 3; index += 1) wizard.handle('\u001b[B'); assert.equal(wizard.selection, 3); assert.equal(wizard.scrolls.repository || 0, 0); enter(wizard); assert.equal(wizard.values.repositoryRoot, '/repo/3'); assert.equal(wizard.key(), 'sessionType'); assert.deepEqual(wizard.lastHits, []); wizard.handle('\u001b[D'); assert.equal(wizard.key(), 'repository'); assert.equal(wizard.selection, 3);
});

test('distinguishes planning and direct sessions before agent setup', () => {
  const wizard = new WorkstreamWizard({ models }); enter(wizard); const screen = wizard.render().replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '');
  assert.match(screen, /Planning agent/); assert.match(screen, /read-only planning agent and isolated managed workers/); assert.match(screen, /Worker agent/); assert.match(screen, /workspace-write agent without BDFL delegation tools/);
  planning(wizard); assert.equal(wizard.key(), 'delegatorProvider'); wizard.back(); wizard.back(); direct(wizard); assert.equal(wizard.key(), 'directProvider');
});

test('creates a planning configuration with read-only planning and editable worker presets', () => {
  const wizard = new WorkstreamWizard({ models: { claude: ['opus'], codex: ['gpt-5.4'] } }); planning(wizard);
  enter(wizard); enter(wizard); select(wizard, 1); enter(wizard, '--chrome'); select(wizard, 1); enter(wizard); enter(wizard); enter(wizard, '--search'); wizard.input = ''; enter(wizard, '3'); const result = enter(wizard);
  assert.equal(result.sessionType, 'planning'); assert.equal(result.delegatorProfile.model, 'opus'); assert.deepEqual(result.delegatorProfile.argv, ['--chrome']); assert.equal(result.workerProfile.provider, 'codex'); assert.equal(result.workerProfile.permissionMode, 'workspace-write'); assert.deepEqual(result.workerProfile.argv, ['--search']); assert.equal(result.workerCapacity, 3);
});

test('creates a direct configuration with only one editable profile', () => {
  const wizard = new WorkstreamWizard({ models: { codex: ['gpt-5.4'] } }); direct(wizard); enter(wizard); enter(wizard); select(wizard, 1); enter(wizard, '--search'); const result = enter(wizard);
  assert.deepEqual(result, { version: 1, sessionType: 'direct', directProfile: { provider: 'codex', model: 'gpt-5.4', effort: 'medium', permissionMode: 'workspace-write', argv: ['--search'] } }); assert.equal(result.delegatorProfile, undefined); assert.equal(result.workerProfile, undefined); assert.match(wizard.summary(result).join('\n'), /Direct agent/);
});

test('offers independent last-used presets for each session type', () => {
  const lastUsed = { ...planningPreset, directProfile }; const planningWizard = new WorkstreamWizard({ models, lastUsed }); enter(planningWizard); enter(planningWizard); assert.equal(planningWizard.key(), 'preset'); assert.match(planningWizard.render(), /Planning agent.*Claude Code/); const restoredPlanning = enter(planningWizard); assert.equal(restoredPlanning.sessionType, 'planning'); assert.equal(restoredPlanning.workerCapacity, 3);
  const directWizard = new WorkstreamWizard({ models, lastUsed }); enter(directWizard); select(directWizard, 1); assert.equal(directWizard.key(), 'preset'); assert.match(directWizard.render(), /Direct agent.*Codex/); assert.deepEqual(enter(directWizard).directProfile, directProfile);
});

test('preserves type-specific values and cursor choices when going back', () => {
  const wizard = new WorkstreamWizard({ models: { claude: ['opus'], codex: ['gpt-5.4'] } }); direct(wizard); select(wizard, 1); assert.equal(wizard.values.directProvider, 'codex'); wizard.back(); assert.equal(wizard.key(), 'directProvider'); assert.equal(wizard.selection, 1); wizard.back(); assert.equal(wizard.key(), 'preset'); wizard.back(); assert.equal(wizard.key(), 'sessionType'); assert.equal(wizard.selection, 1); enter(wizard); enter(wizard); assert.equal(wizard.key(), 'directProvider'); assert.equal(wizard.selection, 1);
});

test('accepts manual Ollama models and validates worker capacity', () => {
  const directWizard = new WorkstreamWizard({ catalogs: { ollama: [] } }); direct(directWizard); enter(directWizard); assert.equal(directWizard.key(), 'directModel'); assert.match(directWizard.render(), /Enter the model ID/); enter(directWizard, 'qwen3:4b'); assert.equal(directWizard.values.directModel, 'qwen3:4b');
  const planningWizard = new WorkstreamWizard({ models: { claude: ['opus'] } }); planning(planningWizard); planningWizard.values.workerCapacity = 5; planningWizard.step = planningWizard.steps.indexOf('workerCapacity'); planningWizard.input = '9'; planningWizard.submitText(); assert.match(planningWizard.message, /whole number from 1 to 5/);
});

test('renders either setup and confirmation within a standard terminal', () => {
  const wizard = new WorkstreamWizard({ models: { claude: ['opus'] } }); planning(wizard); wizard.step = wizard.steps.indexOf('confirmation'); wizard.values = { sessionType: 'planning', delegatorProvider: 'claude', delegatorModel: 'opus', delegatorEffort: 'medium', delegatorArgs: [], workerProvider: 'claude', workerModel: 'opus', workerEffort: 'medium', workerArgs: [], workerCapacity: 5 }; const lines = wizard.render().split('\n'); assert.ok(lines.length <= 21); assert.match(lines.join('\n'), /Create session/); assert.match(lines.join('\n'), /1\. Planning agent/); assert.match(lines.join('\n'), /7\. Max worker count/);
});
