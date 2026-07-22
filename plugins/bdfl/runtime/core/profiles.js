'use strict';

const PROVIDERS = new Set(['claude', 'codex']);
const PERMISSIONS = new Set(['read-only', 'workspace-write', 'full-access']);

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
  if (!PROVIDERS.has(argv[0])) throw new Error('Custom commands must begin with claude or codex');
  if (argv.slice(1).some((argument) => argument.includes('=') && !argument.startsWith('-'))) throw new Error('Environment prefixes are not allowed');
  const forbidden = new Set(['exec', '--print', '-p', '--output-format', '--resume', 'resume', '--model', '-m', '--effort', '--sandbox', '--permission-mode', '--mcp-config', '--add-dir', '--settings']);
  if (argv.slice(1).some((argument) => forbidden.has(argument) || argument.startsWith('--settings='))) throw new Error('BDFL owns headless, resume, model, effort, permission, MCP, settings, and role flags');
  return { provider: argv[0], argv: argv.slice(1) };
}

function validateProfile(profile, { worker = false } = {}) {
  if (!profile || !PROVIDERS.has(profile.provider) || typeof profile.model !== 'string' || !profile.model || typeof profile.effort !== 'string' || !profile.effort) throw new Error('Invalid provider profile');
  if (worker && !PERMISSIONS.has(profile.permissionMode)) throw new Error('Invalid worker permission mode');
  const result = { provider: profile.provider, model: profile.model, effort: profile.effort };
  if (worker) result.permissionMode = profile.permissionMode;
  if (profile.argv) {
    if (!Array.isArray(profile.argv) || profile.argv.some((value) => typeof value !== 'string')) throw new Error('Profile argv must be an array');
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
