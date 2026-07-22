'use strict';

const path = require('node:path');
const { validateProfile } = require('../core/profiles');

const ROLE = "You are this workstream's read-only delegator. Use bdfl-plan whenever creating or revising an implementation plan. Define the smallest useful dependency graph; do not create work merely to fill worker capacity. All implementation must run through approved BDFL workers.";
const TERMINAL_ENV = { TERM: 'xterm-256color', COLORTERM: 'truecolor' };
const ATTENTION_EVENTS = ['agent-turn-complete', 'approval-requested', 'plan-mode-prompt'];
const CLAUDE_NOTIFICATION_EVENTS = ['permission_prompt', 'idle_prompt', 'elicitation_dialog', 'agent_needs_input'];

function codexSandbox(mode) { return mode === 'workspace-write' ? 'workspace-write' : 'read-only'; }
function codexRuntime(provider) { return provider === 'codex' || provider === 'ollama'; }

function stripOwnedArgs(argv = [], provider) {
  const codex = codexRuntime(provider);
  const pairs = codex ? new Set(['-m', '--model']) : new Set(['--model', '--effort']);
  const switches = new Set();
  if (provider === 'ollama') { for (const flag of ['-p', '--profile', '--local-provider']) pairs.add(flag); for (const flag of ['--oss', '--yes']) switches.add(flag); }
  const controlledConfig = new Set(['model', 'model_reasoning_effort']); const result = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]; const pair = [...pairs].find((flag) => argument === flag || argument.startsWith(`${flag}=`));
    if (pair) { if (argument === pair) index += 1; continue; }
    if (switches.has(argument)) continue;
    if (codex && (argument === '-c' || argument === '--config') && index + 1 < argv.length) { const config = argv[index + 1]; const key = config.split('=', 1)[0]; if (controlledConfig.has(key) || provider === 'ollama' && (key === 'profile' || key === 'model_provider' || key === 'model_catalog_json' || key.startsWith('model_providers.'))) { index += 1; continue; } }
    result.push(argument);
  }
  return result;
}

function claudePermissionOverride(argv = []) {
  return argv.some((argument) => argument === '--permission-mode' || argument.startsWith('--permission-mode=') || argument === '--dangerously-skip-permissions');
}

function codexSandboxOverride(argv = []) {
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--dangerously-bypass-approvals-and-sandbox' || argument === '--yolo' || argument === '-s' || argument === '--sandbox' || argument.startsWith('-s=') || argument.startsWith('--sandbox=')) return true;
    if ((argument === '-c' || argument === '--config') && argv[index + 1]?.split('=', 1)[0] === 'sandbox_mode') return true;
    if ((argument.startsWith('-c=') || argument.startsWith('--config=')) && argument.slice(argument.indexOf('=') + 1).split('=', 1)[0] === 'sandbox_mode') return true;
  }
  return false;
}

function stripClaudePermissions(argv = []) {
  const result = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--permission-mode') { index += 1; continue; }
    if (argument.startsWith('--permission-mode=')) continue;
    result.push(argument);
  }
  return result;
}

function stripCodexSecurity(argv = []) {
  const result = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (['-s', '--sandbox', '-a', '--ask-for-approval'].includes(argument)) { index += 1; continue; }
    if (['-s=', '--sandbox=', '-a=', '--ask-for-approval='].some((prefix) => argument.startsWith(prefix))) continue;
    if (argument === '-c' || argument === '--config') { const key = argv[index + 1]?.split('=', 1)[0]; if (key === 'sandbox_mode' || key === 'approval_policy') { index += 1; continue; } }
    if (argument.startsWith('-c=') || argument.startsWith('--config=')) { const config = argument.slice(argument.indexOf('=') + 1); const key = config.split('=', 1)[0]; if (key === 'sandbox_mode' || key === 'approval_policy') continue; }
    result.push(argument);
  }
  return result;
}

