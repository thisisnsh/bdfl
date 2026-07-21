'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { processAlive, readRegistry, pruneRegistry, registerProcess, hostIsLive, startupNotice } = require('../../src/host/presence');

test('tracks host-specific MCP processes and removes normal exits', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bdfl-presence-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'processes.json');
  const live = new Set([101, 202]);
  const options = { alive: (pid) => live.has(pid) };
  const removeClaude = registerProcess('claude', 101, file, options);
  const removeCodex = registerProcess('codex', 202, file, options);
  assert.equal(hostIsLive('claude', file, options), true);
  assert.equal(hostIsLive('codex', file, options), true);
  assert.match(startupNotice('claude', file, options), /Benevolent Delegator for LLMs/);
  removeClaude();
  assert.equal(hostIsLive('claude', file, options), false);
  assert.equal(hostIsLive('codex', file, options), true);
  removeCodex();
  assert.equal(fs.existsSync(file), false);
});

test('prunes stale PIDs and emits no startup notice for a disabled host', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bdfl-presence-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'processes.json');
  fs.writeFileSync(file, `${JSON.stringify({ version: 1, processes: [{ host: 'claude', pid: 99 }, { host: 'codex', pid: 100 }] })}\n`);
  assert.deepEqual(pruneRegistry(file, { alive: (pid) => pid === 100 }), [{ host: 'codex', pid: 100 }]);
  assert.equal(startupNotice('claude', file, { alive: () => false }), '');
  assert.deepEqual(readRegistry(file).processes, []);
});

test('process liveness treats permission errors as live', () => {
  assert.equal(processAlive(10, () => {}), true);
  assert.equal(processAlive(10, () => { const error = new Error('denied'); error.code = 'EPERM'; throw error; }), true);
  assert.equal(processAlive(10, () => { const error = new Error('gone'); error.code = 'ESRCH'; throw error; }), false);
});
