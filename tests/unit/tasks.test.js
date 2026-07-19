'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { compileManifest, pathsOverlap, scheduleWaves, shouldDispatch } = require('../../src/core/tasks');

const settings = { models: ['codex:gpt-5.6:medium'] };
const task = (id, allowedPaths, dependencies = []) => ({
  id,
  objective: `objective ${id}`,
  context: 'context',
  allowedPaths,
  dependencies,
  model: 'codex:gpt-5.6:medium',
  permissionMode: 'default',
  validationCommands: ['node --test'],
  completionCriteria: 'tests pass'
});

test('recognizes nested path ownership and rejects unsafe paths', () => {
  assert.equal(pathsOverlap('src', 'src/core/file.js'), true);
  assert.equal(pathsOverlap('src/a.js', 'tests/a.test.js'), false);
  assert.throws(() => pathsOverlap('../src', 'src'), /Unsafe/);
});

test('rejects dependency cycles and unknown dependencies', () => {
  assert.throws(() => compileManifest({ runId: 'r', tasks: [task('a', ['a'], ['b']), task('b', ['b'], ['a'])] }, settings), /cycle/);
  assert.throws(() => compileManifest({ runId: 'r', tasks: [task('a', ['a'], ['missing'])] }, settings), /Unknown/);
});

test('serializes overlapping ownership while parallelizing independent work', () => {
  const tasks = [task('a', ['src']), task('b', ['src/core']), task('c', ['docs'])];
  assert.deepEqual(scheduleWaves(tasks, 4), [['a', 'c'], ['b']]);
  assert.equal(shouldDispatch(tasks), true);
  assert.equal(shouldDispatch([task('a', ['src'])]), false);
  assert.equal(shouldDispatch([task('a', ['src'])], true), true);
});
