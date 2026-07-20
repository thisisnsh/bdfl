'use strict';

const crypto = require('node:crypto');
const path = require('node:path');

const ACTIVE_RUN_STATUSES = new Set(['pending', 'running', 'waiting', 'review', 'approved', 'validating']);

function capturePlan(plan, content, now = new Date().toISOString()) {
  if (!content || typeof content !== 'string') throw new Error('Plan content is required');
  const versions = plan?.versions ? [...plan.versions] : [];
  const previous = versions.at(-1);
  if (previous?.content === content) return { ...plan, versions };
  versions.push(Object.freeze({ number: versions.length + 1, content, createdAt: now }));
  return { ...(plan || {}), versions, selectedVersion: plan?.selectedVersion ?? null };
}

function derivePlanTitle(content, projectRoot = process.cwd()) {
  const heading = `${content || ''}`.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/m);
  return heading?.[1]?.trim() || path.basename(projectRoot) || 'BDFL plan';
}

function currentRun(state, runId) {
  if (runId) {
    const run = state.runs.find((candidate) => candidate.id === runId);
    if (!run) throw new Error(`Unknown BDFL run: ${runId}`);
    return run;
  }
  return [...state.runs].reverse().find((candidate) => ACTIVE_RUN_STATUSES.has(candidate.status));
}

function captureRunPlan(state, {
  content,
  runId,
  projectRoot = process.cwd(),
  now = new Date().toISOString(),
  id = () => `plan-${crypto.randomUUID()}`
} = {}) {
  if (!content || typeof content !== 'string') throw new Error('Plan content is required');
  const run = currentRun(state, runId);
  if (!run) throw new Error('Activate BDFL before capturing a plan');
  const next = structuredClone(state);
  const index = next.plans.findIndex((candidate) => candidate.runId === run.id);
  const existing = index === -1
    ? { id: id(), runId: run.id, title: derivePlanTitle(content, projectRoot), versions: [], selectedVersion: null, createdAt: now }
    : next.plans[index];
  const before = existing.versions.length;
  const captured = capturePlan(existing, content, now);
  captured.title = derivePlanTitle(content, projectRoot);
  captured.updatedAt = now;
  if (index === -1) next.plans.push(captured);
  else next.plans[index] = captured;
  return {
    state: next,
    plan: structuredClone(captured),
    version: captured.versions.at(-1).number,
    created: index === -1,
    deduplicated: captured.versions.length === before
  };
}

function selectPlanVersion(plan, number) {
  if (!plan.versions.some((version) => version.number === number)) throw new Error(`Unknown plan version: ${number}`);
  return { ...plan, selectedVersion: number };
}

function diffLines(before = '', after = '') {
  const a = before.split('\n');
  const b = after.split('\n');
  const table = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const result = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      result.push({ type: 'context', text: a[i++] }); j += 1;
    } else if (j < b.length && (i === a.length || table[i][j + 1] >= table[i + 1][j])) {
      result.push({ type: 'addition', text: b[j++] });
    } else {
      result.push({ type: 'removal', text: a[i++] });
    }
  }
  return result;
}

module.exports = { ACTIVE_RUN_STATUSES, capturePlan, derivePlanTitle, captureRunPlan, selectPlanVersion, diffLines };
