'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseModelSpec, validateModelSpec } = require('../../src/core/model-spec');

test('parses providers while preserving colon-bearing model tags', () => {
  assert.deepEqual(parseModelSpec('ollama:qwen3.5:9b'), {
    provider: 'ollama', model: 'qwen3.5:9b', value: 'ollama:qwen3.5:9b'
  });
});

test('rejects malformed, unsupported, and unlisted specifications', () => {
  for (const value of ['', 'claude:', ':sonnet', 'other:model', ' claude:sonnet']) {
    assert.throws(() => parseModelSpec(value));
  }
  assert.throws(() => validateModelSpec('claude:opus', ['claude:sonnet']), /not listed/);
});
