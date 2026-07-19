#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

function parseArgs(argv) {
  const options = { dryRun: false, list: false, only: null, force: false, uninstall: false, color: true, nonInteractive: !process.stdin.isTTY };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--dry-run') options.dryRun = true;
    else if (value === '--list') options.list = true;
    else if (value === '--force') options.force = true;
    else if (value === '--uninstall') options.uninstall = true;
    else if (value === '--no-color') options.color = false;
    else if (value === '--non-interactive') options.nonInteractive = true;
    else if (value === '--only') {
      options.only = argv[++index];
      if (!['claude', 'codex'].includes(options.only)) throw new Error('--only must be claude or codex');
    } else throw new Error(`Unknown option: ${value}`);
  }
  return options;
}

function commandAvailable(command, run = spawnSync) {
  const result = run(command, ['--version'], { encoding: 'utf8', stdio: 'pipe' });
  return !result.error && result.status === 0;
}

function detectHosts(run = spawnSync) {
  return { claude: commandAvailable('claude', run), codex: commandAvailable('codex', run), ollama: commandAvailable('ollama', run) };
}

function installerPaths({ platform = process.platform, env = process.env, homedir = os.homedir() } = {}) {
  const claudeRoot = env.CLAUDE_CONFIG_DIR || path.join(homedir, '.claude');
  const codexRoot = env.CODEX_HOME || path.join(homedir, '.codex');
  const agentsRoot = env.AGENTS_HOME || path.join(homedir, '.agents');
  const configRoot = env.BDFL_CONFIG_HOME || (platform === 'win32'
    ? path.join(env.APPDATA || path.join(homedir, 'AppData', 'Roaming'), 'BDFL')
    : platform === 'darwin'
      ? path.join(homedir, 'Library', 'Application Support', 'BDFL')
      : path.join(env.XDG_CONFIG_HOME || path.join(homedir, '.config'), 'bdfl'));
  return {
    claudeRoot,
    claudePlugin: path.join(claudeRoot, 'plugins', 'marketplaces', 'bdfl'),
    claudeSkill: path.join(claudeRoot, 'skills', 'bdfl'),
    claudeSettings: path.join(claudeRoot, 'settings.json'),
    codexRoot,
    codexPlugin: path.join(agentsRoot, 'plugins', 'plugins', 'bdfl'),
    codexMarketplace: path.join(agentsRoot, 'plugins', 'marketplace.json'),
    receipt: path.join(configRoot, 'install.json')
  };
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function verifyChecksum(file, expected) {
  const actual = sha256(file);
  if (!/^[a-f0-9]{64}$/i.test(expected) || actual.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(`Checksum verification failed for ${file}`);
  }
  return actual;
}

function readJson(file, fallback) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : structuredClone(fallback);
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function mergeClaudeSettings(current, statusCommand) {
  const next = structuredClone(current);
  next.enabledPlugins = { ...(next.enabledPlugins || {}), 'bdfl@bdfl': true };
  next.statusLine = { type: 'command', command: statusCommand, padding: 0, refreshInterval: 1 };
  return next;
}

function mergeCodexMarketplace(current) {
  const next = structuredClone(current);
  next.name ||= 'personal';
  next.interface ||= { displayName: 'Personal' };
  next.plugins ||= [];
  const entry = {
    name: 'bdfl',
    source: { source: 'local', path: './plugins/bdfl' },
    policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
    category: 'Productivity'
  };
  const index = next.plugins.findIndex((plugin) => plugin.name === 'bdfl');
  if (index === -1) next.plugins.push(entry); else next.plugins[index] = entry;
  return next;
}

function claudeSkill(runtime) {
  return `---
name: bdfl
description: Activate and manage BDFL only when the user explicitly invokes /bdfl.
disable-model-invocation: true
argument-hint: "[list|help|off|provider:model:effort]"
---

# BDFL

Run the installed BDFL runtime and use its output as the command state:

!\`node ${JSON.stringify(runtime)} $ARGUMENTS\`

After the runtime succeeds, coordinate the requested work with isolated task worktrees, explicit questions and permissions, per-task review, batch validation, and user-approved integration. Preserve native plan mode and never merge agent work directly into the main branch.

Never activate BDFL unless this personal skill was explicitly invoked by the user.
`;
}

class Installer {
  constructor({ sourceRoot = path.resolve(__dirname, '..'), paths = installerPaths(), io = fs, run = spawnSync } = {}) {
    this.sourceRoot = sourceRoot;
    this.paths = paths;
    this.io = io;
    this.run = run;
  }

  runClaude(args, tolerateFailure = false) {
    const result = this.run('claude', args, {
      encoding: 'utf8',
      stdio: 'pipe',
      env: { ...process.env, CLAUDE_CONFIG_DIR: this.paths.claudeRoot }
    });
    if (!tolerateFailure && (result.error || result.status !== 0)) {
      const detail = `${result.stderr || result.stdout || result.error?.message || 'unknown error'}`.trim();
      throw new Error(`Claude Code plugin setup failed: ${detail}`);
    }
    return result;
  }

  plan(options, detected) {
    const hosts = ['claude', 'codex'].filter((host) => detected[host] && (!options.only || options.only === host));
    const operations = [];
    if (hosts.includes('claude')) {
      operations.push({
        type: 'copy', host: 'claude', from: this.sourceRoot, to: this.paths.claudePlugin,
        allow: ['.claude-plugin', 'agents', 'bin', 'claude', 'src', 'package.json', 'LICENSE']
      });
      operations.push({ type: 'claude-native', host: 'claude', path: this.paths.claudePlugin });
      operations.push({ type: 'claude-skill', host: 'claude', path: this.paths.claudeSkill });
      operations.push({ type: 'settings', host: 'claude', path: this.paths.claudeSettings, key: 'statusLine' });
    }
    if (hosts.includes('codex')) {
      operations.push({ type: 'copy', host: 'codex', from: path.join(this.sourceRoot, 'plugins', 'bdfl'), to: this.paths.codexPlugin });
      operations.push({ type: 'marketplace', host: 'codex', path: this.paths.codexMarketplace });
    }
    operations.push({ type: 'receipt', path: this.paths.receipt });
    return { hosts, ollama: detected.ollama, operations };
  }

  install(options, detected, report = () => {}) {
    const plan = this.plan(options, detected);
    if (!plan.hosts.length) throw new Error(options.only ? `${options.only} was requested but is not detected` : 'Neither Claude Code nor Codex was detected');
    if (options.dryRun || options.list) return plan;
    const previousReceipt = readJson(this.paths.receipt, null);
    const receipt = {
      version: 1,
      hosts: plan.hosts,
      paths: this.paths,
      previous: structuredClone(previousReceipt?.previous || {}),
      managed: structuredClone(previousReceipt?.managed || {}),
      installedAt: previousReceipt?.installedAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    if (plan.hosts.includes('claude')) receipt.previous.claudeSettings ||= readJson(this.paths.claudeSettings, {});
    for (const operation of plan.operations) {
      report(operation, 'start');
      if (operation.type === 'copy') {
        if (this.io.existsSync(operation.to) && !options.force && !previousReceipt) throw new Error(`Existing unmanaged path requires --force: ${operation.to}`);
        if (this.io.existsSync(operation.to) && previousReceipt) this.io.rmSync(operation.to, { recursive: true, force: true });
        this.io.mkdirSync(path.dirname(operation.to), { recursive: true });
        this.io.cpSync(operation.from, operation.to, {
          recursive: true,
          force: true,
          filter: (source) => {
            const relative = path.relative(operation.from, source);
            const first = relative.split(path.sep)[0];
            return !relative || (!['.git', '.bdfl', '.agents', 'node_modules'].includes(first) && (!operation.allow || operation.allow.includes(first)));
          }
        });
      } else if (operation.type === 'claude-native') {
        this.runClaude(['plugin', 'marketplace', 'add', operation.path]);
        this.runClaude(['plugin', 'install', 'bdfl@bdfl']);
        this.runClaude(['plugin', 'update', 'bdfl@bdfl']);
      } else if (operation.type === 'claude-skill') {
        const owned = previousReceipt?.managed?.claudeSkill === operation.path;
        if (this.io.existsSync(operation.path) && !owned && !options.force) throw new Error(`Existing unmanaged path requires --force: ${operation.path}`);
        this.io.mkdirSync(operation.path, { recursive: true });
        this.io.writeFileSync(path.join(operation.path, 'SKILL.md'), claudeSkill(path.join(this.paths.claudePlugin, 'bin', 'bdfl.js')));
        receipt.managed.claudeSkill = operation.path;
      } else if (operation.type === 'settings') {
        const current = readJson(operation.path, {});
        const command = `node ${JSON.stringify(path.join(this.paths.claudePlugin, 'src', 'hooks', 'statusline.js'))}`;
        writeJson(operation.path, mergeClaudeSettings(current, command));
      } else if (operation.type === 'marketplace') {
        const current = readJson(operation.path, { name: 'personal', interface: { displayName: 'Personal' }, plugins: [] });
        receipt.previous.codexMarketplace ||= current;
        writeJson(operation.path, mergeCodexMarketplace(current));
      }
      report(operation, 'done');
    }
    writeJson(this.paths.receipt, receipt);
    return plan;
  }

  uninstall(options) {
    const receipt = readJson(this.paths.receipt, null);
    if (!receipt) return { removed: [], alreadyAbsent: true };
    const removed = [];
    if (!options.dryRun && receipt.hosts.includes('claude')) {
      this.runClaude(['plugin', 'uninstall', 'bdfl@bdfl'], true);
      this.runClaude(['plugin', 'marketplace', 'remove', 'bdfl'], true);
    }
    for (const host of receipt.hosts) {
      const target = host === 'claude' ? this.paths.claudePlugin : this.paths.codexPlugin;
      if (options.dryRun) { removed.push(target); continue; }
      if (this.io.existsSync(target)) { this.io.rmSync(target, { recursive: true, force: true }); removed.push(target); }
    }
    if (!options.dryRun && receipt.managed?.claudeSkill && this.io.existsSync(receipt.managed.claudeSkill)) {
      this.io.rmSync(receipt.managed.claudeSkill, { recursive: true, force: true });
      removed.push(receipt.managed.claudeSkill);
    }
    if (!options.dryRun) {
      if (receipt.previous.claudeSettings) writeJson(this.paths.claudeSettings, receipt.previous.claudeSettings);
      if (receipt.previous.codexMarketplace) writeJson(this.paths.codexMarketplace, receipt.previous.codexMarketplace);
      this.io.rmSync(this.paths.receipt, { force: true });
    }
    return { removed, alreadyAbsent: false };
  }
}

const LOGO = Object.freeze([
  '██████╗ ██████╗ ███████╗██╗     ',
  '██╔══██╗██╔══██╗██╔════╝██║     ',
  '██████╔╝██║  ██║█████╗  ██║     ',
  '██╔══██╗██║  ██║██╔══╝  ██║     ',
  '██████╔╝██████╔╝██║     ███████╗',
  '╚═════╝ ╚═════╝ ╚═╝     ╚══════╝'
]);

function theme(enabled) {
  const wrap = (code) => (value) => enabled ? `\u001b[${code}m${value}\u001b[0m` : value;
  return { yellow: wrap('38;5;220'), green: wrap('32'), red: wrap('31'), dim: wrap('2'), bold: wrap('1') };
}

function operationLabel(operation) {
  if (operation.type === 'copy' && operation.host === 'claude') return `Claude marketplace files  ${operation.to}`;
  if (operation.type === 'claude-native') return 'Claude marketplace registration and plugin install';
  if (operation.type === 'claude-skill') return `Claude /bdfl launcher    ${operation.path}`;
  if (operation.type === 'settings') return `Claude status line       ${operation.path}`;
  if (operation.type === 'copy' && operation.host === 'codex') return `Codex plugin files       ${operation.to}`;
  if (operation.type === 'marketplace') return `Codex marketplace entry  ${operation.path}`;
  return `Installation receipt    ${operation.path}`;
}

function formatPlan(plan, { color = false, dryRun = false } = {}) {
  const c = theme(color);
  const lines = [
    ...LOGO.map((line) => c.yellow(line)),
    c.bold('Benevolent Dictator For Life'),
    c.dim('Managed agents. Isolated work. Explicit integration.'),
    '',
    c.yellow('DETECTED HOSTS')
  ];
  for (const host of ['claude', 'codex']) lines.push(`  ${plan.hosts.includes(host) ? c.green('✓') : c.dim('○')} ${host === 'claude' ? 'Claude Code' : 'Codex'}`);
  lines.push(`  ${plan.ollama ? c.green('✓') : c.dim('○')} Ollama ${plan.ollama ? '' : c.dim('(optional, not detected)')}`.trimEnd());
  lines.push('', c.yellow(dryRun ? 'DRY-RUN PLAN' : 'INSTALL PLAN'));
  for (const operation of plan.operations) lines.push(`  ${c.dim('→')} ${operationLabel(operation)}`);
  return lines.join('\n');
}

function formatCompletion(plan, { color = false, uninstall = false } = {}) {
  const c = theme(color);
  if (uninstall) return `${c.green('✓')} BDFL removed. Recorded host settings were restored.`;
  const lines = ['', c.yellow('READY'), `  ${c.green('✓')} BDFL installed for ${plan.hosts.map((host) => host === 'claude' ? 'Claude Code' : 'Codex').join(' and ')}`];
  if (plan.hosts.includes('claude')) lines.push(`  ${c.yellow('!')} Restart Claude Code, then run ${c.bold('/bdfl')}`);
  if (plan.hosts.includes('codex')) lines.push(`  ${c.yellow('!')} Restart Codex, then run ${c.bold('/bdfl')}`);
  lines.push(`  ${c.dim('Uninstall:')} node bin/install.js --uninstall`);
  return lines.join('\n');
}

function main(argv = process.argv.slice(2), output = process.stdout, error = process.stderr) {
  try {
    const options = parseArgs(argv);
    const installer = new Installer();
    const useColor = options.color && !process.env.NO_COLOR && (Boolean(output.isTTY) || process.env.FORCE_COLOR === '1');
    if (options.uninstall) {
      const result = installer.uninstall(options);
      output.write(`${formatCompletion(result, { color: useColor, uninstall: true })}\n`);
      return 0;
    }
    const detected = detectHosts();
    const plan = installer.plan(options, detected);
    if (!plan.hosts.length) throw new Error(options.only ? `${options.only} was requested but is not detected` : 'Neither Claude Code nor Codex was detected');
    output.write(`${formatPlan(plan, { color: useColor, dryRun: options.dryRun || options.list })}\n`);
    const result = installer.install(options, detected, (operation, state) => {
      if (state === 'done') output.write(`  ${theme(useColor).green('✓')} ${operationLabel(operation)}\n`);
    });
    if (!options.dryRun && !options.list) output.write(`${formatCompletion(result, { color: useColor })}\n`);
    return 0;
  } catch (cause) {
    error.write(`${cause.message}\n`);
    return 1;
  }
}

if (require.main === module) process.exitCode = main();

module.exports = { parseArgs, commandAvailable, detectHosts, installerPaths, sha256, verifyChecksum, mergeClaudeSettings, mergeCodexMarketplace, claudeSkill, Installer, LOGO, theme, operationLabel, formatPlan, formatCompletion, main };
