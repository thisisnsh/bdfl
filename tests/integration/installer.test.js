'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  parseArgs, installerPaths, verifyChecksum, removeBdflStatusLine, mergeCodexMarketplace,
  mergeCommandHook, removeCommandHook, Installer, formatPlan, formatCompletion
} = require('../../bin/install');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bdfl-installer-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'source');
  for (const directory of ['src/mcp', 'bin', 'plugins/bdfl/.codex-plugin', '.claude-plugin']) {
    fs.mkdirSync(path.join(source, directory), { recursive: true });
  }
  fs.writeFileSync(path.join(source, 'src', 'mcp', 'server.js'), 'module.exports = {};\n');
  fs.writeFileSync(path.join(source, 'bin', 'bdfl-mcp.js'), '#!/usr/bin/env node\n');
  fs.writeFileSync(path.join(source, 'bin', 'bdfl-hook.js'), '#!/usr/bin/env node\n');
  fs.writeFileSync(path.join(source, 'bin', 'bdfl-statusline.js'), '#!/usr/bin/env node\n');
  fs.writeFileSync(path.join(source, 'bin', 'bdfl.js'), '#!/usr/bin/env node\n');
  fs.writeFileSync(path.join(source, 'bin', 'bdfl'), '#!/bin/sh\n');
  fs.writeFileSync(path.join(source, 'package.json'), '{}\n');
  fs.writeFileSync(path.join(source, 'LICENSE'), 'MIT\n');
  fs.writeFileSync(path.join(source, 'plugins', 'bdfl', '.codex-plugin', 'plugin.json'), '{"name":"bdfl"}\n');
  fs.writeFileSync(path.join(source, '.claude-plugin', 'plugin.json'), '{"name":"bdfl"}\n');
  const home = path.join(root, 'home');
  const paths = installerPaths({ platform: 'linux', env: {}, homedir: home });
  const calls = [];
  const mcps = {};
  const run = (command, args, options) => {
    calls.push([command, args, options]);
    const host = command === 'claude' ? 'claude' : 'codex';
    if (args[0] === 'mcp' && args[1] === 'get') {
      const value = mcps[host];
      if (!value) return { status: 1, stdout: '', stderr: 'not found' };
      return host === 'codex'
        ? { status: 0, stdout: JSON.stringify(value), stderr: '' }
        : { status: 0, stdout: `Command: ${value.command}\nArgs: ${value.args.join(' ')}\n`, stderr: '' };
    }
    if (args[0] === 'mcp' && args[1] === 'add') {
      const separator = args.indexOf('--');
      mcps[host] = { command: args[separator + 1], args: args.slice(separator + 2) };
    }
    if (args[0] === 'mcp' && args[1] === 'remove') delete mcps[host];
    return { status: 0, stdout: '', stderr: '' };
  };
  return { root, source, paths, calls, mcps, run };
}

test('parses every public installer option', () => {
  assert.deepEqual(parseArgs(['--dry-run', '--list', '--only', 'codex', '--force', '--uninstall', '--local', '--purge', '--no-color', '--non-interactive']), {
    dryRun: true, list: true, only: 'codex', force: true, uninstall: true, local: true, purge: true, color: false, nonInteractive: true
  });
  assert.throws(() => parseArgs(['--only', 'ollama']), /claude or codex/);
});

test('dry-run installs no skills and one direct MCP registration per host', (t) => {
  const { source, paths, run } = fixture(t);
  const plan = new Installer({ sourceRoot: source, paths, run }).install({ dryRun: true }, { claude: true, codex: true, ollama: true });
  assert.deepEqual(plan.hosts, ['claude', 'codex']);
  assert.equal(plan.operations.filter((item) => item.type === 'skill').length, 0);
  assert.equal(plan.operations.filter((item) => item.type === 'mcp').length, 2);
  assert.equal(plan.operations.some((item) => ['claude-native', 'codex-native', 'marketplace'].includes(item.type)), false);
  assert.equal(fs.existsSync(paths.receipt), false);
});

