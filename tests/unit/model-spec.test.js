'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseModelSpec, validateModelSpec } = require('../../src/core/model-spec');

test('parses provider and effort around colon-bearing model tags', () => {
  assert.deepEqual(parseModelSpec('ollama:qwen3.5:9b:medium'), {
    provider: 'ollama', model: 'qwen3.5:9b', effort: 'medium', value: 'ollama:qwen3.5:9b:medium'
  });
});

test('rejects malformed, unsupported, and unlisted specifications', () => {
  for (const value of ['', 'claude:sonnet', ':sonnet:high', 'other:model:high', ' claude:sonnet:high']) {
    assert.throws(() => parseModelSpec(value));
  }
  assert.throws(() => validateModelSpec('claude:opus:high', ['claude:sonnet:medium']), /not listed/);
});

