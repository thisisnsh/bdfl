'use strict';

function capturePlan(plan, content, now = new Date().toISOString()) {
  if (!content || typeof content !== 'string') throw new Error('Plan content is required');
  const versions = plan?.versions ? [...plan.versions] : [];
  const previous = versions.at(-1);
  if (previous?.content === content) return { ...plan, versions };
  versions.push(Object.freeze({ number: versions.length + 1, content, createdAt: now }));
  return { ...(plan || {}), versions, selectedVersion: plan?.selectedVersion ?? null };
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

module.exports = { capturePlan, selectPlanVersion, diffLines };