test('installation is repeatable and uninstall removes runtime and MCP registrations', (t) => {
  const { source, paths, calls, mcps, run } = fixture(t);
  fs.mkdirSync(path.dirname(paths.claudeSettings), { recursive: true });
  const originalStatusLine = { type: 'command', command: 'printf original', padding: 2 };
  fs.writeFileSync(paths.claudeSettings, `${JSON.stringify({ theme: 'dark', statusLine: originalStatusLine })}\n`);
  const installer = new Installer({ sourceRoot: source, paths, run });
  installer.install({ force: false }, { claude: true, codex: true, ollama: false });
  installer.install({ force: false }, { claude: true, codex: true, ollama: false });
  assert.equal(fs.existsSync(paths.claudeSkill), false);
  assert.equal(fs.existsSync(paths.codexSkill), false);
  assert.equal(fs.existsSync(path.join(paths.runtime, 'bin', 'bdfl-mcp.js')), true);
  assert.deepEqual(Object.keys(mcps).sort(), ['claude', 'codex']);
  const installedSettings = JSON.parse(fs.readFileSync(paths.claudeSettings));
  assert.match(installedSettings.statusLine.command, /bdfl-statusline\.js/);
  assert.equal(installedSettings.statusLine.padding, 2);
  assert.deepEqual(Object.keys(installedSettings.hooks).sort(), ['PostToolUse', 'PreToolUse', 'SessionStart']);
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(paths.codexHooks)).hooks).sort(), ['SessionStart', 'Stop']);
  assert.equal(fs.lstatSync(paths.launcher).isSymbolicLink(), true);
  assert.ok(calls.some(([, args]) => args.join(' ').includes('mcp add --scope user bdfl --')));
  assert.ok(calls.some(([, args]) => args.join(' ').includes('mcp add bdfl --')));
  const claudeMcp = calls.find(([command, args]) => command === 'claude' && args.join(' ').includes('mcp add --scope user bdfl --'));
  assert.equal(claudeMcp[2].cwd, paths.projectRoot);
  assert.equal(claudeMcp[2].env.CLAUDE_CONFIG_DIR, undefined);
  assert.deepEqual(mcps.claude.args.slice(-4), ['--host', 'claude', '--registry', path.join(path.dirname(paths.receipt), 'processes.json')]);
  assert.deepEqual(mcps.codex.args.slice(-4), ['--host', 'codex', '--registry', path.join(path.dirname(paths.receipt), 'processes.json')]);
  installer.uninstall({ dryRun: false });
  assert.deepEqual(JSON.parse(fs.readFileSync(paths.claudeSettings)), { theme: 'dark', statusLine: originalStatusLine });
  assert.equal(fs.existsSync(paths.claudeSkill), false);
  assert.equal(fs.existsSync(paths.codexSkill), false);
  assert.equal(fs.existsSync(paths.runtime), false);
  assert.equal(fs.existsSync(paths.launcher), false);
  assert.deepEqual(mcps, {});
});

test('hook merging is idempotent and removal preserves unrelated lifecycle hooks', () => {
  const initial = { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'keep-me' }] }] } };
  const once = mergeCommandHook(initial, 'Stop', 'bdfl-hook');
  const twice = mergeCommandHook(once, 'Stop', 'bdfl-hook');
  assert.equal(twice.hooks.Stop.length, 2);
  assert.deepEqual(removeCommandHook(twice, 'bdfl-hook'), initial);
  assert.equal(Object.hasOwn(twice.hooks, 'SessionStart'), false);
});

test('uninstall preserves host settings added after installation', (t) => {
  const { source, paths, run } = fixture(t);
  const installer = new Installer({ sourceRoot: source, paths, run });
  installer.install({ force: false }, { claude: true, codex: false, ollama: false });
  const settings = JSON.parse(fs.readFileSync(paths.claudeSettings));
  settings.newAfterInstall = true;
  settings.hooks.Stop = [{ hooks: [{ type: 'command', command: 'keep-after-install' }] }];
  fs.writeFileSync(paths.claudeSettings, `${JSON.stringify(settings)}\n`);
  installer.uninstall({ dryRun: false });
  const restored = JSON.parse(fs.readFileSync(paths.claudeSettings));
  assert.equal(restored.newAfterInstall, true);
  assert.equal(restored.hooks.Stop[0].hooks[0].command, 'keep-after-install');
  assert.equal(JSON.stringify(restored).includes('bdfl-hook.js'), false);
});

