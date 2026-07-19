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
  next.statusLine = { type: 'command', command: statusCommand, padding: 0 };
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

class Installer {
  constructor({ sourceRoot = path.resolve(__dirname, '..'), paths = installerPaths(), io = fs } = {}) {
    this.sourceRoot = sourceRoot;
    this.paths = paths;
    this.io = io;
  }

  plan(options, detected) {
    const hosts = ['claude', 'codex'].filter((host) => detected[host] && (!options.only || options.only === host));
    const operations = [];
    if (hosts.includes('claude')) {
      operations.push({
        type: 'copy', host: 'claude', from: this.sourceRoot, to: this.paths.claudePlugin,
        allow: ['.claude-plugin', 'agents', 'commands', 'skills', 'src', 'package.json', 'LICENSE']
      });
      operations.push({ type: 'settings', host: 'claude', path: this.paths.claudeSettings, key: 'statusLine' });
    }
    if (hosts.includes('codex')) {
      operations.push({ type: 'copy', host: 'codex', from: path.join(this.sourceRoot, 'plugins', 'bdfl'), to: this.paths.codexPlugin });
      operations.push({ type: 'marketplace', host: 'codex', path: this.paths.codexMarketplace });
    }
    operations.push({ type: 'receipt', path: this.paths.receipt });
    return { hosts, ollama: detected.ollama, operations };
  }

  install(options, detected) {
    const plan = this.plan(options, detected);
    if (!plan.hosts.length) throw new Error(options.only ? `${options.only} was requested but is not detected` : 'Neither Claude Code nor Codex was detected');
    if (options.dryRun || options.list) return plan;
    const previousReceipt = readJson(this.paths.receipt, null);
    const receipt = {
      version: 1,
      hosts: plan.hosts,
      paths: this.paths,
      previous: structuredClone(previousReceipt?.previous || {}),
      installedAt: previousReceipt?.installedAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    for (const operation of plan.operations) {
      if (operation.type === 'copy') {
        if (this.io.existsSync(operation.to) && !options.force && !previousReceipt) throw new Error(`Existing unmanaged path requires --force: ${operation.to}`);
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
      } else if (operation.type === 'settings') {
        const current = readJson(operation.path, {});
        receipt.previous.claudeSettings ||= current;
        const command = `node ${JSON.stringify(path.join(this.paths.claudePlugin, 'src', 'hooks', 'statusline.js'))}`;
        writeJson(operation.path, mergeClaudeSettings(current, command));
      } else if (operation.type === 'marketplace') {
        const current = readJson(operation.path, { name: 'personal', interface: { displayName: 'Personal' }, plugins: [] });
        receipt.previous.codexMarketplace ||= current;
        writeJson(operation.path, mergeCodexMarketplace(current));
      }
    }
    writeJson(this.paths.receipt, receipt);
    return plan;
  }

  uninstall(options) {
    const receipt = readJson(this.paths.receipt, null);
    if (!receipt) return { removed: [], alreadyAbsent: true };
    const removed = [];
    for (const host of receipt.hosts) {
      const target = host === 'claude' ? this.paths.claudePlugin : this.paths.codexPlugin;
      if (options.dryRun) { removed.push(target); continue; }
      if (this.io.existsSync(target)) { this.io.rmSync(target, { recursive: true, force: true }); removed.push(target); }
    }
    if (!options.dryRun) {
      if (receipt.previous.claudeSettings) writeJson(this.paths.claudeSettings, receipt.previous.claudeSettings);
      if (receipt.previous.codexMarketplace) writeJson(this.paths.codexMarketplace, receipt.previous.codexMarketplace);
      this.io.rmSync(this.paths.receipt, { force: true });
    }
    return { removed, alreadyAbsent: false };
  }
}

function formatPlan(plan) {
  return [
    `Hosts: ${plan.hosts.join(', ') || 'none'}`,
    `Ollama: ${plan.ollama ? 'detected' : 'not detected'}`,
    ...plan.operations.map((operation) => `${operation.type}: ${operation.to || operation.path}`)
  ].join('\n');
}

function main(argv = process.argv.slice(2), output = process.stdout, error = process.stderr) {
  try {
    const options = parseArgs(argv);
    const installer = new Installer();
    const result = options.uninstall ? installer.uninstall(options) : installer.install(options, detectHosts());
    output.write(`${options.uninstall ? `Removed: ${result.removed.join(', ') || 'nothing'}` : formatPlan(result)}\n`);
    return 0;
  } catch (cause) {
    error.write(`${cause.message}\n`);
    return 1;
  }
}

if (require.main === module) process.exitCode = main();

module.exports = { parseArgs, commandAvailable, detectHosts, installerPaths, sha256, verifyChecksum, mergeClaudeSettings, mergeCodexMarketplace, Installer, formatPlan, main };
