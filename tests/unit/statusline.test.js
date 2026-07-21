'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { renderStatusLine } = require('../../bin/bdfl-statusline');

function fixture(t, statusLine) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bdfl-statusline-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const receipt = path.join(root, 'install.json');
  fs.writeFileSync(receipt, `${JSON.stringify({ previous: { claudeSettings: statusLine ? { statusLine } : {} } })}\n`);
  return { root, receipt, input: JSON.stringify({ workspace: { current_dir: root } }) };
}

test('appends ready to plain, ANSI, multiline, and legacy status output', (t) => {
  for (const stdout of ['plain\n', '\u001b[32mgreen\u001b[0m\n', 'first\nsecond\n', 'legacy BDFL status\n']) {
    const fix = fixture(t, { type: 'command', command: 'existing-command', padding: 3 });
    const output = renderStatusLine(fix.input, fix.receipt, { live: () => true, run: () => ({ status: 0, stdout }) });
    assert.equal(output, `${stdout.replace(/\n$/, '')}\nBDFL · ready`);
  }
});

test('shows ready when the previous command fails or is missing', (t) => {
  const failing = fixture(t, { type: 'command', command: 'missing-command' });
  assert.equal(renderStatusLine(failing.input, failing.receipt, { live: () => true, run: () => ({ status: 1, stderr: 'failed' }) }), 'BDFL · ready');
  const missing = fixture(t);
  assert.equal(renderStatusLine(missing.input, missing.receipt, { live: () => true }), 'BDFL · ready');
});

test('shows durable workflow verbs and hides only the BDFL segment when disabled', (t) => {
  const fix = fixture(t, { type: 'command', command: 'existing-command' });
  fs.mkdirSync(path.join(fix.root, '.bdfl'), { recursive: true });
  fs.writeFileSync(path.join(fix.root, '.bdfl', 'state.json'), `${JSON.stringify({ runs: [{ status: 'running' }], tasks: [], agents: [{ status: 'running' }], inbox: [] })}\n`);
  const run = () => ({ status: 0, stdout: 'user line\n' });
  assert.equal(renderStatusLine(fix.input, fix.receipt, { live: () => true, run }), 'user line\nBDFL · orchestrating');
  assert.equal(renderStatusLine(fix.input, fix.receipt, { live: () => false, run }), 'user line');
});
