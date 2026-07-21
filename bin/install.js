#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

function parseArgs(argv) {
  const options = { dryRun: false, list: false, only: null, force: false, uninstall: false, local: false, purge: false, color: true, nonInteractive: !process.stdin.isTTY };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--dry-run') options.dryRun = true;
    else if (value === '--list') options.list = true;
    else if (value === '--force') options.force = true;
    else if (value === '--uninstall') options.uninstall = true;
    else if (value === '--local') options.local = true;
    else if (value === '--purge') options.purge = true;
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

function installerPaths({ platform = process.platform, env = process.env, homedir = os.homedir(), local = false, projectRoot = process.cwd() } = {}) {
  const claudeRoot = local ? path.join(projectRoot, '.claude') : (env.CLAUDE_CONFIG_DIR || path.join(homedir, '.claude'));
  const codexRoot = env.CODEX_HOME || path.join(homedir, '.codex');
  const agentsRoot = local ? path.join(projectRoot, '.agents') : (env.AGENTS_HOME || path.join(homedir, '.agents'));
  const configRoot = local ? path.join(projectRoot, '.bdfl', 'install') : (env.BDFL_CONFIG_HOME || (platform === 'win32'
    ? path.join(env.APPDATA || path.join(homedir, 'AppData', 'Roaming'), 'BDFL')
    : platform === 'darwin'
      ? path.join(homedir, 'Library', 'Application Support', 'BDFL')
      : path.join(env.XDG_CONFIG_HOME || path.join(homedir, '.config'), 'bdfl')));
  return {
    local,
    projectRoot,
    claudeRoot,
    claudePlugin: local ? path.join(projectRoot, '.bdfl', 'install', 'claude') : path.join(claudeRoot, 'plugins', 'marketplaces', 'bdfl'),
    claudeCache: path.join(claudeRoot, 'plugins', 'cache', 'bdfl'),
    claudeSettings: path.join(claudeRoot, local ? 'settings.local.json' : 'settings.json'),
    claudeSkill: path.join(claudeRoot, 'skills', 'bdfl'),
    codexRoot,
    codexHooks: local ? path.join(projectRoot, '.codex', 'hooks.json') : path.join(codexRoot, 'hooks.json'),
    codexMarketplaceRoot: local ? projectRoot : homedir,
    codexPlugin: path.join(agentsRoot, 'plugins', 'plugins', 'bdfl'),
    codexCache: path.join(codexRoot, 'plugins', 'cache', 'personal', 'bdfl'),
    codexMarketplace: path.join(agentsRoot, 'plugins', 'marketplace.json'),
    codexSkill: local ? path.join(agentsRoot, 'skills', 'bdfl') : path.join(codexRoot, 'skills', 'bdfl'),
    runtime: path.join(configRoot, 'runtime'),
    backups: path.join(configRoot, 'backups'),
    launcher: local
      ? path.join(projectRoot, '.bdfl', 'install', platform === 'win32' ? 'bdfl.cmd' : 'bdfl')
      : platform === 'win32'
        ? path.join(env.LOCALAPPDATA || path.join(homedir, 'AppData', 'Local'), 'BDFL', 'bin', 'bdfl.cmd')
        : path.join(homedir, '.local', 'bin', 'bdfl'),
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

function pathExists(io, file) {
  try { io.lstatSync(file); return true; } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function hookHandler(command) { return { type: 'command', command }; }

function mergeCommandHook(current, event, command, matcher) {
  const next = structuredClone(current || {});
  next.hooks ||= {};
  const groups = Array.isArray(next.hooks[event]) ? next.hooks[event] : [];
  const exists = groups.some((group) => (group.hooks || [group]).some((hook) => hook.command === command));
  if (!exists) groups.push({ ...(matcher ? { matcher } : {}), hooks: [hookHandler(command)] });
  next.hooks[event] = groups;
  return next;
}

function removeCommandHook(current, command) {
  const next = structuredClone(current || {});
  for (const [event, groups] of Object.entries(next.hooks || {})) {
    next.hooks[event] = (Array.isArray(groups) ? groups : []).map((group) => {
      const hooks = (group.hooks || [group]).filter((hook) => hook.command !== command);
      return group.hooks ? { ...group, hooks } : hooks[0];
    }).filter((group) => group && (group.hooks ? group.hooks.length : true));
    if (!next.hooks[event].length) delete next.hooks[event];
  }
  if (next.hooks && !Object.keys(next.hooks).length) delete next.hooks;
  return next;
}

function removeBdflStatusLine(current, previous = {}) {
  const next = structuredClone(current);
  const command = next.statusLine?.command;
  if (typeof command === 'string' && /bdfl.*statusline\.js|statusline\.js.*bdfl/i.test(command)) {
    if (Object.hasOwn(previous, 'statusLine')) next.statusLine = structuredClone(previous.statusLine);
    else delete next.statusLine;
  }
  return next;
}

function isBdflPlugin(directory, manifest, io = fs) {
  const file = path.join(directory, manifest);
  if (!io.existsSync(file)) return false;
  try { return JSON.parse(io.readFileSync(file, 'utf8')).name === 'bdfl'; }
  catch { return false; }
}

function isBdflSkill(directory, io = fs) {
  const file = path.join(directory, 'SKILL.md');
  if (!io.existsSync(file)) return false;
  try { return /^---\s*[\s\S]*?^name:\s*bdfl\s*$/m.test(io.readFileSync(file, 'utf8')); }
  catch { return false; }
}

function removeBdflMarketplaceEntry(current, pluginPath, marketplaceRoot = os.homedir()) {
  const next = structuredClone(current);
  next.plugins = (next.plugins || []).filter((plugin) => {
    if (plugin.name !== 'bdfl' || plugin.source?.source !== 'local' || !plugin.source.path) return true;
    return path.resolve(marketplaceRoot, plugin.source.path) !== path.resolve(pluginPath);
  });
  return next;
}

function mergeCodexMarketplace(current, pluginPath = path.join(os.homedir(), '.agents', 'plugins', 'plugins', 'bdfl'), marketplaceRoot = os.homedir()) {
  const next = structuredClone(current);
  next.name ||= 'personal';
  next.interface ||= { displayName: 'Personal' };
  next.plugins ||= [];
  const entry = {
    name: 'bdfl',
    source: { source: 'local', path: `./${path.relative(marketplaceRoot, pluginPath).split(path.sep).join('/')}` },
    policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
    category: 'Productivity'
  };
  const index = next.plugins.findIndex((plugin) => plugin.name === 'bdfl');
  if (index === -1) next.plugins.push(entry); else next.plugins[index] = entry;
  return next;
}

class Installer {
  constructor({ sourceRoot = path.resolve(__dirname, '..'), paths = installerPaths(), io = fs, run = spawnSync } = {}) {
    this.sourceRoot = sourceRoot;
    this.paths = paths;
    this.io = io;
    this.run = run;
  }

  runClaude(args, tolerateFailure = false) {
    const env = { ...process.env };
    if (!process.env.CLAUDE_CONFIG_DIR) delete env.CLAUDE_CONFIG_DIR;
    const result = this.run('claude', args, {
      encoding: 'utf8',
      stdio: 'pipe',
      cwd: this.paths.projectRoot,
      env
    });
    if (!tolerateFailure && (result.error || result.status !== 0)) {
      const detail = `${result.stderr || result.stdout || result.error?.message || 'unknown error'}`.trim();
      throw new Error(`Claude Code setup failed: ${detail}`);
    }
    return result;
  }

  runCodex(args, tolerateFailure = false) {
    const result = this.run('codex', args, { encoding: 'utf8', stdio: 'pipe', cwd: this.paths.projectRoot });
    if (!tolerateFailure && (result.error || result.status !== 0)) {
      const detail = `${result.stderr || result.stdout || result.error?.message || 'unknown error'}`.trim();
      throw new Error(`Codex setup failed: ${detail}`);
    }
    return result;
  }

  removeLegacySkills(receipt, removed = []) {
    for (const key of ['claudeSkill', 'codexSkill']) {
      const target = receipt?.managed?.[key];
      if (target && this.io.existsSync(target)) {
        this.io.rmSync(target, { recursive: true, force: true });
        removed.push(target);
      }
      if (receipt?.managed) delete receipt.managed[key];
    }
    return removed;
  }

  receiptlessHosts() {
    const hosts = [];
    if (isBdflPlugin(this.paths.claudePlugin, path.join('.claude-plugin', 'plugin.json'), this.io)) hosts.push('claude');
    if (isBdflPlugin(this.paths.codexPlugin, path.join('.codex-plugin', 'plugin.json'), this.io)) hosts.push('codex');
    return hosts;
  }

  receiptlessLauncher(hosts) {
    if (!pathExists(this.io, this.paths.launcher)) return null;
    let target;
    try {
      if (!this.io.lstatSync(this.paths.launcher).isSymbolicLink()) return null;
      target = path.resolve(path.dirname(this.paths.launcher), this.io.readlinkSync(this.paths.launcher));
    } catch { return null; }
    return hosts.some((host) => {
      const root = host === 'claude' ? this.paths.claudePlugin : this.paths.codexPlugin;
      return target === path.join(root, 'bin', 'bdfl');
    }) ? this.paths.launcher : null;
  }

  copyTree(from, to, allow) {
    this.io.mkdirSync(path.dirname(to), { recursive: true });
    this.io.cpSync(from, to, {
      recursive: true,
      force: true,
      filter: (source) => {
        const relative = path.relative(from, source);
        const first = relative.split(path.sep)[0];
        return !relative || (!['.git', '.bdfl', '.agents', 'node_modules'].includes(first) && (!allow || allow.includes(first)));
      }
    });
  }

  preservePath(target, key, receipt, previousReceipt, force) {
    if (!this.io.existsSync(target)) return;
    if (previousReceipt?.managed?.[key] === target) {
      this.io.rmSync(target, { recursive: true, force: true });
      return;
    }
    if (!force) throw new Error(`Existing unmanaged path requires --force: ${target}`);
    const backup = path.join(this.paths.backups, key);
    if (this.io.existsSync(backup)) this.io.rmSync(backup, { recursive: true, force: true });
    this.io.mkdirSync(path.dirname(backup), { recursive: true });
    this.io.renameSync(target, backup);
    receipt.previous.replacedPaths ||= {};
    receipt.previous.replacedPaths[key] = { target, backup };
  }

  readMcp(host) {
    const result = host === 'claude'
      ? this.runClaude(['mcp', 'get', 'bdfl'], true)
      : this.runCodex(['mcp', 'get', 'bdfl', '--json'], true);
    if (result.error || result.status !== 0) return null;
    const output = `${result.stdout || ''}`.trim();
    if (!output) return null;
    if (host === 'codex') {
      try {
        const value = JSON.parse(output);
        const command = value.command || value.transport?.command || value.stdio?.command;
        const args = value.args || value.transport?.args || value.stdio?.args || [];
        return command ? { command, args } : { raw: output };
      } catch { return { raw: output }; }
    }
    const command = output.match(/^\s*Command:\s*(.+)$/mi)?.[1]?.trim();
    const args = output.match(/^\s*Args:\s*(.*)$/mi)?.[1]?.trim().split(/\s+/).filter(Boolean) || [];
    return command ? { command, args } : { raw: output };
  }

  removeMcp(host) {
    if (host === 'claude') this.runClaude(['mcp', 'remove', '--scope', this.paths.local ? 'local' : 'user', 'bdfl'], true);
    else this.runCodex(['mcp', 'remove', 'bdfl'], true);
  }

  addMcp(host, command, args) {
    if (host === 'claude') this.runClaude(['mcp', 'add', '--scope', this.paths.local ? 'local' : 'user', 'bdfl', '--', command, ...args]);
    else this.runCodex(['mcp', 'add', 'bdfl', '--', command, ...args]);
  }

  configureMcp(host, runtime, receipt, previousReceipt, force) {
    const existing = this.readMcp(host);
    const legacyPath = host === 'claude' ? this.paths.claudePlugin : this.paths.codexPlugin;
    const legacyManifest = host === 'claude' ? path.join('.claude-plugin', 'plugin.json') : path.join('.codex-plugin', 'plugin.json');
    const managedBefore = previousReceipt?.managed?.mcp?.[host]
      || previousReceipt?.hosts?.includes(host)
      || receipt.previous?.legacyHosts?.includes(host)
      || isBdflPlugin(legacyPath, legacyManifest, this.io);
    if (existing && !managedBefore) {
      if (!force) throw new Error(`Existing unmanaged MCP server requires --force: ${host}:bdfl`);
      if (!existing.command) throw new Error(`Cannot safely preserve existing ${host} MCP server bdfl`);
      receipt.previous.mcp ||= {};
      receipt.previous.mcp[host] = existing;
    }
    if (existing) this.removeMcp(host);
    const args = [runtime, '--host', host, '--registry', path.join(path.dirname(this.paths.receipt), 'processes.json')];
    this.addMcp(host, process.execPath, args);
    receipt.managed.mcp ||= {};
    receipt.managed.mcp[host] = { command: process.execPath, args };
  }

  cleanLegacy(host, receipt) {
    if (host === 'claude') {
      this.runClaude(['plugin', 'uninstall', 'bdfl@bdfl'], true);
      this.runClaude(['plugin', 'marketplace', 'remove', 'bdfl'], true);
      if (isBdflPlugin(this.paths.claudePlugin, path.join('.claude-plugin', 'plugin.json'), this.io)) this.io.rmSync(this.paths.claudePlugin, { recursive: true, force: true });
      if (this.io.existsSync(this.paths.claudeCache)) this.io.rmSync(this.paths.claudeCache, { recursive: true, force: true });
    } else {
      this.runCodex(['plugin', 'remove', 'bdfl@personal'], true);
      if (isBdflPlugin(this.paths.codexPlugin, path.join('.codex-plugin', 'plugin.json'), this.io)) this.io.rmSync(this.paths.codexPlugin, { recursive: true, force: true });
      if (this.io.existsSync(this.paths.codexCache)) this.io.rmSync(this.paths.codexCache, { recursive: true, force: true });
      const current = readJson(this.paths.codexMarketplace, { name: 'personal', interface: { displayName: 'Personal' }, plugins: [] });
      receipt.previous.codexMarketplace ||= current;
      writeJson(this.paths.codexMarketplace, removeBdflMarketplaceEntry(current, this.paths.codexPlugin, this.paths.codexMarketplaceRoot));
    }
  }

  plan(options, detected) {
    const hosts = ['claude', 'codex'].filter((host) => detected[host] && (!options.only || options.only === host));
    const operations = [{ type: 'runtime', from: this.sourceRoot, to: this.paths.runtime }];
    if (hosts.includes('claude')) {
      operations.push({ type: 'legacy-cleanup', host: 'claude', path: this.paths.claudePlugin });
      operations.push({ type: 'mcp', host: 'claude', path: path.join(this.paths.runtime, 'bin', 'bdfl-mcp.js') });
      operations.push({ type: 'settings-cleanup', host: 'claude', path: this.paths.claudeSettings });
      operations.push({ type: 'hooks', host: 'claude', path: this.paths.claudeSettings });
    }
    if (hosts.includes('codex')) {
      operations.push({ type: 'legacy-cleanup', host: 'codex', path: this.paths.codexPlugin });
      operations.push({ type: 'mcp', host: 'codex', path: path.join(this.paths.runtime, 'bin', 'bdfl-mcp.js') });
      operations.push({ type: 'hooks', host: 'codex', path: this.paths.codexHooks });
    }
    operations.push({ type: 'launcher', path: this.paths.launcher });
    operations.push({ type: 'receipt', path: this.paths.receipt });
    return { hosts, ollama: detected.ollama, scope: this.paths.local ? 'LOCAL' : 'GLOBAL', operations };
  }

  install(options, detected, report = () => {}) {
    const plan = this.plan(options, detected);
    if (!plan.hosts.length) throw new Error(options.only ? `${options.only} was requested but is not detected` : 'Neither Claude Code nor Codex was detected');
    if (options.dryRun || options.list) return plan;
    const previousReceipt = readJson(this.paths.receipt, null);
    const legacyLauncher = this.receiptlessLauncher(plan.hosts);
    for (const operation of plan.operations.filter((item) => item.type === 'runtime')) {
      const key = 'runtime';
      if (this.io.existsSync(operation.to) && previousReceipt?.managed?.[key] !== operation.to && !options.force) {
        throw new Error(`Existing unmanaged path requires --force: ${operation.to}`);
      }
    }
    for (const host of plan.hosts) {
      const existing = this.readMcp(host);
      const legacyPath = host === 'claude' ? this.paths.claudePlugin : this.paths.codexPlugin;
      const legacyManifest = host === 'claude' ? path.join('.claude-plugin', 'plugin.json') : path.join('.codex-plugin', 'plugin.json');
      const managed = previousReceipt?.hosts?.includes(host) || isBdflPlugin(legacyPath, legacyManifest, this.io);
      if (existing && !managed && !options.force) throw new Error(`Existing unmanaged MCP server requires --force: ${host}:bdfl`);
    }
    if (previousReceipt) this.removeLegacySkills(previousReceipt);
    const receipt = {
      version: 2,
      hosts: [...new Set([...(previousReceipt?.hosts || []), ...plan.hosts])],
      paths: this.paths,
      previous: structuredClone(previousReceipt?.previous || {}),
      managed: structuredClone(previousReceipt?.managed || {}),
      installedAt: previousReceipt?.installedAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    receipt.previous.legacyHosts ||= plan.hosts.filter((host) => {
      const legacyPath = host === 'claude' ? this.paths.claudePlugin : this.paths.codexPlugin;
      const manifest = host === 'claude' ? path.join('.claude-plugin', 'plugin.json') : path.join('.codex-plugin', 'plugin.json');
      return isBdflPlugin(legacyPath, manifest, this.io);
    });
    if (plan.hosts.includes('claude')) receipt.previous.claudeSettings ||= readJson(this.paths.claudeSettings, {});
    receipt.previous.hooks ||= {};
    for (const operation of plan.operations) {
      report(operation, 'start');
      if (operation.type === 'runtime') {
        this.preservePath(operation.to, 'runtime', receipt, previousReceipt, options.force);
        this.copyTree(operation.from, operation.to, ['bin', 'src', 'package.json', 'LICENSE']);
        receipt.managed.runtime = operation.to;
      } else if (operation.type === 'mcp') {
        this.configureMcp(operation.host, operation.path, receipt, previousReceipt, options.force);
      } else if (operation.type === 'legacy-cleanup') {
        this.cleanLegacy(operation.host, receipt);
      } else if (operation.type === 'settings-cleanup') {
        const current = readJson(operation.path, {});
        const executable = path.join(this.paths.runtime, 'bin', 'bdfl-statusline.js');
        const command = `"${process.execPath}" "${executable}" "${this.paths.receipt}"`;
        writeJson(operation.path, { ...current, statusLine: { ...(current.statusLine || {}), type: 'command', command } });
        receipt.managed.statusLine = { path: operation.path, command };
      } else if (operation.type === 'hooks') {
        const current = readJson(operation.path, {});
        receipt.previous.hooks[operation.host] ||= structuredClone(current.hooks || {});
        const executable = path.join(this.paths.runtime, 'bin', 'bdfl-hook.js');
        const registry = path.join(path.dirname(this.paths.receipt), 'processes.json');
        const command = `"${process.execPath}" "${executable}" ${operation.host} "${registry}"`;
        let next = current;
        next = mergeCommandHook(next, 'SessionStart', command);
        if (operation.host === 'claude') {
          next = mergeCommandHook(next, 'PreToolUse', command, 'ExitPlanMode');
          next = mergeCommandHook(next, 'PostToolUse', command, 'ExitPlanMode');
        } else next = mergeCommandHook(next, 'Stop', command);
        writeJson(operation.path, next);
        receipt.managed.hooks ||= {};
        receipt.managed.hooks[operation.host] = { path: operation.path, command };
      } else if (operation.type === 'launcher') {
        const target = path.join(this.paths.runtime, 'bin', 'bdfl');
        const wasManaged = previousReceipt?.managed?.launcher === operation.path;
        const replace = wasManaged || legacyLauncher === operation.path;
        if (replace) {
          if (this.io.lstatSync(operation.path).isSymbolicLink()) this.io.unlinkSync(operation.path);
          else this.io.rmSync(operation.path, { force: true });
        }
        if (replace || !pathExists(this.io, operation.path)) {
          this.io.mkdirSync(path.dirname(operation.path), { recursive: true });
          if (process.platform === 'win32' || operation.path.endsWith('.cmd')) {
            this.io.writeFileSync(operation.path, `@echo off\r\nnode "${path.join(this.paths.runtime, 'bin', 'bdfl.js')}" %*\r\n`);
          } else {
            this.io.symlinkSync(target, operation.path);
          }
          receipt.managed.launcher = operation.path;
        }
      }
      report(operation, 'done');
    }
    writeJson(this.paths.receipt, receipt);
    return plan;
  }

  uninstall(options) {
    const recordedReceipt = readJson(this.paths.receipt, null);
    const receiptless = !recordedReceipt;
    const hosts = receiptless ? this.receiptlessHosts() : recordedReceipt.hosts;
    if (!hosts.length) return { removed: [], alreadyAbsent: true };
    const receipt = recordedReceipt || {
      version: 1,
      hosts,
      previous: {},
      managed: { launcher: this.receiptlessLauncher(hosts) }
    };
    const removed = [];
    for (const host of receipt.hosts) {
      if (!options.dryRun) {
        this.removeMcp(host);
        if (receipt.previous?.mcp?.[host]?.command) this.addMcp(host, receipt.previous.mcp[host].command, receipt.previous.mcp[host].args || []);
        this.cleanLegacy(host, receipt);
      }
      const managedHook = receipt.managed?.hooks?.[host];
      if (!options.dryRun && managedHook?.path && this.io.existsSync(managedHook.path)) {
        const current = readJson(managedHook.path, {});
        writeJson(managedHook.path, removeCommandHook(current, managedHook.command));
      }
    }
    const runtime = receipt.managed?.runtime || this.paths.runtime;
    if (options.dryRun) { if (this.io.existsSync(runtime)) removed.push(runtime); }
    else if (this.io.existsSync(runtime)) { this.io.rmSync(runtime, { recursive: true, force: true }); removed.push(runtime); }
    const launcher = receipt.managed?.launcher;
    if (launcher) {
      if (options.dryRun) { if (pathExists(this.io, launcher)) removed.push(launcher); }
      else if (pathExists(this.io, launcher)) { this.io.rmSync(launcher, { force: true }); removed.push(launcher); }
    }
    if (!options.dryRun) this.removeLegacySkills(receipt, removed);
    if (!options.dryRun) {
      for (const replacement of Object.values(receipt.previous?.replacedPaths || {})) {
        if (!replacement?.target || !replacement?.backup || !this.io.existsSync(replacement.backup)) continue;
        this.io.mkdirSync(path.dirname(replacement.target), { recursive: true });
        this.io.renameSync(replacement.backup, replacement.target);
      }
      if (this.io.existsSync(this.paths.backups) && this.io.readdirSync(this.paths.backups).length === 0) this.io.rmdirSync(this.paths.backups);
      if (receiptless && hosts.includes('claude')) {
        const current = readJson(this.paths.claudeSettings, {});
        writeJson(this.paths.claudeSettings, removeBdflStatusLine(current));
      } else if (receipt.previous.claudeSettings) {
        const current = readJson(this.paths.claudeSettings, {});
        const next = removeBdflStatusLine(current, receipt.previous.claudeSettings);
        if (Object.hasOwn(receipt.previous.claudeSettings, 'statusLine')) next.statusLine = structuredClone(receipt.previous.claudeSettings.statusLine);
        writeJson(this.paths.claudeSettings, next);
      }
      if (receiptless && hosts.includes('codex')) {
        const current = readJson(this.paths.codexMarketplace, { name: 'personal', interface: { displayName: 'Personal' }, plugins: [] });
        writeJson(this.paths.codexMarketplace, removeBdflMarketplaceEntry(current, this.paths.codexPlugin, this.paths.codexMarketplaceRoot));
      } else if (receipt.previous.codexMarketplace) writeJson(this.paths.codexMarketplace, receipt.previous.codexMarketplace);
      this.io.rmSync(this.paths.receipt, { force: true });
      if (options.purge) {
        const state = path.join(this.paths.projectRoot, '.bdfl');
        if (this.io.existsSync(state)) { this.io.rmSync(state, { recursive: true, force: true }); removed.push(state); }
      }
      const receiptDirectory = path.dirname(this.paths.receipt);
      if (this.io.existsSync(receiptDirectory) && this.io.readdirSync(receiptDirectory).length === 0) this.io.rmdirSync(receiptDirectory);
    }
    return { removed, alreadyAbsent: false, receiptless };
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
  if (operation.type === 'runtime') return `Shared BDFL runtime      ${operation.to}`;
  if (operation.type === 'mcp') return `${operation.host === 'claude' ? 'Claude' : 'Codex'} MCP registration   bdfl`;
  if (operation.type === 'legacy-cleanup') return `${operation.host === 'claude' ? 'Claude' : 'Codex'} legacy plugin cleanup`;
  if (operation.type === 'settings-cleanup') return `Claude composed status line ${operation.path}`;
  if (operation.type === 'hooks') return `${operation.host === 'claude' ? 'Claude' : 'Codex'} startup and plan hooks`;
  if (operation.type === 'launcher') return `Compatibility launcher  ${operation.path}`;
  return `Installation receipt    ${operation.path}`;
}

function formatPlan(plan, { color = false, dryRun = false } = {}) {
  const c = theme(color);
  const lines = [
    ...LOGO.map((line) => c.yellow(line)),
    c.bold('Benevolent Delegator for LLMs'),
    c.dim('Managed agents. Isolated work. Explicit integration.'),
    '',
    c.yellow(`${plan.scope} INSTALLATION`),
    '',
    c.yellow('DETECTED HOSTS')
  ];
  for (const host of ['claude', 'codex']) lines.push(`  ${plan.hosts.includes(host) ? c.green('✓') : c.dim('○')} ${host === 'claude' ? 'Claude Code' : 'Codex'}`);
  lines.push(`  ${c.dim('○')} Ollama ${c.dim('(coming soon)')}`);
  lines.push('', c.yellow(dryRun ? 'DRY-RUN PLAN' : 'INSTALL PLAN'));
  for (const operation of plan.operations) lines.push(`  ${c.dim('→')} ${operationLabel(operation)}`);
  return lines.join('\n');
}

function formatCompletion(plan, { color = false, uninstall = false } = {}) {
  const c = theme(color);
  if (uninstall && plan.alreadyAbsent) return `${c.yellow('!')} BDFL was not found. Nothing was removed.`;
  if (uninstall && plan.receiptless) return `${c.green('✓')} Legacy BDFL installation removed.`;
  if (uninstall) return `${c.green('✓')} BDFL removed. Recorded host settings were restored.`;
  const lines = ['', c.yellow('READY'), `  ${c.green('✓')} BDFL installed for ${plan.hosts.map((host) => host === 'claude' ? 'Claude Code' : 'Codex').join(' and ')}`];
  if (plan.hosts.includes('claude')) lines.push(`  ${c.yellow('!')} Restart Claude Code, then ask ${c.bold('BDFL status')}`);
  if (plan.hosts.includes('codex')) lines.push(`  ${c.yellow('!')} Restart Codex, review the one-time hook trust prompt, then ask ${c.bold('BDFL status')}`);
  lines.push(`  ${c.dim('Uninstall:')} node bin/install.js --uninstall`);
  return lines.join('\n');
}

function main(argv = process.argv.slice(2), output = process.stdout, error = process.stderr) {
  try {
    const options = parseArgs(argv);
    const installer = new Installer({ paths: installerPaths({ local: options.local, projectRoot: process.cwd() }) });
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

module.exports = { parseArgs, commandAvailable, detectHosts, installerPaths, sha256, verifyChecksum, mergeCommandHook, removeCommandHook, removeBdflStatusLine, isBdflPlugin, isBdflSkill, removeBdflMarketplaceEntry, mergeCodexMarketplace, Installer, LOGO, theme, operationLabel, formatPlan, formatCompletion, main };
