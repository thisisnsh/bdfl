#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const { StateStore, initialState } = require('../state/store');

const YELLOW = '\u001b[38;5;220m';
const RESET = '\u001b[0m';

function projectRootFromInput(input, fallback = process.cwd()) {
  try {
    const value = JSON.parse(input || '{}');
    return value.workspace?.project_dir || value.workspace?.current_dir || value.cwd || fallback;
  } catch {
    return fallback;
  }
}

function isActiveState(state = {}) {
  const terminal = new Set(['completed', 'cancelled', 'archived']);
  return (state.runs || []).some((run) => !terminal.has(run.status));
}

function statusSummary(state) {
  const terminal = new Set(['completed', 'cancelled', 'archived']);
  const run = [...(state.runs || [])].reverse().find((item) => !terminal.has(item.status));
  if (!run) return '';
  const agents = (state.agents || []).filter((item) => ['running', 'waiting'].includes(item.status)).length;
  const tasks = (state.tasks || []).filter((item) => ['pending', 'running', 'review', 'approved', 'validating'].includes(item.status)).length;
  const inbox = (state.inbox || []).filter((item) => item.status === 'open').length;
  const parts = ['BDFL', run.model || 'active'];
  if (agents) parts.push(`${agents} agent${agents === 1 ? '' : 's'}`);
  if (tasks) parts.push(`${tasks} task${tasks === 1 ? '' : 's'}`);
  if (inbox) parts.push(`${inbox} question${inbox === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

function statusline({ color = process.env.BDFL_STATUS_NO_COLOR !== '1', state, projectRoot = process.cwd() } = {}) {
  let current = state;
  if (!current) {
    try { current = new StateStore(projectRoot).load(); }
    catch { current = initialState(); }
  }
  if (!isActiveState(current)) return '';
  const text = statusSummary(current);
  return color ? `${YELLOW}${text}${RESET}` : text;
}

if (require.main === module) {
  const input = fs.readFileSync(0, 'utf8');
  process.stdout.write(statusline({ projectRoot: projectRootFromInput(input) }));
}

module.exports = { projectRootFromInput, isActiveState, statusSummary, statusline };
