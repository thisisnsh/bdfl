'use strict';

const fs = require('node:fs'); const path = require('node:path');

const REASONING_EFFORTS = ['low', 'medium', 'high'];
const CLAUDE_MODEL_IDS = ['fable', 'opus', 'sonnet', 'haiku'];
const CODEX_MODEL_IDS = ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini'];

function catalog(ids) { return ids.map((id) => ({ id, label: id, efforts: [...REASONING_EFFORTS], defaultEffort: 'medium' })); }

function executable(provider, { io = fs, env = process.env } = {}) {
  const extensions = process.platform === 'win32' ? (env.PATHEXT || '.EXE;.CMD;.BAT').split(';') : [''];
  for (const directory of (env.PATH || '').split(path.delimiter).filter(Boolean)) for (const extension of extensions) { const candidate = path.join(directory, `${provider}${extension}`); try { io.accessSync(candidate, fs.constants.X_OK); return candidate; } catch {} }
  return null;
}

function claudeCatalog() { return catalog(CLAUDE_MODEL_IDS); }
function codexCatalog() { return catalog(CODEX_MODEL_IDS); }
function discoverProviderCatalogs(options = {}) { const catalogs = {}; if (executable('claude', options)) catalogs.claude = claudeCatalog(); if (executable('codex', options)) catalogs.codex = codexCatalog(); return catalogs; }
function claudeModels() { return [...CLAUDE_MODEL_IDS]; }
function codexModels() { return [...CODEX_MODEL_IDS]; }

module.exports = { claudeCatalog, claudeModels, codexCatalog, codexModels, discoverProviderCatalogs, executable };
