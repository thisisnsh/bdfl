#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const manifests = [
  '.claude-plugin/plugin.json',
  '.claude-plugin/marketplace.json',
  'plugins/bdfl/.codex-plugin/plugin.json'
];

for (const relative of manifests) {
  const value = JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
  if (!value || typeof value !== 'object') throw new Error(`${relative} must contain an object`);
}

const codex = JSON.parse(fs.readFileSync(path.join(root, manifests[2]), 'utf8'));
if (codex.name !== 'bdfl') throw new Error('Codex plugin name must match its folder');
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(codex.version)) throw new Error('Codex plugin version must be semver');
if (!codex.author?.name || !codex.interface?.displayName || !codex.interface?.shortDescription) {
  throw new Error('Codex plugin is missing required presentation metadata');
}
console.log('Repository manifests are valid.');
