'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');

test('production workflow derives and stamps the stable GitHub Release version', () => {
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/release.yml'), 'utf8');
  assert.match(workflow, /github\.event\.release\.tag_name/);
  assert.match(workflow, /semver\.prerelease/);
  assert.match(workflow, /npm version "\$RELEASE_VERSION" --no-git-tag-version --allow-same-version/);
  assert.match(workflow, /needs: production-test/);
  assert.equal(workflow.match(/node-version: 24/g)?.length, 2);
  assert.equal(workflow.match(/npm@11\.15\.0/g)?.length, 2);
  assert.doesNotMatch(workflow, /require\('\.\/package\.json'\)\.version/);
});

test('staging versions use the latest published release as their prefix', () => {
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/release.yml'), 'utf8');
  assert.match(workflow, /releases\/latest/);
  assert.match(workflow, /STAGING_BASE_VERSION=\$\{version\}/);
  assert.match(workflow, /\$\{STAGING_BASE_VERSION\}-staging\.\$\{GITHUB_RUN_NUMBER\}/);
  assert.doesNotMatch(workflow, /0\.1\.0-staging/);
});
