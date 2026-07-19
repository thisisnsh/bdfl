#!/usr/bin/env node
'use strict';

const { frameAt } = require('../tui/banner');

function statusline({ now = Date.now(), color = process.stdout.isTTY || process.env.FORCE_COLOR === '1' } = {}) {
  return frameAt(now, color);
}

if (require.main === module) process.stdout.write(statusline());

module.exports = { statusline };

