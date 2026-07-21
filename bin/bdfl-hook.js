#!/usr/bin/env node
'use strict';

const { handleHook } = require('../src/hooks/capture-plan');

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  try { handleHook(process.argv[2], JSON.parse(input || '{}')); }
  catch { /* Plan capture hooks are deliberately silent and never block the host. */ }
});
