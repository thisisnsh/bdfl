'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { discoverClaude, discoverCodex, discoverModels } = require('../../src/core/models');

function fakeRun({ claude = false, codex = false, codexRows = [] } = {}) {
  return (command, args) => {
    if (args[0] === '--version') return { status: command === 'claude' ? (claude ? 0 : 1) : (codex ? 0 : 1) };
    if (command === 'codex' && args.join(' ') === 'debug models') return { status: 0, stdout: JSON.stringify({ models: codexRows }) };
    return { status: 1 };
  };
}

const codexRows = [
  { slug: 'visible', display_name: 'Visible', visibility: 'list', default_reasoning_level: 'high', supported_reasoning_levels: [{ effort: 'low' }, { effort: 'high' }] },
  { slug: 'hidden', visibility: 'hide', default_reasoning_level: 'medium', supported_reasoning_levels: [{ effort: 'medium' }] }
];

test('discovers only installed hosts and visible Codex models', () => {
  const claudeOnly = discoverModels({ run: fakeRun({ claude: true }) });
  assert.deepEqual([...new Set(claudeOnly.map((entry) => entry.provider))], ['claude']);
  const codexOnly = discoverModels({ run: fakeRun({ codex: true, codexRows }) });
  assert.deepEqual(codexOnly.map((entry) => entry.model), ['visible']);
  assert.deepEqual(codexOnly[0], { provider: 'codex', model: 'visible', displayName: 'Visible' });
  const dual = discoverModels({ run: fakeRun({ claude: true, codex: true, codexRows }) });
  assert.deepEqual([...new Set(dual.map((entry) => entry.provider))], ['claude', 'codex']);
});

test('honors restricted Claude availableModels', () => {
  const rows = discoverClaude(fakeRun({ claude: true }), { availableModels: ['approved-model'] });
  assert.deepEqual(rows.map((entry) => entry.model), ['approved-model']);
  assert.deepEqual(rows[0], { provider: 'claude', model: 'approved-model', displayName: 'approved-model' });
});

test('discovery failures return no invented models', () => {
  assert.deepEqual(discoverCodex(fakeRun({ codex: true, codexRows: null })), []);
  assert.deepEqual(discoverModels({ run: fakeRun() }), []);
});
