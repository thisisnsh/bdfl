'use strict';

const path = require('node:path');
const { sha256 } = require('../core/plans');

const IDS = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function normalizeOwnedPath(value) {
  if (typeof value !== 'string' || !value.trim() || path.isAbsolute(value)) throw new Error(`Unsafe owned path: ${value}`);
  const normalized = value.trim().replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/+$/, '');
  const parts = normalized.split('/');
  if (parts.some((part) => !part || part === '..') || parts[0] === '.git' || parts[0] === '.bdfl') throw new Error(`Unsafe owned path: ${value}`);
  return normalized;
}

function parseMetadata(raw, kind) {
  try { return JSON.parse(raw); }
  catch (error) { throw new Error(`Invalid ${kind} metadata: ${error.message}`); }
}

function requiredSubsections(body, id) {
  for (const heading of ['Outcome', 'Implementation', 'Local validation', 'Acceptance conditions']) {
    if (!new RegExp(`^###\\s+${heading}\\s*$`, 'im').test(body)) throw new Error(`Chunk ${id} is missing ${heading}`);
  }
}

function section(source, start, end, label) {
  const begin = source.indexOf(start);
  const finish = source.indexOf(end);
  if (begin < 0 || finish < 0 || finish < begin) throw new Error(`Plan requires exactly one ${label} section`);
  if (source.indexOf(start, begin + start.length) >= 0 || source.indexOf(end, finish + end.length) >= 0) throw new Error(`Plan requires exactly one ${label} section`);
  return source.slice(begin + start.length, finish).replace(/^\s*\n|\s+$/g, '');
}

function pathsOverlap(left, right) {
  const plain = (value) => value.replace(/\*\*.*$/, '').replace(/\*.*$/, '').replace(/\/+$/, '');
  const a = plain(left); const b = plain(right);
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

function orderedByDependency(left, right, byId) {
  const seen = new Set();
  const visit = (id, target) => {
    if (id === target) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    return (byId.get(id)?.dependsOn || []).some((dependency) => visit(dependency, target));
  };
  return visit(left.id, right.id) || visit(right.id, left.id);
}

function validateGraph(chunks) {
  const byId = new Map(chunks.map((chunk) => [chunk.id, chunk]));
  if (byId.size !== chunks.length) throw new Error('Chunk IDs must be unique');
  const visiting = new Set(); const visited = new Set();
  const visit = (id) => {
    if (visiting.has(id)) throw new Error(`Chunk dependency cycle at ${id}`);
    if (visited.has(id)) return;
    const chunk = byId.get(id);
    if (!chunk) throw new Error(`Unknown chunk dependency: ${id}`);
    visiting.add(id);
    for (const dependency of chunk.dependsOn) {
      if (!byId.has(dependency)) throw new Error(`Unknown chunk dependency: ${dependency}`);
      visit(dependency);
    }
    visiting.delete(id); visited.add(id);
  };
  for (const chunk of chunks) visit(chunk.id);
  for (let left = 0; left < chunks.length; left += 1) for (let right = left + 1; right < chunks.length; right += 1) {
    const a = chunks[left]; const b = chunks[right];
    if (!orderedByDependency(a, b, byId) && a.paths.some((one) => b.paths.some((two) => pathsOverlap(one, two)))) {
      throw new Error(`Concurrently eligible chunks own overlapping paths: ${a.id}, ${b.id}`);
    }
  }
}

function stripMarkers(value) {
  return value.replace(/<!--\s*bdfl-(?:plan(?::[^]*?|:end|end)|shared:(?:start|end)|chunk(?::[^]*?|:end|end)|global:(?:start|end))\s*-->/g, '').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

function parsePlan(source) {
  if (typeof source !== 'string') throw new Error('Plan source must be Markdown');
  const headerMatch = source.match(/<!--\s*bdfl-plan:(\{[^\n]*\})\s*-->/);
  if (!headerMatch) throw new Error('Plan header is missing');
  const metadata = parseMetadata(headerMatch[1], 'plan');
  if (metadata.schema !== 1 || !metadata.title) throw new Error('Unsupported plan schema or missing title');
  if (!/<!--\s*bdfl-plan:end\s*-->/.test(source)) throw new Error('Plan end marker is missing');
  const shared = section(source, '<!-- bdfl-shared:start -->', '<!-- bdfl-shared:end -->', 'shared');
  const globalValidation = section(source, '<!-- bdfl-global:start -->', '<!-- bdfl-global:end -->', 'global-validation');
  if (!/^##\s+Global validation\s*$/im.test(globalValidation)) throw new Error('Global validation section requires its heading');
  const chunks = [];
  const pattern = /<!--\s*bdfl-chunk:(\{[^\n]*\})\s*-->([\s\S]*?)<!--\s*bdfl-chunk:end\s*-->/g;
  let match;
  while ((match = pattern.exec(source))) {
    const control = parseMetadata(match[1], 'chunk');
    if (!IDS.test(control.id || '')) throw new Error(`Invalid chunk ID: ${control.id}`);
    if (!Array.isArray(control.paths) || !control.paths.length || !Array.isArray(control.dependsOn) || !Array.isArray(control.locks)) throw new Error(`Invalid chunk metadata: ${control.id}`);
    if (control.locks.some((lock) => !IDS.test(lock))) throw new Error(`Invalid lock name in ${control.id}`);
    const body = match[2].replace(/^\s*\n|\s+$/g, '');
    requiredSubsections(body, control.id);
    chunks.push({ id: control.id, paths: control.paths.map(normalizeOwnedPath), dependsOn: [...control.dependsOn], locks: [...new Set(control.locks)], body: `${body}\n`, sha: sha256(`${match[1]}\n${body}\n`) });
  }
  if (!chunks.length) throw new Error('Plan requires at least one executable chunk');
  validateGraph(chunks);
  return {
    schema: 1, title: metadata.title, source, consolidated: stripMarkers(source),
    shared: { id: 'shared', body: `${shared}\n`, sha: sha256(`${shared}\n`) },
    chunks,
    globalValidation: { id: 'global-validation', body: `${globalValidation}\n`, sha: sha256(`${globalValidation}\n`) }
  };
}

function scheduleWaves(chunks, capacity = 4) {
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 5) throw new Error('Worker capacity must be an integer from 1 to 5');
  validateGraph(chunks);
  const pending = new Set(chunks.map((chunk) => chunk.id)); const completed = new Set(); const waves = [];
  while (pending.size) {
    const wave = []; const locks = new Set();
    for (const chunk of chunks) {
      if (!pending.has(chunk.id) || !chunk.dependsOn.every((id) => completed.has(id))) continue;
      if (chunk.locks.some((lock) => locks.has(lock))) continue;
      wave.push(chunk.id); chunk.locks.forEach((lock) => locks.add(lock));
      if (wave.length === capacity) break;
    }
    if (!wave.length) throw new Error('No schedulable chunks');
    wave.forEach((id) => { pending.delete(id); completed.add(id); }); waves.push(wave);
  }
  return waves;
}

module.exports = { IDS, normalizeOwnedPath, pathsOverlap, validateGraph, parsePlan, stripMarkers, scheduleWaves };
