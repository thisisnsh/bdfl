'use strict';
const test = require('node:test'); const assert = require('node:assert/strict'); const { claudeCatalog, claudeModels, codexCatalog, codexModels, ollamaCatalog, ollamaModels, discoverProviderCatalogs } = require('../../src/providers/models');

const efforts = ['low', 'medium', 'high'];
const entry = (id) => ({ id, label: id, efforts, defaultEffort: 'medium' });

test('returns the exact ordered built-in catalogs', () => {
  assert.deepEqual(claudeModels(), ['fable', 'opus', 'sonnet', 'haiku']);
  assert.deepEqual(codexModels(), ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini']);
  assert.deepEqual(ollamaModels(), []);
  assert.deepEqual(claudeCatalog(), ['fable', 'opus', 'sonnet', 'haiku'].map(entry));
  assert.deepEqual(codexCatalog(), ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini'].map(entry));
  assert.deepEqual(ollamaCatalog(), []);
});

test('discovers only provider executables on PATH without querying provider state', () => {
  const probes = [];
  const io = {
    accessSync(file) { probes.push(file); if (!file.endsWith('codex') && !file.endsWith('ollama')) throw Object.assign(new Error('missing'), { code: 'ENOENT' }); },
    readFileSync() { throw new Error('account files must not be read'); }
  };
  const run = () => { throw new Error('provider CLIs must not be invoked'); };
  const catalogs = discoverProviderCatalogs({ io, env: { PATH: '/tools' }, run, home: '/tmp' });
  assert.deepEqual(Object.keys(catalogs), ['codex', 'ollama']);
  assert.deepEqual(catalogs.codex, codexCatalog());
  assert.deepEqual(catalogs.ollama, []);
  assert.deepEqual(probes, ['/tools/claude', '/tools/codex', '/tools/ollama']);
});
