#!/usr/bin/env node
'use strict';

const { StateStore, initialState } = require('../state/store');
const { frameAt, verbForState } = require('../tui/banner');

function statusline({ now = Date.now(), color = process.stdout.isTTY || process.env.FORCE_COLOR === '1', state, projectRoot = process.cwd() } = {}) {
  let current = state;
  if (!current) {
    try { current = new StateStore(projectRoot).load(); }
    catch { current = initialState(); }
  }
  return frameAt(now, color, verbForState(current));
}

if (require.main === module) process.stdout.write(statusline());

module.exports = { statusline };
