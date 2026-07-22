'use strict';
const test = require('node:test'); const assert = require('node:assert/strict'); const { claudeCatalog, claudeModels, codexCatalog, codexModels, ollamaCatalog, ollamaModels, parseOllamaList, discoverProviderCatalogs } = require('../../src/providers/models');

const efforts = ['low', 'medium', 'high'];
const entry = (id) => ({ id, label: id, efforts, defaultEffort: 'medium' });

test('returns the exact ordered built-in catalogs', () => {
  assert.deepEqual(claudeModels(), ['fable', 'opus', 'sonnet', 'haiku']);
  assert.deepEqual(codexModels(), ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini']);
  assert.deepEqual(claudeCatalog(), ['fable', 'opus', 'sonnet', 'haiku'].map(entry));
  assert.deepEqual(codexCatalog(), ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini'].map(entry));
});

test('parses model names from ollama list output', () => {
  const output = 'NAME              ID              SIZE     MODIFIED\nqwen3:4b          abc123          2.5 GB   3 days ago\nregistry/model:7b def456          4.1 GB   1 week ago\nqwen3:4b          abc123          2.5 GB   3 days ago\n';
  assert.deepEqual(parseOllamaList(output), ['qwen3:4b', 'registry/model:7b']);
  assert.deepEqual(ollamaModels({ run: () => output }), ['qwen3:4b', 'registry/model:7b']);
  assert.deepEqual(ollamaCatalog({ run: () => output }), ['qwen3:4b', 'registry/model:7b'].map(entry));
  assert.deepEqual(ollamaModels({ run: () => { throw new Error('service unavailable'); } }), []);
});

test('discovers provider executables and queries Ollama for installed models', () => {
  const probes = [];
  const io = {
    accessSync(file) { probes.push(file); if (!file.endsWith('codex') && !file.endsWith('ollama')) throw Object.assign(new Error('missing'), { code: 'ENOENT' }); },
    readFileSync() { throw new Error('account files must not be read'); }
  };
  const calls = [];
  const run = (...args) => { calls.push(args); return 'NAME ID SIZE MODIFIED\nqwen3:4b abc123 2.5 GB Today\n'; };
  const catalogs = discoverProviderCatalogs({ io, env: { PATH: '/tools' }, run, home: '/tmp' });
  assert.deepEqual(Object.keys(catalogs), ['codex', 'ollama']);
  assert.deepEqual(catalogs.codex, codexCatalog());
  assert.deepEqual(catalogs.ollama, ['qwen3:4b'].map(entry));
  assert.deepEqual(probes, ['/tools/claude', '/tools/codex', '/tools/ollama']);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], '/tools/ollama');
  assert.deepEqual(calls[0][1], ['list']);
});