test('legacy plugins migrate without force and no longer remain registered', (t) => {
  const { source, paths, calls, mcps, run } = fixture(t);
  fs.mkdirSync(path.join(paths.claudePlugin, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(paths.claudePlugin, '.claude-plugin', 'plugin.json'), '{"name":"bdfl"}\n');
  fs.mkdirSync(path.join(paths.codexPlugin, '.codex-plugin'), { recursive: true });
  fs.writeFileSync(path.join(paths.codexPlugin, '.codex-plugin', 'plugin.json'), '{"name":"bdfl"}\n');
  fs.mkdirSync(path.dirname(paths.launcher), { recursive: true });
  fs.symlinkSync(path.join(paths.codexPlugin, 'bin', 'bdfl'), paths.launcher);
  mcps.claude = { command: 'legacy-node', args: ['legacy-server'] };
  mcps.codex = { command: 'legacy-node', args: ['legacy-server'] };
  const installer = new Installer({ sourceRoot: source, paths, run });
  assert.equal(installer.receiptlessLauncher(['claude', 'codex']), paths.launcher);
  assert.doesNotThrow(() => installer.install({ force: false }, { claude: true, codex: true, ollama: false }));
  assert.equal(fs.existsSync(paths.claudePlugin), false);
  assert.equal(fs.existsSync(paths.codexPlugin), false);
  assert.equal(fs.readlinkSync(paths.launcher), path.join(paths.runtime, 'bin', 'bdfl'));
  assert.ok(calls.some(([, args]) => args.join(' ') === 'plugin uninstall bdfl@bdfl'));
  assert.ok(calls.some(([, args]) => args.join(' ') === 'plugin remove bdfl@personal'));
});

test('upgrades remove only receipt-owned legacy skills and preserve unmanaged skills', (t) => {
  const { source, paths, run } = fixture(t);
  fs.mkdirSync(paths.codexSkill, { recursive: true });
  fs.writeFileSync(path.join(paths.codexSkill, 'custom.txt'), 'preserve');
  const installer = new Installer({ sourceRoot: source, paths, run });
  installer.install({ force: false }, { claude: false, codex: true, ollama: false });
  assert.equal(fs.readFileSync(path.join(paths.codexSkill, 'custom.txt'), 'utf8'), 'preserve');
  const receipt = JSON.parse(fs.readFileSync(paths.receipt));
  const legacy = path.join(paths.projectRoot, 'owned-legacy-skill');
  fs.mkdirSync(legacy, { recursive: true });
  fs.writeFileSync(path.join(legacy, 'SKILL.md'), 'legacy');
  receipt.managed.codexSkill = legacy;
  fs.writeFileSync(paths.receipt, `${JSON.stringify(receipt)}\n`);
  installer.install({ force: false }, { claude: false, codex: true, ollama: false });
  assert.equal(fs.existsSync(legacy), false);
  installer.uninstall({ dryRun: false });
  assert.equal(fs.readFileSync(path.join(paths.codexSkill, 'custom.txt'), 'utf8'), 'preserve');
});

test('unmanaged MCP configuration requires force and is restored on uninstall', (t) => {
  const { source, paths, mcps, run } = fixture(t);
  mcps.codex = { command: 'custom-server', args: ['--keep'] };
  const installer = new Installer({ sourceRoot: source, paths, run });
  assert.throws(() => installer.install({ force: false }, { claude: false, codex: true, ollama: false }), /unmanaged MCP/);
  installer.install({ force: true }, { claude: false, codex: true, ollama: false });
  assert.notEqual(mcps.codex.command, 'custom-server');
  installer.uninstall({ dryRun: false });
  assert.deepEqual(mcps.codex, { command: 'custom-server', args: ['--keep'] });
});

test('receiptless uninstall removes only verified legacy BDFL installations', (t) => {
  const { source, paths, calls, run } = fixture(t);
  fs.mkdirSync(path.join(paths.claudePlugin, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(paths.claudePlugin, '.claude-plugin', 'plugin.json'), '{"name":"bdfl"}\n');
  fs.mkdirSync(path.dirname(paths.claudeSettings), { recursive: true });
  fs.writeFileSync(paths.claudeSettings, `${JSON.stringify({ statusLine: { type: 'command', command: 'node /bdfl/statusline.js' } })}\n`);
  const result = new Installer({ sourceRoot: source, paths, run }).uninstall({ dryRun: false });
  assert.equal(result.receiptless, true);
  assert.equal(fs.existsSync(paths.claudePlugin), false);
  assert.ok(calls.some(([, args]) => args.join(' ') === 'plugin uninstall bdfl@bdfl'));
  assert.match(formatCompletion(result, { uninstall: true }), /Legacy BDFL installation removed/);
});

test('receiptless uninstall refuses unverified directories and reports no-op', (t) => {
  const { source, paths, run } = fixture(t);
  fs.mkdirSync(paths.claudePlugin, { recursive: true });
  fs.writeFileSync(path.join(paths.claudePlugin, 'unrelated.txt'), 'keep');
  const result = new Installer({ sourceRoot: source, paths, run }).uninstall({ dryRun: false });
  assert.equal(result.alreadyAbsent, true);
  assert.equal(fs.existsSync(paths.claudePlugin), true);
  assert.match(formatCompletion(result, { uninstall: true }), /Nothing was removed/);
});

test('formats MCP-only installation without ANSI', (t) => {
  const { source, paths, run } = fixture(t);
  const output = formatPlan(new Installer({ sourceRoot: source, paths, run }).plan({}, { claude: true, codex: false, ollama: false }));
  assert.match(output, /██████╗/);
  assert.match(output, /Benevolent Delegator for LLMs/);
  assert.equal(output.includes(['Dict', 'ator'].join('')), false);
  assert.match(output, /Ollama \(coming soon\)/);
  assert.doesNotMatch(output, /skill/);
  assert.match(output, /Claude MCP registration/);
  assert.match(output, /Claude startup and plan hooks/);
  assert.doesNotMatch(output, /marketplace registration|plugin install/);
  assert.doesNotMatch(output, /\u001b\[/);
});

test('removes only a BDFL-owned legacy status line', () => {
  assert.deepEqual(removeBdflStatusLine({ theme: 'dark', statusLine: { type: 'command', command: 'node /plugins/bdfl/statusline.js' } }), { theme: 'dark' });
  const custom = { type: 'command', command: 'node custom-status.js' };
  assert.deepEqual(removeBdflStatusLine({ theme: 'dark', statusLine: custom }), { theme: 'dark', statusLine: custom });
});

test('calculates standalone global and local skill paths', (t) => {
  const { root } = fixture(t);
  const global = installerPaths({ platform: 'linux', env: {}, homedir: path.join(root, 'home') });
  assert.match(global.claudeSkill, /\.claude\/skills\/bdfl$/);
  assert.match(global.codexSkill, /\.codex\/skills\/bdfl$/);
  const local = installerPaths({ platform: 'linux', env: {}, homedir: path.join(root, 'home'), local: true, projectRoot: path.join(root, 'repo') });
  assert.match(local.claudeSkill, /\.claude\/skills\/bdfl$/);
  assert.match(local.codexSkill, /\.agents\/skills\/bdfl$/);
  assert.match(local.receipt, /\.bdfl\/install\/install\.json$/);
});

test('keeps an existing unmanaged compatibility launcher untouched', (t) => {
  const { source, paths, run } = fixture(t);
  fs.mkdirSync(path.dirname(paths.launcher), { recursive: true });
  fs.writeFileSync(paths.launcher, 'existing command');
  const installer = new Installer({ sourceRoot: source, paths, run });
  installer.install({ force: true }, { claude: false, codex: true, ollama: false });
  assert.equal(fs.readFileSync(paths.launcher, 'utf8'), 'existing command');
  installer.uninstall({ dryRun: false });
  assert.equal(fs.readFileSync(paths.launcher, 'utf8'), 'existing command');
});

test('keeps legacy marketplace helpers and rejects checksum failures', (t) => {
  const { root, paths } = fixture(t);
  const marketplace = mergeCodexMarketplace({ plugins: [] }, paths.codexPlugin, paths.codexMarketplaceRoot);
  assert.equal(path.resolve(paths.codexMarketplaceRoot, marketplace.plugins[0].source.path), paths.codexPlugin);
  const file = path.join(root, 'archive');
  fs.writeFileSync(file, 'content');
  assert.throws(() => verifyChecksum(file, '0'.repeat(64)), /Checksum verification failed/);
  assert.match(installerPaths({ platform: 'win32', env: { APPDATA: 'C:\\Users\\me\\AppData\\Roaming' }, homedir: 'C:\\Users\\me' }).receipt, /BDFL/);
});
