'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DEFAULT_SETTINGS, configDirectory, saveSettings, validateSettings } = require('../../src/core/settings');
const { mapPermissionMode, assertPermissionRequest } = require('../../src/core/permissions');

const valid = {
  version: 1,
  defaultModel: 'ollama:qwen3.5:9b:medium',
  models: ['ollama:qwen3.5:9b:medium'],
  maxAgents: 2,
  ollamaBaseUrl: 'http://localhost:11434'
};

test('validates settings and platform paths', () => {
  assert.equal(validateSettings(valid).defaultModel, valid.defaultModel);
  assert.equal(configDirectory({ platform: 'linux', env: {}, homedir: '/home/me' }), '/home/me/.config/bdfl');
  assert.equal(configDirectory({ platform: 'darwin', env: {}, homedir: '/Users/me' }), '/Users/me/Library/Application Support/BDFL');
  assert.equal(configDirectory({ platform: 'win32', env: { APPDATA: 'C:\\Users\\me\\AppData\\Roaming' }, homedir: 'C:\\Users\\me' }), 'C:\\Users\\me\\AppData\\Roaming/BDFL');
  assert.throws(() => validateSettings({ ...valid, defaultModel: 'claude:sonnet:medium' }), /not listed/);
});

test('ships exact default models at medium effort', () => {
  assert.ok(DEFAULT_SETTINGS.models.every((model) => model.endsWith(':medium')));
  assert.ok(DEFAULT_SETTINGS.models.includes('codex:gpt-5.6-sol:medium'));
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
