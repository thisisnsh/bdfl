'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { manifests, normalizeVersion, setReleaseVersion } = require('../../scripts/set-release-version');

test('normalizes a SemVer release tag', () => {
  assert.equal(normalizeVersion('v1.2.3'), '1.2.3');
  assert.equal(normalizeVersion('v2.0.0-rc.1'), '2.0.0-rc.1');
  assert.throws(() => normalizeVersion('main'), /v-prefixed SemVer/);
});

test('stamps every release manifest from the tag', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bdfl-release-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const relative of manifests) {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{"name":"bdfl","version":"0.0.0-development"}\n');
  }

  assert.equal(setReleaseVersion('v3.4.5', root), '3.4.5');
  for (const relative of manifests) {
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8')).version, '3.4.5');
  }
});
