'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ForegroundLauncher } = require('../../src/daemon/launcher');
const { PROTOCOL_VERSION } = require('../../src/daemon/protocol');

test('launcher recognizes only the current private daemon protocol', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bdfl-launcher-protocol-'));
  const current = new ForegroundLauncher(root, {
    runProcess: () => JSON.stringify({ pid: 10, protocolVersion: PROTOCOL_VERSION })
  });
  const legacy = new ForegroundLauncher(root, {
    runProcess: () => JSON.stringify({ pid: 10 })
  });
  assert.equal(current.daemonCompatible(), true);
  assert.equal(legacy.daemonCompatible(), false);
  fs.rmSync(root, { recursive: true, force: true });
});

test('launcher replaces an incompatible daemon without killing its tmux server', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bdfl-launcher-replace-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const calls = [];
  const launcher = new ForegroundLauncher(root, {
    killProcess: (pid, signal) => calls.push(['kill', pid, signal]),
    isProcessAlive: (() => {
      let first = true;
      return () => {
        const result = first;
        first = false;
        return result;
      };
    })()
  });
  fs.mkdirSync(launcher.paths.run, { recursive: true });
  fs.writeFileSync(launcher.paths.pid, '4242\n');
  fs.writeFileSync(launcher.paths.daemonSocket, 'stale');
  launcher.startDaemon = () => calls.push(['start']);
  launcher.replaceIncompatibleDaemon();
  assert.deepEqual(calls, [['kill', 4242, 'SIGTERM'], ['start']]);
  assert.equal(fs.existsSync(launcher.paths.pid), false);
  assert.equal(fs.existsSync(launcher.paths.daemonSocket), false);
});
