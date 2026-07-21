'use strict';
const test = require('node:test'); const assert = require('node:assert/strict'); const fs = require('node:fs'); const path = require('node:path');
const root = path.resolve(__dirname, '../..');
test('legacy installer and provider-plugin surfaces stay removed', () => { const hasFiles = (target) => fs.existsSync(target) && (fs.statSync(target).isFile() || fs.readdirSync(target).some((entry) => hasFiles(path.join(target, entry)))); for (const relative of ['.claude-plugin', 'agents', 'settings.example.json', 'scripts/set-release-version.js', 'scripts/generate-demo.js', 'plugins/bdfl/bin', 'plugins/bdfl/agents', 'plugins/bdfl/.codex-plugin', 'tests/fixtures']) assert.equal(hasFiles(path.join(root, relative)), false, relative); });
