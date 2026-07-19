'use strict';

const path = require('node:path');
const { validateModelSpec } = require('./model-spec');

const REQUIRED = ['id', 'objective', 'context', 'allowedPaths', 'dependencies', 'model', 'permissionMode', 'validationCommands', 'completionCriteria'];

function normalizeOwnedPath(value) {
  if (typeof value !== 'string' || !value || path.isAbsolute(value) || value.split(/[\\/]/).includes('..')) {
    throw new Error(`Unsafe allowed path: ${value}`);
  }
  return value.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, '');
}

function pathsOverlap(left, right) {
  const a = normalizeOwnedPath(left);
  const b = normalizeOwnedPath(right);
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

function validateTask(task, settings) {
  for (const field of REQUIRED) if (!(field in task)) throw new Error(`Task ${task.id || '<unknown>'} is missing ${field}`);
  if (!Array.isArray(task.allowedPaths) || task.allowedPaths.length === 0) throw new Error(`Task ${task.id} requires allowedPaths`);
  if (!Array.isArray(task.dependencies) || !Array.isArray(task.validationCommands)) throw new Error(`Task ${task.id} has invalid list fields`);
  validateModelSpec(task.model, settings.models);
  return { ...task, allowedPaths: task.allowedPaths.map(normalizeOwnedPath) };
}

function assertAcyclic(tasks) {
  const ids = new Set(tasks.map((task) => task.id));
  if (ids.size !== tasks.length) throw new Error('Task IDs must be unique');
  const visiting = new Set();
  const visited = new Set();
  function visit(id) {
    if (visiting.has(id)) throw new Error(`Task dependency cycle at ${id}`);
    if (visited.has(id)) return;
    const task = tasks.find((candidate) => candidate.id === id);
    if (!task) throw new Error(`Unknown task dependency: ${id}`);
    visiting.add(id);
    for (const dependency of task.dependencies) {
      if (!ids.has(dependency)) throw new Error(`Unknown task dependency: ${dependency}`);
      visit(dependency);
    }
    visiting.delete(id);
    visited.add(id);
  }
  for (const task of tasks) visit(task.id);
}

function compileManifest(input, settings) {
  if (!input || !Array.isArray(input.tasks)) throw new Error('Manifest tasks are required');
  const tasks = input.tasks.map((task) => validateTask(task, settings));
  assertAcyclic(tasks);
  return Object.freeze({ version: 1, runId: input.runId, createdAt: input.createdAt || new Date().toISOString(), tasks });
}

function scheduleWaves(tasks, maxAgents = 4) {
  assertAcyclic(tasks);
  const pending = new Map(tasks.map((task) => [task.id, task]));
  const completed = new Set();
  const waves = [];
  while (pending.size) {
    const eligible = [...pending.values()].filter((task) => task.dependencies.every((id) => completed.has(id)));
    if (!eligible.length) throw new Error('No schedulable tasks');
    const wave = [];
    for (const task of eligible) {
      const conflict = wave.some((other) => task.allowedPaths.some((a) => other.allowedPaths.some((b) => pathsOverlap(a, b))));
      if (!conflict && wave.length < maxAgents) wave.push(task);
    }
    for (const task of wave) { pending.delete(task.id); completed.add(task.id); }
    waves.push(wave.map((task) => task.id));
  }
  return waves;
}

function shouldDispatch(tasks, explicitlyRequested = false) {
  if (explicitlyRequested) return tasks.length > 0;
  if (tasks.length < 2) return false;
  return scheduleWaves(tasks, tasks.length).some((wave) => wave.length >= 2);
}

module.exports = { REQUIRED, normalizeOwnedPath, pathsOverlap, validateTask, assertAcyclic, compileManifest, scheduleWaves, shouldDispatch };
