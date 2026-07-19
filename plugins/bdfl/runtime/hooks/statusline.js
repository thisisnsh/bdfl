#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const { StateStore, initialState } = require('../state/store');
const { frameAt, verbForState } = require('../tui/banner');

function projectRootFromInput(input, fallback = process.cwd()) {
  try {
    const value = JSON.parse(input || '{}');
    return value.workspace?.project_dir || value.workspace?.current_dir || value.cwd || fallback;
  } catch {
    return fallback;
  }
}

function statusline({ now = Date.now(), color = process.env.BDFL_STATUS_NO_COLOR !== '1', state, projectRoot = process.cwd() } = {}) {
  let current = state;
  if (!current) {
    try { current = new StateStore(projectRoot).load(); }
    catch { current = initialState(); }
  }
  return frameAt(now, color, verbForState(current), 1000);
}

if (require.main === module) {
  const input = fs.readFileSync(0, 'utf8');
  process.stdout.write(statusline({ projectRoot: projectRootFromInput(input) }));
}

module.exports = { projectRootFromInput, statusline };
