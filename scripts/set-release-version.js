#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const manifests = [
  'package.json',
  '.claude-plugin/plugin.json',
  'plugins/bdfl/.codex-plugin/plugin.json'
];

function normalizeVersion(input) {
  const tag = String(input || '');
  const version = tag.startsWith('v') ? tag.slice(1) : '';
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Release tag must be v-prefixed SemVer: ${input || '(missing)'}`);
  }
  return version;
}

function setReleaseVersion(versionInput, base = root) {
  const version = normalizeVersion(versionInput);
  for (const relative of manifests) {
    const file = path.join(base, relative);
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
    manifest.version = version;
    fs.writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
  }
  return version;
}

if (require.main === module) {
  try {
    const version = setReleaseVersion(process.argv[2]);
    console.log(`Release manifests set to ${version}.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { manifests, normalizeVersion, setReleaseVersion };
