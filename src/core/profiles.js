'use strict';

const PROVIDERS = new Set(['claude', 'codex', 'ollama']);
const PERMISSIONS = new Set(['workspace-write']);

function optionValue(argv, index, flags) {
  const argument = argv[index];
  for (const flag of flags) {
    if (argument === flag) return argv[index + 1];
    if (argument.startsWith(`${flag}=`)) return argument.slice(flag.length + 1);
  }
  return null;
}

function unquote(value) { return `${value || ''}`.replace(/^(?:"(.*)"|'(.*)')$/u, (_match, double, single) => double ?? single); }

function hasDangerousProviderArgs(provider, argv = []) {
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument.startsWith('--dangerously-') || argument === '--yolo' || argument === '--allow-dangerously-skip-permissions') return true;
    if (provider === 'claude' && unquote(optionValue(argv, index, ['--permission-mode'])) === 'bypassPermissions') return true;
    if (provider !== 'claude' && unquote(optionValue(argv, index, ['-s', '--sandbox'])) === 'danger-full-access') return true;
    const config = optionValue(argv, index, ['-c', '--config']); const separator = config?.indexOf('=') ?? -1;
    if (provider !== 'claude' && separator > 0 && config.slice(0, separator) === 'sandbox_mode' && unquote(config.slice(separator + 1)) === 'danger-full-access') return true;
  }
  return false;
}

function tokenizeCommand(command) {
  if (typeof command !== 'string' || !command.trim()) throw new Error('Custom command is required');
  if (/[|;&<>`\n\r]/.test(command) || /\$\(|\$\{/.test(command)) throw new Error('Shell syntax is not allowed in a provider profile');
  const argv = []; let token = ''; let quote = null;
  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];
    if (quote) {
      if (character === quote) quote = null;
      else if (character === '\\' && quote === '"' && index + 1 < command.length) token += command[++index];
      else token += character;
    } else if (character === '"' || character === "'") quote = character;
    else if (/\s/.test(character)) { if (token) { argv.push(token); token = ''; } }
    else if (character === '\\' && index + 1 < command.length) token += command[++index];
    else token += character;
  }
  if (quote) throw new Error('Unterminated quote in custom command');
  if (token) argv.push(token);
  if (!PROVIDERS.has(argv[0])) throw new Error('Custom commands must begin with claude, codex, or ollama');
  if (argv.slice(1).some((argument) => argument.includes('=') && !argument.startsWith('-'))) throw new Error('Environment prefixes are not allowed');
  const forbidden = new Set(['exec', '--print', '-p', '--output-format', '--resume', 'resume', '--mcp-config', '--add-dir', '--settings']);
  if (argv.slice(1).some((argument) => forbidden.has(argument) || argument.startsWith('--settings='))) throw new Error('BDFL owns headless, resume, MCP, settings, and role flags');
  if (hasDangerousProviderArgs(argv[0], argv.slice(1))) throw new Error('Dangerous provider permissions require bdfl --dangerous');
  return { provider: argv[0], argv: argv.slice(1) };
}

function validateProfile(profile, { worker = false } = {}) {
  if (!profile || !PROVIDERS.has(profile.provider) || typeof profile.model !== 'string' || !profile.model || typeof profile.effort !== 'string' || !profile.effort) throw new Error('Invalid provider profile');
  if (worker && !PERMISSIONS.has(profile.permissionMode)) throw new Error('Invalid worker permission mode');
  const result = { provider: profile.provider, model: profile.model, effort: profile.effort };
  if (worker) result.permissionMode = profile.permissionMode;
  if (profile.argv) {
    if (!Array.isArray(profile.argv) || profile.argv.some((value) => typeof value !== 'string')) throw new Error('Profile argv must be an array');
    if (hasDangerousProviderArgs(profile.provider, profile.argv)) throw new Error('Dangerous provider permissions require bdfl --dangerous');
    result.argv = [...profile.argv];
  }
  return result;
}

function validateWorkstreamConfig(value) {
  if (!value || value.version !== 1) throw new Error('Workstream config version must be 1');
  if (!Number.isInteger(value.workerCapacity) || value.workerCapacity < 1 || value.workerCapacity > 5) throw new Error('Worker capacity must be an integer from 1 to 5');
  return { version: 1, delegatorProfile: validateProfile(value.delegatorProfile), workerProfile: validateProfile(value.workerProfile, { worker: true }), workerCapacity: value.workerCapacity };
}

module.exports = { PROVIDERS, PERMISSIONS, tokenizeCommand, validateProfile, validateWorkstreamConfig };
