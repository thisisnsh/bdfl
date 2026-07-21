'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parsePlan, scheduleWaves } = require('../../src/plans/format');

function plan(chunks) { return `<!-- bdfl-plan:{"schema":1,"title":"Recovery"} -->\n# Recovery\n<!-- bdfl-shared:start -->\n## Shared decisions\nContract.\n<!-- bdfl-shared:end -->\n${chunks}\n<!-- bdfl-global:start -->\n## Global validation\nnpm test\n<!-- bdfl-global:end -->\n<!-- bdfl-plan:end -->`; }
function chunk(id, dependsOn = [], paths = [`src/${id}/**`], locks = []) { return `<!-- bdfl-chunk:{"id":"${id}","paths":${JSON.stringify(paths)},"dependsOn":${JSON.stringify(dependsOn)},"locks":${JSON.stringify(locks)}} -->\n## ${id}\n### Outcome\nDone.\n### Implementation\nBuild it.\n### Local validation\nnpm test\n### Acceptance conditions\nIt works.\n<!-- bdfl-chunk:end -->`; }

test('parses marker source into clean sections and deterministic capacity waves', () => {
  const parsed = parsePlan(plan([chunk('foundation'), chunk('api', ['foundation']), chunk('ui', ['foundation']), chunk('migration', ['foundation'])].join('\n')));
  assert.doesNotMatch(parsed.consolidated, /bdfl-/);
  assert.match(parsed.source, /bdfl-chunk/);
  assert.deepEqual(scheduleWaves(parsed.chunks, 5), [['foundation'], ['api', 'ui', 'migration']]);
  assert.deepEqual(scheduleWaves(parsed.chunks, 2), [['foundation'], ['api', 'ui'], ['migration']]);
  assert.deepEqual(scheduleWaves(parsed.chunks, 1), [['foundation'], ['api'], ['ui'], ['migration']]);
});

test('locks serialize and unordered overlapping ownership is rejected', () => {
  const parsed = parsePlan(plan(`${chunk('one', [], ['src/one/**'], ['database'])}\n${chunk('two', [], ['src/two/**'], ['database'])}`));
  assert.deepEqual(scheduleWaves(parsed.chunks, 5), [['one'], ['two']]);
  assert.throws(() => parsePlan(plan(`${chunk('one', [], ['src/**'])}\n${chunk('two', [], ['src/a/**'])}`)), /overlapping paths/);
  assert.doesNotThrow(() => parsePlan(plan(`${chunk('one', [], ['src/**'])}\n${chunk('two', ['one'], ['src/a/**'])}`)));
});

test('rejects unknown dependencies, cycles, unsafe paths, and incomplete chunks', () => {
  assert.throws(() => parsePlan(plan(chunk('one', ['missing']))), /Unknown chunk dependency/);
  assert.throws(() => parsePlan(plan(`${chunk('one', ['two'])}\n${chunk('two', ['one'])}`)), /cycle/);
  assert.throws(() => parsePlan(plan(chunk('one', [], ['.bdfl/**']))), /Unsafe owned path/);
  assert.throws(() => parsePlan(plan(chunk('one').replace('### Acceptance conditions', '### Nope'))), /missing Acceptance/);
});
