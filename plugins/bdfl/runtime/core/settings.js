'use strict';

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { parseModelSpec, validateModelSpec } = require('./model-spec');
const { discoverModels, catalogSpecifications } = require('./models');

const DEFAULT_SETTINGS = Object.freeze({
  version: 2,
  defaultModel: null,
  models: Object.freeze([]),
  discoveredModels: Object.freeze([]),
  customModels: Object.freeze([]),
  modelCatalog: Object.freeze([]),
  maxAgents: 4,
  ollamaBaseUrl: 'http://localhost:11434'
});

function configDirectory({ platform = process.platform, env = process.env, homedir = os.homedir() } = {}) {
  if (env.BDFL_CONFIG_HOME) return path.resolve(env.BDFL_CONFIG_HOME);
  if (platform === 'win32') return path.join(env.APPDATA || path.join(homedir, 'AppData', 'Roaming'), 'BDFL');
  if (platform === 'darwin') return path.join(homedir, 'Library', 'Application Support', 'BDFL');
  return path.join(env.XDG_CONFIG_HOME || path.join(homedir, '.config'), 'bdfl');
}

function validateCatalog(catalog) {
  if (!Array.isArray(catalog)) throw new Error('modelCatalog must be an array');
  return catalog.map((entry) => {
    if (!['claude', 'codex'].includes(entry.provider) || !entry.model || !Array.isArray(entry.efforts) || !entry.efforts.length) throw new Error('Invalid discovered model catalog entry');
    return { ...entry, efforts: [...new Set(entry.efforts)], defaultEffort: entry.efforts.includes(entry.defaultEffort) ? entry.defaultEffort : entry.efforts[0] };
  });
}

function validateSettings(value) {
  if (!value || value.version !== 2) throw new Error('Settings version must be 2');
  const catalog = validateCatalog(value.modelCatalog || []);
  const models = [...(value.models || [])];
  if (new Set(models).size !== models.length) throw new Error('models must not contain duplicates');
  for (const model of models) parseModelSpec(model);
  if (value.defaultModel !== null && value.defaultModel !== undefined) validateModelSpec(value.defaultModel, models);
  if (!Array.isArray(value.discoveredModels) || !Array.isArray(value.customModels)) throw new Error('discoveredModels and customModels must be arrays');
  for (const model of [...value.discoveredModels, ...value.customModels]) validateModelSpec(model, models);
  if (!Number.isInteger(value.maxAgents) || value.maxAgents < 1 || value.maxAgents > 64) throw new Error('maxAgents must be an integer from 1 to 64');
  const endpoint = new URL(value.ollamaBaseUrl);
  if (!['http:', 'https:'].includes(endpoint.protocol)) throw new Error('ollamaBaseUrl must use HTTP or HTTPS');
  return Object.freeze({ ...value, defaultModel: value.defaultModel || null, models: Object.freeze(models), discoveredModels: Object.freeze([...value.discoveredModels]), customModels: Object.freeze([...value.customModels]), modelCatalog: Object.freeze(catalog.map((entry) => Object.freeze({ ...entry, efforts: Object.freeze(entry.efforts) }))) });
}

function migrateSettings(user = {}) {
  if (user.version === 2) return { ...user, customModels: [...(user.customModels || [])] };
  const legacyModels = Array.isArray(user.models) ? user.models : [];
  return {
    version: 2,
    defaultModel: user.defaultModel || null,
    customModels: [...legacyModels],
    maxAgents: user.maxAgents ?? DEFAULT_SETTINGS.maxAgents,
    ollamaBaseUrl: user.ollamaBaseUrl || DEFAULT_SETTINGS.ollamaBaseUrl
  };
}

function resolveSettings(user, catalog, invokingHost) {
  const migrated = migrateSettings(user);
  const normalizedCatalog = validateCatalog(catalog);
  const discoveredModels = catalogSpecifications(normalizedCatalog);
  const discoveredKeys = new Set(normalizedCatalog.map((entry) => `${entry.provider}:${entry.model}`));
  const customModels = [...new Set((migrated.customModels || []).filter((specification) => {
    try { const parsed = parseModelSpec(specification); return !discoveredKeys.has(`${parsed.provider}:${parsed.model}`); }
    catch { return false; }
  }))];
  const models = [...new Set([...discoveredModels, ...customModels])];
  let defaultModel = models.includes(migrated.defaultModel) ? migrated.defaultModel : null;
  const preferred = normalizedCatalog.find((entry) => entry.provider === invokingHost) || normalizedCatalog[0];
  if (!defaultModel && preferred) defaultModel = `${preferred.provider}:${preferred.model}:${preferred.defaultEffort}`;
  if (!defaultModel) defaultModel = customModels[0] || null;
  return validateSettings({
    version: 2, defaultModel, models, discoveredModels, customModels, modelCatalog: normalizedCatalog,
    maxAgents: migrated.maxAgents ?? DEFAULT_SETTINGS.maxAgents,
    ollamaBaseUrl: migrated.ollamaBaseUrl || DEFAULT_SETTINGS.ollamaBaseUrl
  });
}

function loadSettings(file = path.join(configDirectory(), 'settings.json'), options = {}) {
  const user = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  const catalog = options.catalog || discoverModels(options);
  return resolveSettings(user, catalog, options.invokingHost);
}

function saveSettings(value, file = path.join(configDirectory(), 'settings.json')) {
  const validated = validateSettings(value);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(validated, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
  return validated;
}

module.exports = { DEFAULT_SETTINGS, configDirectory, loadSettings, saveSettings, validateSettings, migrateSettings, resolveSettings };
