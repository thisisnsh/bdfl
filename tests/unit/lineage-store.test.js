'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { LineageStore } = require('../../src/plans/store');
function chunk(id, implementation = 'Build.') {
  return `<!-- bdfl-chunk:{"id":"${id}","paths":["src/${id}/**"],"dependsOn":[],"locks":[]} -->\n## ${id}\n### Outcome\nDone.\n### Implementation\n${implementation}\n### Local validation\nnpm test\n### Acceptance conditions\nPass.\n<!-- bdfl-chunk:end -->`;
}
function source() {
  return `<!-- bdfl-plan:{"schema":1,"title":"Ship"} -->\n# Ship\n<!-- bdfl-summary:start -->\n## Summary\n- Ship the approved API and UI.\n<!-- bdfl-summary:end -->\n<!-- bdfl-shared:start -->\n## Shared decisions\nA.\n<!-- bdfl-shared:end -->\n${chunk('api')}\n${chunk('ui')}\n<!-- bdfl-global:start -->\n## Global validation\nnpm test\n<!-- bdfl-global:end -->\n<!-- bdfl-plan:end -->`;
}
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bdfl-lineage-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return new LineageStore(root, { id: () => 'plan-1', now: () => new Date('2026-01-01T00:00:00Z') });
}
test('materializes clean immutable plan files and gates execution on all approvals', (t) => {
  const store = fixture(t);
  store.create(source());
  const base = path.join(store.root, '.bdfl/plans/plan-1/versions/v0001');
  assert.match(fs.readFileSync(path.join(base, 'source.md'), 'utf8'), /bdfl-plan/);
  assert.doesNotMatch(fs.readFileSync(path.join(base, 'consolidated.md'), 'utf8'), /bdfl-/);
  for (const id of ['summary', 'shared', 'api', 'ui', 'global-validation']) store.approve('plan-1', 1, id);
  assert.equal(store.executable('plan-1', 1), true);
});
test('patch preserves unchanged bytes and exact approvals while blocking direct approved changes', (t) => {
  const store = fixture(t);
  store.create(source());
  for (const id of ['summary', 'shared', 'api', 'ui', 'global-validation']) store.approve('plan-1', 1, id);
  const originalSha = store.readManifest('plan-1', 1).approvals.api.sectionSha;
  const patch = `<!-- bdfl-plan-patch:{"schema":1,"planId":"plan-1","baseVersion":1} -->\n${chunk('ui', 'Build better.')}\n<!-- bdfl-plan-patch:end -->`;
  assert.throws(() => store.revise('plan-1', patch), /Remove approval before publishing: ui/);
  store.removeApproval('plan-1', 1, 'ui');
  const result = store.revise('plan-1', patch);
  assert.equal(result.manifest.approvals.shared.sectionSha, store.readManifest('plan-1', 1).shared.sha);
  assert.equal(result.manifest.approvals.api.sectionSha, originalSha);
  assert.equal(result.manifest.approvals.ui, undefined);
  assert.ok(result.manifest.approvals['global-validation']);
  assert.equal(store.readSection('plan-1', 1, 'api'), store.readSection('plan-1', 2, 'api'));
});
test('rejects ownership through repository symlinks', (t) => {
  const store = fixture(t);
  fs.symlinkSync(os.tmpdir(), path.join(store.root, 'src'));
  assert.throws(() => store.create(source()), /Unsafe symlink ownership/);
});
test('invalidates approved dependents when an accepted prerequisite section changes', (t) => {
  const store = fixture(t);
  const dependent = source().replace(
    '"id":"ui","paths":["src/ui/**"],"dependsOn":[]',
    '"id":"ui","paths":["src/ui/**"],"dependsOn":["api"]'
  );
  store.create(dependent);
  for (const id of ['summary', 'shared', 'api', 'ui', 'global-validation']) store.approve('plan-1', 1, id);
  store.unlock('plan-1', 1, 'api');
  const patch = `<!-- bdfl-plan-patch:{"schema":1,"planId":"plan-1","baseVersion":1} -->\n${chunk('api', 'Build a changed prerequisite.')}\n<!-- bdfl-plan-patch:end -->`;
  const revised = store.revise('plan-1', patch);
  assert.equal(revised.manifest.approvals.api, undefined);
  assert.equal(revised.manifest.approvals.ui, undefined);
  assert.ok(revised.manifest.approvals.shared);
});
test('rejects plan IDs that could escape durable state', (t) => {
  const store = fixture(t);
  assert.throws(() => store.create(source(), { planId: '../outside' }), /Invalid plan ID/);
});
test('historical approvals are isolated and can make an older immutable version executable', (t) => {
  const store = fixture(t);
  store.create(source());
  const patch = `<!-- bdfl-plan-patch:{"schema":1,"planId":"plan-1","baseVersion":1} -->\n${chunk('ui', 'Build v2.')}\n<!-- bdfl-plan-patch:end -->`;
  store.revise('plan-1', patch);
  for (const id of ['summary', 'shared', 'api', 'ui', 'global-validation']) store.approve('plan-1', 1, id);
  assert.equal(store.executable('plan-1', 1), true);
  assert.equal(store.readManifest('plan-1', 2).approvals.ui, undefined);
  store.removeApproval('plan-1', 1, 'shared');
  assert.equal(store.readManifest('plan-1', 2).approvals.shared, undefined);
});
test('changing Shared conservatively drops every carried approval', (t) => {
  const store = fixture(t);
  store.create(source());
  for (const id of ['summary', 'shared', 'api', 'ui', 'global-validation']) store.approve('plan-1', 1, id);
  store.removeApproval('plan-1', 1, 'shared');
  const patch =
    '<!-- bdfl-plan-patch:{"schema":1,"planId":"plan-1","baseVersion":1} -->\n<!-- bdfl-shared:start -->\n## Shared decisions\nB.\n<!-- bdfl-shared:end -->\n<!-- bdfl-plan-patch:end -->';
  const revised = store.revise('plan-1', patch);
  assert.deepEqual(Object.keys(revised.manifest.approvals), ['summary']);
});
test('requires Summary approval and blocks revisions until that independent approval is removed', (t) => {
  const store = fixture(t);
  store.create(source());
  store.approve('plan-1', 1, 'summary');
  const patch =
    '<!-- bdfl-plan-patch:{"schema":1,"planId":"plan-1","baseVersion":1} -->\n<!-- bdfl-summary:start -->\n## Summary\n- Ship a revised API and UI.\n<!-- bdfl-summary:end -->\n<!-- bdfl-plan-patch:end -->';
  assert.throws(() => store.revise('plan-1', patch), /Remove approval before publishing: summary/);
  store.removeApproval('plan-1', 1, 'summary');
  const revised = store.revise('plan-1', patch);
  assert.equal(revised.manifest.approvals.summary, undefined);
  assert.deepEqual(revised.manifest.summary.bullets, ['Ship a revised API and UI.']);
});
test('renames the displayed plan without mutating immutable version titles', (t) => {
  const store = fixture(t);
  store.create(source());
  assert.equal(store.rename('plan-1', 'Release plan').name, 'Release plan');
  assert.equal(store.load('plan-1').name, 'Release plan');
  assert.equal(store.readManifest('plan-1', 1).title, 'Ship');
  for (const invalid of ['', ' leading', 'trailing ', 'bad\nname', 'x'.repeat(81)])
    assert.throws(() => store.rename('plan-1', invalid), /1–80 printable/);
});
test('deletes one complete lineage and rejects missing, escaping, and symlink targets', (t) => {
  const store = fixture(t);
  store.create(source());
  fs.mkdirSync(path.join(store.planDirectory('plan-1'), 'feedback'), { recursive: true });
  fs.writeFileSync(path.join(store.planDirectory('plan-1'), 'feedback', 'note.md'), 'note\n');
  assert.deepEqual(store.delete('plan-1'), { planId: 'plan-1', deleted: 1 });
  assert.equal(fs.existsSync(store.planDirectory('plan-1')), false);
  assert.throws(() => store.delete('plan-1'), /Unknown plan/);
  assert.throws(() => store.delete('../outside'), /Invalid plan ID/);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'bdfl-outside-'));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.symlinkSync(outside, store.planDirectory('linked'));
  assert.throws(() => store.delete('linked'), /Unsafe plan deletion target/);
  assert.equal(fs.existsSync(outside), true);
});
test('deletes every lineage with accurate deterministic counts and refuses a symlinked plan root', (t) => {
  const store = fixture(t);
  assert.deepEqual(store.deleteAll(), { planIds: [], deleted: 0 });
  store.create(source());
  store.create(source().replace('Ship', 'Second'), { planId: 'plan-2' });
  assert.deepEqual(store.deleteAll(), { planIds: ['plan-1', 'plan-2'], deleted: 2 });
  assert.deepEqual(store.deleteAll(), { planIds: [], deleted: 0 });
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'bdfl-plans-outside-'));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.mkdirSync(path.dirname(store.directory), { recursive: true });
  fs.symlinkSync(outside, store.directory);
  assert.throws(() => store.deleteAll(), /Unsafe plan deletion root/);
  assert.equal(fs.existsSync(outside), true);
});
