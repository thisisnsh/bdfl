'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { compileManifest, pathsOverlap, scheduleWaves, shouldDispatch, taskLabel, taskSummary, taskTitle } = require('../../src/core/tasks');

const settings = { models: ['codex:gpt-5.6-sol'] };
const task = (id, allowedPaths, dependencies = []) => ({
  id,
  title: `Task ${id}`,
  prompt: `Exact prompt for ${id}`,
  objective: `objective ${id}`,
  context: 'context',
  allowedPaths,
  dependencies,
  model: 'codex:gpt-5.6-sol',
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

test('compiles human-readable task records with internal IDs and exact prompts', () => {
  let next = 0;
  const manifest = compileManifest({
    runId: 'r',
    tasks: [task('source-a', ['src']), task('source-b', ['tests'], ['source-a'])]
  }, settings, { id: () => `internal-${++next}` });
  assert.deepEqual(manifest.tasks.map(({ id, title, prompt, dependencies }) => ({ id, title, prompt, dependencies })), [
    { id: 'internal-1', title: 'Task source-a', prompt: 'Exact prompt for source-a', dependencies: [] },
    { id: 'internal-2', title: 'Task source-b', prompt: 'Exact prompt for source-b', dependencies: ['internal-1'] }
  ]);
});

test('uses readable fallback labels for old state and disambiguates duplicate titles', () => {
  assert.equal(taskTitle({ id: 'old-id', objective: 'Legacy objective' }), 'Legacy objective');
  const tasks = [
    { id: 'task-abcdefgh-1', title: 'Review API', status: 'running' },
    { id: 'task-abcdefgh-2', title: 'Review API', status: 'waiting' }
  ];
  assert.equal(taskLabel(tasks[0], tasks), 'Review API (1)');
  assert.deepEqual(taskSummary(tasks[1], tasks), { id: tasks[1].id, title: 'Review API (2)', status: 'waiting' });
});

test('requires a title and exact provider prompt on new tasks', () => {
  const missingTitle = { ...task('a', ['src']) };
  delete missingTitle.title;
  assert.throws(() => compileManifest({ runId: 'r', tasks: [missingTitle] }, settings), /missing title/);
  const missingPrompt = { ...task('a', ['src']) };
  delete missingPrompt.prompt;
  assert.throws(() => compileManifest({ runId: 'r', tasks: [missingPrompt] }, settings), /missing prompt/);
});

test('serializes overlapping ownership while parallelizing independent work', () => {
  const tasks = [task('a', ['src']), task('b', ['src/core']), task('c', ['docs'])];
  assert.deepEqual(scheduleWaves(tasks, 4), [['a', 'c'], ['b']]);
  assert.equal(shouldDispatch(tasks), true);
  assert.equal(shouldDispatch([task('a', ['src'])]), false);
  assert.equal(shouldDispatch([task('a', ['src'])], true), true);
});
