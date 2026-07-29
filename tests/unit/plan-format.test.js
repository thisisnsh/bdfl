'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parsePlan, scheduleWaves } = require('../../src/plans/format');

function plan(chunks) {
  return `<!-- bdfl-plan:{"schema":1,"title":"Recovery"} -->\n# Recovery\n<!-- bdfl-summary:start -->\n## Summary\n- Recover the approved implementation.\n<!-- bdfl-summary:end -->\n<!-- bdfl-shared:start -->\n## Shared decisions\nContract.\n<!-- bdfl-shared:end -->\n${chunks}\n<!-- bdfl-global:start -->\n## Global validation\nnpm test\n<!-- bdfl-global:end -->\n<!-- bdfl-plan:end -->`;
}
function chunk(id, dependsOn = [], paths = [`src/${id}/**`], locks = []) {
  return `<!-- bdfl-chunk:{"id":"${id}","paths":${JSON.stringify(paths)},"dependsOn":${JSON.stringify(dependsOn)},"locks":${JSON.stringify(locks)}} -->\n## ${id}\n### Outcome\nDone.\n### Implementation\nBuild it.\n### Local validation\nnpm test\n### Acceptance conditions\nIt works.\n<!-- bdfl-chunk:end -->`;
}

test('parses marker source into clean sections and deterministic capacity waves', () => {
  const parsed = parsePlan(
    plan(
      [
        chunk('foundation'),
        chunk('api', ['foundation']),
        chunk('ui', ['foundation']),
        chunk('migration', ['foundation'])
      ].join('\n')
    )
  );
  assert.doesNotMatch(parsed.consolidated, /bdfl-/);
  assert.match(parsed.source, /bdfl-chunk/);
  assert.equal(parsed.chunks[0].title, 'foundation');
  assert.deepEqual(scheduleWaves(parsed.chunks, 5), [['foundation'], ['api', 'ui', 'migration']]);
  assert.deepEqual(scheduleWaves(parsed.chunks, 2), [['foundation'], ['api', 'ui'], ['migration']]);
  assert.deepEqual(scheduleWaves(parsed.chunks, 1), [['foundation'], ['api'], ['ui'], ['migration']]);
});

test('locks serialize and unordered overlapping ownership is rejected', () => {
  const parsed = parsePlan(
    plan(`${chunk('one', [], ['src/one/**'], ['database'])}\n${chunk('two', [], ['src/two/**'], ['database'])}`)
  );
  assert.deepEqual(scheduleWaves(parsed.chunks, 5), [['one'], ['two']]);
  assert.throws(
    () => parsePlan(plan(`${chunk('one', [], ['src/**'])}\n${chunk('two', [], ['src/a/**'])}`)),
    /overlapping paths/
  );
  assert.doesNotThrow(() => parsePlan(plan(`${chunk('one', [], ['src/**'])}\n${chunk('two', ['one'], ['src/a/**'])}`)));
});

test('rejects unknown dependencies, cycles, unsafe paths, and incomplete chunks', () => {
  assert.throws(() => parsePlan(plan(chunk('one', ['missing']))), /Unknown chunk dependency/);
  assert.throws(() => parsePlan(plan(`${chunk('one', ['two'])}\n${chunk('two', ['one'])}`)), /cycle/);
  assert.throws(() => parsePlan(plan(chunk('one', [], ['.bdfl/**']))), /Unsafe owned path/);
  assert.throws(
    () => parsePlan(plan(chunk('one').replace('### Acceptance conditions', '### Nope'))),
    /missing Acceptance/
  );
  assert.throws(() => parsePlan(plan(chunk('one').replace('## one', 'one'))), /missing its ## title/);
});

test('validates argv-array checks and includes them in approval SHAs', () => {
  const plain = plan(chunk('one'));
  const checked = plain
    .replace('"locks":[]', '"locks":[],"checks":[["npm","test"]]')
    .replace('<!-- bdfl-global:start -->', '<!-- bdfl-global:{"checks":[["node","--test"]]} -->');
  const parsed = parsePlan(checked);
  assert.deepEqual(parsed.chunks[0].checks, [['npm', 'test']]);
  assert.deepEqual(parsed.globalValidation.checks, [['node', '--test']]);
  assert.notEqual(parsed.chunks[0].sha, parsePlan(plain).chunks[0].sha);
  assert.throws(() => parsePlan(plain.replace('"locks":[]', '"locks":[],"checks":["npm test"]')), /argv arrays/);
  assert.throws(
    () => parsePlan(plain.replace('"locks":[]', '"locks":[],"checks":[["sh","-c","npm test"]]')),
    /cannot invoke a shell/
  );
});

test('requires a separately approved commit-ready Summary for new plans while parsing legacy plans explicitly', () => {
  const current = plan(chunk('one'));
  assert.deepEqual(parsePlan(current).summary.bullets, ['Recover the approved implementation.']);
  const legacy = current.replace(/<!-- bdfl-summary:start -->[\s\S]*?<!-- bdfl-summary:end -->\n/u, '');
  assert.throws(() => parsePlan(legacy), /Summary/);
  assert.equal(parsePlan(legacy, { requireSummary: false }).summary, null);
  assert.throws(
    () =>
      parsePlan(
        current.replace('- Recover the approved implementation.', '- One.\n- Two.\n- Three.\n- Four.\n- Five.\n- Six.')
      ),
    /1–5/
  );
  assert.throws(() => parsePlan(current.replaceAll('Recovery', 'x'.repeat(73))), /at most 72/);
});
