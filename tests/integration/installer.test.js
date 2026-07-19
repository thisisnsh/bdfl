'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseArgs, installerPaths, verifyChecksum, removeBdflStatusLine, mergeCodexMarketplace, Installer, formatPlan } = require('../../bin/install');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bdfl-installer-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'source');
  fs.mkdirSync(path.join(source, 'plugins', 'bdfl'), { recursive: true });
  fs.writeFileSync(path.join(source, 'plugins', 'bdfl', 'plugin.txt'), 'plugin');
  const home = path.join(root, 'home');
  const calls = [];
  const run = (command, args) => { calls.push([command, args]); return { status: 0, stdout: '', stderr: '' }; };
  return { root, source, paths: installerPaths({ platform: 'linux', env: {}, homedir: home }), calls, run };
}

test('parses every public installer option', () => {
  assert.deepEqual(parseArgs(['--dry-run', '--list', '--only', 'codex', '--force', '--uninstall', '--local', '--purge', '--no-color', '--non-interactive']), {
    dryRun: true, list: true, only: 'codex', force: true, uninstall: true, local: true, purge: true, color: false, nonInteractive: true
  });
  assert.throws(() => parseArgs(['--only', 'ollama']), /claude or codex/);
});

test('dry-run lists every mutation without writing', (t) => {
  const { source, paths, run } = fixture(t);
  const installer = new Installer({ sourceRoot: source, paths, run });
  const plan = installer.install({ dryRun: true }, { claude: true, codex: true, ollama: true });
  assert.deepEqual(plan.hosts, ['claude', 'codex']);
  const claudeCopy = plan.operations.find((item) => item.type === 'copy' && item.host === 'claude');
  assert.equal(claudeCopy.allow.includes('skills'), false);
  assert.equal(claudeCopy.allow.includes('commands'), false);
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
  fs.mkdirSync(paths.claudeCache, { recursive: true });
  fs.mkdirSync(paths.codexCache, { recursive: true });
  fs.writeFileSync(path.join(paths.claudeCache, 'stale'), 'cache');
  fs.writeFileSync(path.join(paths.codexCache, 'stale'), 'cache');
  const marketplace = JSON.parse(fs.readFileSync(paths.codexMarketplace));
  assert.equal(marketplace.plugins.filter((item) => item.name === 'bdfl').length, 1);
  assert.equal(path.resolve(paths.codexMarketplaceRoot, marketplace.plugins[0].source.path), paths.codexPlugin);
  assert.equal(JSON.parse(fs.readFileSync(paths.claudeSettings)).theme, 'dark');
  assert.equal(JSON.parse(fs.readFileSync(paths.claudeSettings)).statusLine, undefined);
  assert.ok(calls.some(([, args]) => args.join(' ') === `plugin marketplace add --scope user ${paths.claudePlugin}`));
  assert.ok(calls.some(([, args]) => args.join(' ') === 'plugin install --scope user bdfl@bdfl'));
  assert.ok(calls.some(([, args]) => args.join(' ') === 'plugin update bdfl@bdfl'));
  assert.ok(calls.some(([, args]) => args.join(' ') === 'plugin add bdfl@personal'));
  assert.equal(fs.lstatSync(paths.launcher).isSymbolicLink(), true);
  installer.uninstall({ dryRun: false });
  assert.deepEqual(JSON.parse(fs.readFileSync(paths.claudeSettings)), { theme: 'dark' });
  assert.equal(JSON.parse(fs.readFileSync(paths.codexMarketplace)).plugins.length, 0);
  assert.equal(fs.existsSync(paths.claudePlugin), false);
  assert.equal(fs.existsSync(paths.claudeCache), false);
  assert.equal(fs.existsSync(paths.codexCache), false);
  assert.equal(fs.existsSync(paths.launcher), false);
  assert.equal(fs.existsSync(path.dirname(paths.receipt)), false);
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

test('removes only a BDFL-owned legacy status line', () => {
  assert.deepEqual(removeBdflStatusLine({
    theme: 'dark',
    statusLine: { type: 'command', command: 'node /plugins/bdfl/src/hooks/statusline.js' }
  }), { theme: 'dark' });
  const custom = { type: 'command', command: 'node custom-status.js' };
  assert.deepEqual(removeBdflStatusLine({ theme: 'dark', statusLine: custom }), { theme: 'dark', statusLine: custom });
});

test('migrates only a receipt-owned legacy personal launcher', (t) => {
  const { source, paths, run } = fixture(t);
  const legacy = path.join(path.dirname(paths.claudeRoot), 'legacy-bdfl-skill');
  fs.mkdirSync(legacy, { recursive: true });
  fs.writeFileSync(path.join(legacy, 'SKILL.md'), 'legacy');
  fs.mkdirSync(path.dirname(paths.receipt), { recursive: true });
  fs.writeFileSync(paths.receipt, `${JSON.stringify({ version: 1, hosts: ['claude'], previous: {}, managed: { claudeSkill: legacy } })}\n`);
  new Installer({ sourceRoot: source, paths, run }).install({ force: false }, { claude: true, codex: false, ollama: false });
  assert.equal(fs.existsSync(legacy), false);
});

test('calculates project-local host and receipt paths', (t) => {
  const { root } = fixture(t);
  const paths = installerPaths({ platform: 'linux', env: {}, homedir: path.join(root, 'home'), local: true, projectRoot: path.join(root, 'repo') });
  assert.match(paths.claudeSettings, /\.claude\/settings\.local\.json$/);
  assert.match(paths.codexMarketplace, /\.agents\/plugins\/marketplace\.json$/);
  const marketplace = mergeCodexMarketplace({ plugins: [] }, paths.codexPlugin, paths.codexMarketplaceRoot);
  assert.equal(path.resolve(paths.codexMarketplaceRoot, marketplace.plugins[0].source.path), paths.codexPlugin);
  assert.match(paths.receipt, /\.bdfl\/install\/install\.json$/);
  assert.match(paths.launcher, /\.bdfl\/install\/bdfl$/);
});

test('keeps an existing unmanaged terminal command untouched', (t) => {
  const { source, paths, run } = fixture(t);
  fs.mkdirSync(path.dirname(paths.launcher), { recursive: true });
  fs.writeFileSync(paths.launcher, 'existing command');
  const installer = new Installer({ sourceRoot: source, paths, run });
  installer.install({ force: true }, { claude: false, codex: true, ollama: false });
  assert.equal(fs.readFileSync(paths.launcher, 'utf8'), 'existing command');
  installer.uninstall({ dryRun: false });
  assert.equal(fs.readFileSync(paths.launcher, 'utf8'), 'existing command');
});

test('calculates Windows paths and rejects checksum failures', (t) => {
  const paths = installerPaths({ platform: 'win32', env: { APPDATA: 'C:\\Users\\me\\AppData\\Roaming' }, homedir: 'C:\\Users\\me' });
  assert.match(paths.receipt, /BDFL/);
  const { root } = fixture(t);
  const file = path.join(root, 'archive');
  fs.writeFileSync(file, 'content');
  assert.throws(() => verifyChecksum(file, '0'.repeat(64)), /Checksum verification failed/);
});
