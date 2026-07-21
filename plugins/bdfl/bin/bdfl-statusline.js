#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const runtime = ['src', 'runtime'].map((directory) => path.resolve(__dirname, '..', directory)).find((directory) => fs.existsSync(directory));
const { hostIsLive } = require(path.join(runtime, 'host', 'presence'));
const { verbForState } = require(path.join(runtime, 'tui', 'banner'));

function readJson(file, fallback = {}) {
  try { return file && fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback; }
  catch { return fallback; }
}

function workflowSegment(payload) {
  const root = payload?.workspace?.current_dir || payload?.cwd || payload?.current_dir;
  const state = root ? readJson(path.join(root, '.bdfl', 'state.json'), null) : null;
  const active = state && [...(state.runs || []), ...(state.tasks || []), ...(state.agents || [])]
    .some((item) => ['pending', 'running', 'waiting', 'review', 'approved', 'validating', 'integrating'].includes(item.status));
  return `BDFL · ${active ? verbForState(state) : 'ready'}`;
}

function renderStatusLine(input, receiptFile, { io = fs, run = spawnSync, live = hostIsLive } = {}) {
  const receipt = readJson(receiptFile);
  const registry = path.join(path.dirname(receiptFile), 'processes.json');
  const previous = receipt.previous?.claudeSettings?.statusLine;
  let output = '';
  if (previous?.type === 'command' && typeof previous.command === 'string' && previous.command.trim()) {
    const result = run(previous.command, { shell: true, input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    if (!result.error && result.status === 0) output = `${result.stdout || ''}`.replace(/\n$/, '');
  }
  if (!live('claude', registry, { io })) return output;
  let payload = {};
  try { payload = JSON.parse(input || '{}'); } catch {}
  const segment = workflowSegment(payload);
  return output ? `${output}\n${segment}` : segment;
}

if (require.main === module) {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { input += chunk; });
  process.stdin.on('end', () => {
    const output = renderStatusLine(input, process.argv[2]);
    if (output) process.stdout.write(`${output}\n`);
  });
}

module.exports = { readJson, workflowSegment, renderStatusLine };
