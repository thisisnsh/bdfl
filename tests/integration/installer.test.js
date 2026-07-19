'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseArgs, installerPaths, verifyChecksum, mergeClaudeSettings, Installer, formatPlan } = require('../../bin/install');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bdfl-installer-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'source');
  fs.mkdirSync(path.join(source, 'plugins', 'bdfl'), { recursive: true });
  fs.mkdirSync(path.join(source, 'src', 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(source, 'plugins', 'bdfl', 'plugin.txt'), 'plugin');
  fs.writeFileSync(path.join(source, 'src', 'hooks', 'statusline.js'), 'hook');
  const home = path.join(root, 'home');
  const calls = [];
  const run = (command, args) => { calls.push([command, args]); return { status: 0, stdout: '', stderr: '' }; };
  return { root, source, paths: installerPaths({ platform: 'linux', env: {}, homedir: home }), calls, run };
}

test('parses every public installer option', () => {
  assert.deepEqual(parseArgs(['--dry-run', '--list', '--only', 'codex', '--force', '--uninstall', '--no-color', '--non-interactive']), {
    dryRun: true, list: true, only: 'codex', force: true, uninstall: true, color: false, nonInteractive: true
  });
  assert.throws(() => parseArgs(['--only', 'ollama']), /claude or codex/);
});

test('dry-run lists every mutation without writing', (t) => {
  const { source, paths, run } = fixture(t);
  const installer = new Installer({ sourceRoot: source, paths, run });
  const plan = installer.install({ dryRun: true }, { claude: true, codex: true, ollama: true });
  assert.deepEqual(plan.hosts, ['claude', 'codex']);
  assert.ok(plan.operations.some((item) => item.path === paths.claudeSettings));
  assert.equal(fs.existsSync(paths.receipt), false);
});

test('installation is repeatable and uninstall restores host files', (t) => {
  const { source, paths, calls, run } = fixture(t);
  fs.mkdirSync(path.dirname(paths.claudeSettings), { recursive: true });
  fs.writeFileSync(paths.claudeSettings, '{"theme":"dark"}\n');
  const installer = new Installer({ sourceRoot: source, paths, run });
  installer.install({ force: false }, { claude: true, codex: true, ollama: false });
  installer.install({ force: false }, { claude: true, codex: true, ollama: false });
  assert.equal(JSON.parse(fs.readFileSync(paths.codexMarketplace)).plugins.filter((item) => item.name === 'bdfl').length, 1);
  assert.equal(JSON.parse(fs.readFileSync(paths.claudeSettings)).theme, 'dark');
  assert.equal(JSON.parse(fs.readFileSync(paths.claudeSettings)).statusLine.refreshInterval, 1);
  assert.ok(calls.some(([, args]) => args.join(' ') === `plugin marketplace add ${paths.claudePlugin}`));
  assert.ok(calls.some(([, args]) => args.join(' ') === 'plugin install bdfl@bdfl'));
  assert.ok(calls.some(([, args]) => args.join(' ') === 'plugin update bdfl@bdfl'));
  installer.uninstall({ dryRun: false });
  assert.deepEqual(JSON.parse(fs.readFileSync(paths.claudeSettings)), { theme: 'dark' });
  assert.equal(JSON.parse(fs.readFileSync(paths.codexMarketplace)).plugins.length, 0);
  assert.equal(fs.existsSync(paths.claudePlugin), false);
});

test('existing unmanaged destinations require force', (t) => {
  const { source, paths, run } = fixture(t);
  fs.mkdirSync(paths.codexPlugin, { recursive: true });
  const installer = new Installer({ sourceRoot: source, paths, run });
  assert.throws(() => installer.install({ force: false }, { claude: false, codex: true, ollama: false }), /requires --force/);
  assert.doesNotThrow(() => installer.install({ force: true }, { claude: false, codex: true, ollama: false }));
});

test('formats a clear installation plan without ANSI when color is disabled', (t) => {
  const { source, paths, run } = fixture(t);
  const installer = new Installer({ sourceRoot: source, paths, run });
  const output = formatPlan(installer.plan({}, { claude: true, codex: false, ollama: false }));
  assert.match(output, /██████╗/);
  assert.match(output, /Benevolent Dictator For Life/);
  assert.match(output, /DETECTED HOSTS/);
  assert.match(output, /Claude marketplace registration and plugin install/);
  assert.match(output, new RegExp(paths.claudeSettings.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(output, /\u001b\[/);
});

test('configures Claude status refresh without discarding unrelated settings', () => {
  assert.deepEqual(mergeClaudeSettings({ theme: 'dark' }, 'node statusline.js'), {
    theme: 'dark',
    enabledPlugins: { 'bdfl@bdfl': true },
    statusLine: { type: 'command', command: 'node statusline.js', padding: 0, refreshInterval: 1 }
  });
});

test('calculates Windows paths and rejects checksum failures', (t) => {
  const paths = installerPaths({ platform: 'win32', env: { APPDATA: 'C:\\Users\\me\\AppData\\Roaming' }, homedir: 'C:\\Users\\me' });
  assert.match(paths.receipt, /BDFL/);
  const { root } = fixture(t);
  const file = path.join(root, 'archive');
  fs.writeFileSync(file, 'content');
  assert.throws(() => verifyChecksum(file, '0'.repeat(64)), /Checksum verification failed/);
});
