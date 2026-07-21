#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const runtime = ['src', 'runtime'].map((directory) => path.resolve(__dirname, '..', directory)).find((directory) => fs.existsSync(directory));
const { handleHook } = require(path.join(runtime, 'hooks', 'capture-plan'));
const { startupNotice } = require(path.join(runtime, 'host', 'presence'));

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  try {
    const host = process.argv[2];
    const registry = process.argv[3];
    const payload = JSON.parse(input || '{}');
    if (payload.hook_event_name === 'SessionStart') {
      const notice = startupNotice(host, registry);
      if (notice) process.stdout.write(`${notice}\n`);
    } else handleHook(host, payload, { registryFile: registry });
  }
  catch { /* Plan capture hooks are deliberately silent and never block the host. */ }
});
