'use strict';

const path = require('node:path');
const { validateProfile } = require('../core/profiles');

const ROLE = "You are this workstream's read-only delegator. Use bdfl-plan whenever creating or revising an implementation plan. Define the smallest useful dependency graph; do not create work merely to fill worker capacity. All implementation must run through approved BDFL workers.";
const TERMINAL_ENV = { TERM: 'xterm-256color', COLORTERM: 'truecolor' };
const ATTENTION_EVENTS = ['agent-turn-complete', 'approval-requested', 'plan-mode-prompt'];
const CLAUDE_NOTIFICATION_EVENTS = ['permission_prompt', 'idle_prompt', 'elicitation_dialog', 'agent_needs_input'];

function codexSandbox(mode) { return mode === 'full-access' ? 'danger-full-access' : mode === 'workspace-write' ? 'workspace-write' : 'read-only'; }

function buildCodex(profile, options) {
  const common = [...(profile.argv || []), '--no-alt-screen', '-m', profile.model, '-c', `model_reasoning_effort="${profile.effort}"`, '--sandbox', codexSandbox(options.permissionMode || 'read-only'), '-c', `tui.notifications=${JSON.stringify(ATTENTION_EVENTS)}`, '-c', 'tui.notification_method="bel"', '-c', 'tui.notification_condition="always"'];
  if (options.bridge) {
    const tools = options.bridge.tools || ['bdfl_workers'];
    common.push('-c', `mcp_servers.bdfl.command=${JSON.stringify(options.bridge.command)}`, '-c', `mcp_servers.bdfl.args=${JSON.stringify(options.bridge.args)}`, '-c', 'mcp_servers.bdfl.required=true', '-c', `mcp_servers.bdfl.enabled_tools=${JSON.stringify(tools)}`, '-c', 'mcp_servers.bdfl.default_tools_approval_mode="approve"');
    if (options.instructions) common.push('-c', `developer_instructions=${JSON.stringify(options.instructions)}`);
  }
  if (options.resume) common.push('resume', options.sessionId);
  if (options.roleInstruction) common.push(options.roleInstruction);
  return { command: 'codex', args: common, env: TERMINAL_ENV };
}

function buildClaude(profile, options) {
  const common = [...(profile.argv || []), ...(profile.model === 'default' ? [] : ['--model', profile.model]), '--effort', profile.effort, '--permission-mode', options.permissionMode === 'full-access' ? 'bypassPermissions' : options.permissionMode === 'workspace-write' ? 'acceptEdits' : 'plan'];
  if (options.skillDirectory) common.push('--add-dir', options.skillDirectory);
  if (options.pluginDirectory) common.push('--plugin-dir', options.pluginDirectory);
  if (options.mcpConfig) common.push('--mcp-config', options.mcpConfig, '--strict-mcp-config', '--allowedTools', ...(options.allowedTools || ['mcp__bdfl__bdfl_workers']));
  const attentionHook = { type: 'command', command: process.execPath, args: [path.resolve(options.attentionHelper || path.join(__dirname, 'attention-hook.js'))] };
  const settings = { hooks: { Stop: [{ hooks: [attentionHook] }], Notification: [{ matcher: CLAUDE_NOTIFICATION_EVENTS.join('|'), hooks: [attentionHook] }] } };
  common.push('--settings', JSON.stringify(settings));
  if (options.resume) common.push('--resume', options.sessionId);
  else if (options.sessionId) common.push('--session-id', options.sessionId);
  if (options.roleInstruction) common.push(options.roleInstruction);
  return { command: 'claude', args: common, env: TERMINAL_ENV };
}

function buildLaunch(profileValue, options = {}) {
  const profile = validateProfile(profileValue, { worker: options.role !== 'delegator' });
  if (options.resume && !options.sessionId) throw new Error('A provider session ID is required to resume');
  const invocation = profile.provider === 'codex' ? buildCodex(profile, options) : buildClaude(profile, options);
  return { ...invocation, cwd: options.cwd, roleInstruction: options.role === 'delegator' ? ROLE : options.roleInstruction || null };
}

function skillDestination(root, provider, sessionId) {
  const folder = provider === 'codex' ? '.agents/skills' : '.claude/skills';
  return path.join(root, '.bdfl', 'sessions', sessionId, 'planning', folder, 'bdfl-plan');
}

function pluginDestination(root, sessionId) { return path.join(root, '.bdfl', 'sessions', sessionId, 'plugin'); }

module.exports = { ROLE, ATTENTION_EVENTS, CLAUDE_NOTIFICATION_EVENTS, codexSandbox, buildLaunch, skillDestination, pluginDestination };