function codexArgs(profile, options, { model = true, provider = 'codex' } = {}) {
  const custom = options.dangerous ? stripCodexSecurity(stripOwnedArgs(profile.argv, provider)) : stripOwnedArgs(profile.argv, provider);
  const permission = options.dangerous ? ['--dangerously-bypass-approvals-and-sandbox'] : !codexSandboxOverride(custom) ? ['--sandbox', codexSandbox(options.permissionMode || 'read-only')] : [];
  const common = [...custom, '--no-alt-screen', ...(model ? ['-m', profile.model] : []), '-c', `model_reasoning_effort="${profile.effort}"`, ...permission, '-c', `tui.notifications=${JSON.stringify(ATTENTION_EVENTS)}`, '-c', 'tui.notification_method="bel"', '-c', 'tui.notification_condition="always"'];
  if (options.bridge) {
    const tools = options.bridge.tools || ['bdfl_workers'];
    common.push('-c', `mcp_servers.bdfl.command=${JSON.stringify(options.bridge.command)}`, '-c', `mcp_servers.bdfl.args=${JSON.stringify(options.bridge.args)}`, '-c', 'mcp_servers.bdfl.required=true', '-c', `mcp_servers.bdfl.enabled_tools=${JSON.stringify(tools)}`, '-c', 'mcp_servers.bdfl.default_tools_approval_mode="approve"');
    if (options.instructions) common.push('-c', `developer_instructions=${JSON.stringify(options.instructions)}`);
  }
  if (options.resume) common.push('resume', options.sessionId);
  if (options.roleInstruction && !options.resume) common.push(options.roleInstruction);
  return common;
}

function buildCodex(profile, options) { return { command: 'codex', args: codexArgs(profile, options), env: TERMINAL_ENV }; }
function buildOllama(profile, options) { return { command: 'ollama', args: ['launch', 'codex', '--model', profile.model, '--yes', '--', ...codexArgs(profile, options, { model: false, provider: 'ollama' })], env: TERMINAL_ENV }; }

function buildClaude(profile, options) {
  const custom = options.dangerous ? stripClaudePermissions(stripOwnedArgs(profile.argv, 'claude')) : stripOwnedArgs(profile.argv, 'claude');
  const defaultPermission = options.role === 'delegator' || options.role === 'verifier' ? 'manual' : 'acceptEdits';
  const permission = options.dangerous ? ['--dangerously-skip-permissions'] : !claudePermissionOverride(custom) ? ['--permission-mode', defaultPermission] : [];
  const common = [...custom, ...(profile.model === 'default' ? [] : ['--model', profile.model]), '--effort', profile.effort, ...permission];
  if (options.skillDirectory) common.push('--add-dir', options.skillDirectory);
  if (options.pluginDirectory) common.push('--plugin-dir', options.pluginDirectory);
  if (options.mcpConfig) common.push('--mcp-config', options.mcpConfig, '--strict-mcp-config', '--allowedTools', ...(options.allowedTools || ['mcp__bdfl__bdfl_workers']));
  const attentionHook = { type: 'command', command: process.execPath, args: [path.resolve(options.attentionHelper || path.join(__dirname, 'attention-hook.js'))] };
  const settings = { hooks: { Stop: [{ hooks: [attentionHook] }], Notification: [{ matcher: CLAUDE_NOTIFICATION_EVENTS.join('|'), hooks: [attentionHook] }] } };
  common.push('--settings', JSON.stringify(settings));
  if (options.resume) common.push('--resume', options.sessionId);
  else if (options.sessionId) common.push('--session-id', options.sessionId);
  if (options.roleInstruction && !options.resume) common.push(options.roleInstruction);
  return { command: 'claude', args: common, env: TERMINAL_ENV };
}

function buildLaunch(profileValue, options = {}) {
  const profile = validateProfile(profileValue, { worker: options.role !== 'delegator' });
  if (options.resume && !options.sessionId) throw new Error('A provider session ID is required to resume');
  const invocation = profile.provider === 'codex' ? buildCodex(profile, options) : profile.provider === 'ollama' ? buildOllama(profile, options) : buildClaude(profile, options);
  return { ...invocation, cwd: options.cwd, roleInstruction: options.role === 'delegator' ? ROLE : options.roleInstruction || null };
}

function skillDestination(root, provider, sessionId) {
  const folder = codexRuntime(provider) ? '.agents/skills' : '.claude/skills';
  return path.join(root, '.bdfl', 'sessions', sessionId, 'planning', folder, 'bdfl-plan');
}

function pluginDestination(root, sessionId) { return path.join(root, '.bdfl', 'sessions', sessionId, 'plugin'); }

module.exports = { ROLE, ATTENTION_EVENTS, CLAUDE_NOTIFICATION_EVENTS, codexSandbox, codexRuntime, stripOwnedArgs, buildLaunch, skillDestination, pluginDestination };
