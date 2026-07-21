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

function effortsFromHelp(output, fallback = ['medium']) {
  const section = `${output || ''}`.match(/--effort[\s\S]{0,320}?(?:choices|possible values):?\s*([^\n]+)/i)?.[1] || '';
  const quoted = [...section.matchAll(/["'`]([a-z][\w-]*)["'`]/gi)].map((match) => match[1]);
  const plain = quoted.length ? quoted : section.replace(/[()[\],]/g, ' ').split(/\s+/).filter((value) => /^(low|medium|high|xhigh|max|ultra)$/i.test(value));
  return [...new Set(plain.length ? plain : fallback)];
}

function discoverCodex(run = spawnSync) {
  if (!available('codex', run)) return [];
  const result = run('codex', ['debug', 'models'], { encoding: 'utf8', stdio: 'pipe' });
  if (result?.error || result?.status !== 0) return [];
  try {
    const rows = JSON.parse(result.stdout || '{}').models || [];
    return rows.filter((row) => row.slug && row.visibility !== 'hide' && row.visibility !== 'hidden').map((row) => {
      const efforts = (row.supported_reasoning_levels || []).map((level) => level.effort).filter(Boolean);
      const supportedEfforts = efforts.length ? efforts : [row.default_reasoning_level || 'medium'];
      return { provider: 'codex', model: row.slug, displayName: row.display_name || row.slug, efforts: supportedEfforts, defaultEffort: supportedEfforts.includes(row.default_reasoning_level) ? row.default_reasoning_level : supportedEfforts[0] };
    });
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
  const help = run('claude', ['--help'], { encoding: 'utf8', stdio: 'pipe' });
  const efforts = effortsFromHelp(help?.stdout || help?.stderr, ['medium']);
  const defaultEffort = efforts.includes('medium') ? 'medium' : efforts[0];
  return models.map((model) => ({ provider: 'claude', model, displayName: model, efforts, defaultEffort }));
}

function discoverModels(options = {}) {
  const run = options.run || spawnSync;
  return [...discoverClaude(run, options), ...discoverCodex(run)];
}

function catalogSpecifications(catalog) {
  return catalog.flatMap((entry) => entry.efforts.map((effort) => `${entry.provider}:${entry.model}:${effort}`));
}

module.exports = { CLAUDE_ALIASES, available, effortsFromHelp, configuredClaudeModels, discoverClaude, discoverCodex, discoverModels, catalogSpecifications };
