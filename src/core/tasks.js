'use strict';

const path = require('node:path');
const crypto = require('node:crypto');
const { validateModelSpec } = require('./model-spec');

const REQUIRED = ['title', 'prompt', 'objective', 'context', 'allowedPaths', 'dependencies', 'model', 'permissionMode', 'validationCommands', 'completionCriteria'];

function nonempty(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function taskTitle(task) {
  return nonempty(task && task.title) || nonempty(task && task.objective) || (task && task.id) || 'Untitled task';
}

function shortTaskId(id) {
  return `${id || ''}`.split('-').at(-1).slice(0, 8) || 'unknown';
}

function taskLabel(task, tasks = []) {
  const title = taskTitle(task);
  const duplicates = tasks.filter((candidate) => taskTitle(candidate) === title).length;
  return duplicates > 1 ? `${title} (${shortTaskId(task.id)})` : title;
}

function taskSummary(task, tasks = []) {
  return { id: task.id, title: taskLabel(task, tasks), status: task.status || 'pending' };
}

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
  if (!nonempty(task.title)) throw new Error(`Task ${task.id || '<unknown>'} requires a title`);
  if (!nonempty(task.prompt)) throw new Error(`Task ${task.id || task.title} requires a prompt`);
  if (!nonempty(task.objective)) throw new Error(`Task ${task.id || task.title} requires an objective`);
  if (!Array.isArray(task.allowedPaths) || task.allowedPaths.length === 0) throw new Error(`Task ${task.id} requires allowedPaths`);
  if (!Array.isArray(task.dependencies) || !Array.isArray(task.validationCommands)) throw new Error(`Task ${task.id} has invalid list fields`);
  validateModelSpec(task.model, settings.models);
  return { ...task, title: task.title.trim(), allowedPaths: task.allowedPaths.map(normalizeOwnedPath) };
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

function compileManifest(input, settings, { id = () => crypto.randomUUID() } = {}) {
  if (!input || !Array.isArray(input.tasks)) throw new Error('Manifest tasks are required');
  const references = new Map();
  for (const [index, task] of input.tasks.entries()) {
    const reference = task.id || task.key || `${index}`;
    if (references.has(reference)) throw new Error(`Task references must be unique: ${reference}`);
    references.set(reference, id());
  }
  const tasks = input.tasks.map((task, index) => {
    const reference = task.id || task.key || `${index}`;
    const dependencies = task.dependencies.map((dependency) => {
      if (!references.has(dependency)) throw new Error(`Unknown task dependency: ${dependency}`);
      return references.get(dependency);
    });
    const compiled = validateTask({ ...task, id: references.get(reference), dependencies }, settings);
    delete compiled.key;
    return compiled;
  });
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

module.exports = {
  REQUIRED,
  taskTitle,
  taskLabel,
  taskSummary,
  normalizeOwnedPath,
  pathsOverlap,
  validateTask,
  assertAcyclic,
  compileManifest,
  scheduleWaves,
  shouldDispatch
};
