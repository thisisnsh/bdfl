'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DEFAULT_SETTINGS, configDirectory, saveSettings, validateSettings, migrateSettings, resolveSettings } = require('../../src/core/settings');
const { mapPermissionMode, assertPermissionRequest } = require('../../src/core/permissions');

const catalog = [{ provider: 'codex', model: 'gpt-live', displayName: 'GPT Live', efforts: ['low', 'high'], defaultEffort: 'low' }];
const valid = {
  version: 2,
  defaultModel: 'codex:gpt-live:high',
  models: ['codex:gpt-live:low', 'codex:gpt-live:high', 'ollama:custom:medium'],
  discoveredModels: ['codex:gpt-live:low', 'codex:gpt-live:high'],
  customModels: ['ollama:custom:medium'],
  modelCatalog: catalog,
  maxAgents: 2,
  ollamaBaseUrl: 'http://localhost:11434'
};

test('validates versioned settings and platform paths', () => {
  assert.equal(validateSettings(valid).defaultModel, valid.defaultModel);
  assert.equal(configDirectory({ platform: 'linux', env: {}, homedir: '/home/me' }), '/home/me/.config/bdfl');
  assert.equal(configDirectory({ platform: 'darwin', env: {}, homedir: '/Users/me' }), '/Users/me/Library/Application Support/BDFL');
  assert.equal(configDirectory({ platform: 'win32', env: { APPDATA: 'C:\\Users\\me\\AppData\\Roaming' }, homedir: 'C:\\Users\\me' }), 'C:\\Users\\me\\AppData\\Roaming/BDFL');
  assert.throws(() => validateSettings({ ...valid, defaultModel: 'claude:sonnet:medium' }), /not listed/);
});

test('fresh settings are discovery-only and contain no Ollama entry', () => {
  assert.deepEqual(DEFAULT_SETTINGS.models, []);
  const resolved = resolveSettings({}, catalog, 'codex');
  assert.equal(resolved.defaultModel, 'codex:gpt-live:low');
  assert.equal(resolved.models.some((model) => model.startsWith('ollama:')), false);
});

test('migrates legacy settings, preserves custom providers, and repairs unavailable selections', () => {
  const migrated = migrateSettings({ version: 1, defaultModel: 'ollama:mine:medium', models: ['codex:old:medium', 'ollama:mine:medium'], maxAgents: 3 });
  assert.deepEqual(migrated.customModels, ['codex:old:medium', 'ollama:mine:medium']);
  const resolved = resolveSettings(migrated, catalog, 'codex');
  assert.equal(resolved.models.includes('ollama:mine:medium'), true);
  assert.equal(resolved.defaultModel, 'ollama:mine:medium');
  const repaired = resolveSettings({ ...migrated, defaultModel: 'claude:missing:medium', customModels: [] }, catalog, 'codex');
  assert.equal(repaired.defaultModel, 'codex:gpt-live:low');
});

test('persists validated model selection atomically', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bdfl-settings-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'settings.json');
  saveSettings(valid, file);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), valid);
  assert.deepEqual(fs.readdirSync(directory), ['settings.json']);
});

test('preserves permissions and maps plan mode to default', () => {
  assert.equal(mapPermissionMode('codex', 'plan'), 'default');
  assert.equal(mapPermissionMode('claude', 'read-only'), 'read-only');
  assert.throws(() => assertPermissionRequest('read-only', 'full-access'), /requires parent approval/);
});
