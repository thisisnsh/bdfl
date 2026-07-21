'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const CLAUDE_ALIASES = Object.freeze(['sonnet', 'opus', 'haiku']);

function available(command, run = spawnSync) {
  const result = run(command, ['--version'], { encoding: 'utf8', stdio: 'pipe' });
  return !result?.error && result?.status === 0;
}

function discoverCodex(run = spawnSync) {
  if (!available('codex', run)) return [];
  const result = run('codex', ['debug', 'models'], { encoding: 'utf8', stdio: 'pipe' });
  if (result?.error || result?.status !== 0) return [];
  try {
    const rows = JSON.parse(result.stdout || '{}').models || [];
    return rows.filter((row) => row.slug && row.visibility !== 'hide' && row.visibility !== 'hidden')
      .map((row) => ({ provider: 'codex', model: row.slug, displayName: row.display_name || row.slug }));
  } catch { return []; }
}

function configuredClaudeModels({ io = fs, env = process.env, homedir = os.homedir() } = {}) {
  const root = env.CLAUDE_CONFIG_DIR || path.join(homedir, '.claude');
  const file = path.join(root, 'settings.json');
  if (!io.existsSync(file)) return null;
  try {
    const values = JSON.parse(io.readFileSync(file, 'utf8')).availableModels;
    if (!Array.isArray(values)) return null;
    return values.map((value) => typeof value === 'string' ? value : value?.value || value?.model || value?.id).filter(Boolean);
  } catch { return null; }
}

function discoverClaude(run = spawnSync, options = {}) {
  if (!available('claude', run)) return [];
  const configured = options.availableModels || configuredClaudeModels(options);
  const models = configured?.length ? configured : CLAUDE_ALIASES;
  return models.map((model) => ({ provider: 'claude', model, displayName: model }));
}

function discoverModels(options = {}) {
  const run = options.run || spawnSync;
  return [...discoverClaude(run, options), ...discoverCodex(run)];
}

function catalogSpecifications(catalog) {
  return catalog.map((entry) => `${entry.provider}:${entry.model}`);
}

module.exports = { CLAUDE_ALIASES, available, configuredClaudeModels, discoverClaude, discoverCodex, discoverModels, catalogSpecifications };
