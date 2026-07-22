'use strict';

const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path'); const { spawnSync } = require('node:child_process');

function unique(values) { return [...new Set(values.filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim().replace(/\[\d+m\]$/, '')))]; }

function title(value) { return `${value}`.replace(/(^|[-_])([a-z])/g, (_match, separator, letter) => `${separator === '-' || separator === '_' ? ' ' : ''}${letter.toUpperCase()}`); }

function claudeAliases(help) {
  const section = `${help}`.match(/^\s{2}(?:-m,\s*)?--model <model>([\s\S]*?)(?=^\s{2}(?:-|Commands:))/m)?.[1] || '';
  const aliasDescription = section.split(/\bor\s+a\s+model(?:'s)?\s+full\s+name\b/i)[0];
  return unique([...aliasDescription.matchAll(/['"]([^'"]+)['"]/g)].map((match) => match[1]));
}

function executable(provider, { io = fs, env = process.env } = {}) {
  const extensions = process.platform === 'win32' ? (env.PATHEXT || '.EXE;.CMD;.BAT').split(';') : [''];
  for (const directory of (env.PATH || '').split(path.delimiter).filter(Boolean)) for (const extension of extensions) { const candidate = path.join(directory, `${provider}${extension}`); try { io.accessSync(candidate, fs.constants.X_OK); return candidate; } catch {} }
  return null;
}

function codexCatalog({ run = spawnSync } = {}) {
  try {
    const result = run('codex', ['debug', 'models'], { encoding: 'utf8', timeout: 5000, maxBuffer: 10 * 1024 * 1024 });
    if (result.status !== 0) return [];
    const models = JSON.parse(result.stdout).models || [];
    return models.filter((model) => model.visibility === 'list').sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999)).map((model) => { const efforts = unique((model.supported_reasoning_levels || []).map((level) => level.effort)); return { id: model.slug, label: model.display_name || model.slug, efforts, defaultEffort: efforts.includes(model.default_reasoning_level) ? model.default_reasoning_level : efforts[0] }; });
  } catch { return []; }
}

function claudeCatalog({ io = fs, home = os.homedir(), run = spawnSync } = {}) {
  const models = [];
  try { const settings = JSON.parse(io.readFileSync(path.join(home, '.claude.json'), 'utf8')); for (const model of settings.additionalModelOptionsCache || []) models.push({ id: `${model.value}`.trim(), label: model.label || model.value }); } catch {}
  let efforts = ['medium'];
  try { const help = `${run('claude', ['--help'], { encoding: 'utf8', timeout: 1500 }).stdout || ''}`; models.unshift(...claudeAliases(help).map((id) => ({ id, label: title(id) }))); const section = help.match(/--effort <level>([\s\S]*?)(?=\n {2}-)/)?.[1] || ''; const choices = section.match(/\((low[^)]+)\)/)?.[1]?.split(',').map((value) => value.trim()) || []; if (choices.length) efforts = unique(choices); } catch {}
  return models.filter((model, index, all) => model.id && all.findIndex((item) => item.id === model.id) === index).map((model) => ({ ...model, efforts, defaultEffort: efforts.includes('medium') ? 'medium' : efforts[0] }));
}

function discoverProviderCatalogs(options = {}) { const catalogs = {}; if (executable('claude', options)) catalogs.claude = claudeCatalog(options); if (executable('codex', options)) catalogs.codex = codexCatalog(options); return catalogs; }
function codexModels(options) { return codexCatalog(options).map((model) => model.id); }
function claudeModels(options) { return claudeCatalog(options).map((model) => model.id); }

module.exports = { claudeAliases, claudeCatalog, claudeModels, codexCatalog, codexModels, discoverProviderCatalogs, executable };
