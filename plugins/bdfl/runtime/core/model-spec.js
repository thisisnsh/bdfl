'use strict';

const PROVIDERS = new Set(['claude', 'codex', 'ollama']);

function parseModelSpec(value) {
  if (typeof value !== 'string' || value.trim() !== value || !value) {
    throw new TypeError('Model specification must be a non-empty trimmed string');
  }
  const first = value.indexOf(':');
  if (first <= 0 || first === value.length - 1) {
    throw new Error(`Malformed model specification: ${value}`);
  }
  const provider = value.slice(0, first);
  const model = value.slice(first + 1);
  if (!PROVIDERS.has(provider)) throw new Error(`Unsupported provider: ${provider}`);
  if (!/^[a-z0-9][a-z0-9._:/-]*$/i.test(model)) throw new Error(`Invalid model: ${model}`);
  return Object.freeze({ provider, model, value });
}

function validateModelSpec(value, allowlist) {
  const parsed = parseModelSpec(value);
  if (!Array.isArray(allowlist) || !allowlist.includes(value)) {
    throw new Error(`Model specification is not listed: ${value}`);
  }
  return parsed;
}

module.exports = { PROVIDERS, parseModelSpec, validateModelSpec };
