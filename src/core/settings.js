'use strict';

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { validateModelSpec } = require('./model-spec');

const DEFAULT_SETTINGS = Object.freeze({
  version: 1,
  defaultModel: 'claude:sonnet:medium',
  models: [
    'claude:sonnet:medium',
    'claude:opus:high',
    'claude:haiku:low',
    'codex:gpt-5.6:medium',
    'ollama:qwen3.5:medium'
  ],
  maxAgents: 4,
  ollamaBaseUrl: 'http://localhost:11434'
});

function configDirectory({ platform = process.platform, env = process.env, homedir = os.homedir() } = {}) {
  if (env.BDFL_CONFIG_HOME) return path.resolve(env.BDFL_CONFIG_HOME);
  if (platform === 'win32') return path.join(env.APPDATA || path.join(homedir, 'AppData', 'Roaming'), 'BDFL');
  if (platform === 'darwin') return path.join(homedir, 'Library', 'Application Support', 'BDFL');
  return path.join(env.XDG_CONFIG_HOME || path.join(homedir, '.config'), 'bdfl');
}

function validateSettings(value) {
  if (!value || value.version !== 1) throw new Error('Settings version must be 1');
  if (!Array.isArray(value.models) || value.models.length === 0 || new Set(value.models).size !== value.models.length) {
    throw new Error('models must be a non-empty list without duplicates');
  }
  for (const model of value.models) validateModelSpec(model, value.models);
  validateModelSpec(value.defaultModel, value.models);
  if (!Number.isInteger(value.maxAgents) || value.maxAgents < 1 || value.maxAgents > 64) {
    throw new Error('maxAgents must be an integer from 1 to 64');
  }
  const endpoint = new URL(value.ollamaBaseUrl);
  if (!['http:', 'https:'].includes(endpoint.protocol)) throw new Error('ollamaBaseUrl must use HTTP or HTTPS');
  return Object.freeze({ ...value, models: Object.freeze([...value.models]) });
}

function loadSettings(file = path.join(configDirectory(), 'settings.json')) {
  if (!fs.existsSync(file)) return validateSettings({ ...DEFAULT_SETTINGS, models: [...DEFAULT_SETTINGS.models] });
  const user = JSON.parse(fs.readFileSync(file, 'utf8'));
  return validateSettings({ ...DEFAULT_SETTINGS, ...user });
}

module.exports = { DEFAULT_SETTINGS, configDirectory, loadSettings, validateSettings };

