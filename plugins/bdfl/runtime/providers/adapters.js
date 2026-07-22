'use strict';

const path = require('node:path');
const { validateProfile } = require('../core/profiles');

const ROLE = "You are this workstream's read-only delegator. Use bdfl-plan whenever creating or revising an implementation plan. Define the smallest useful dependency graph; do not create work merely to fill worker capacity. All implementation must run through approved BDFL workers.";
const TERMINAL_ENV = { TERM: 'xterm-256color', COLORTERM: 'truecolor' };
const ATTENTION_EVENTS = ['agent-turn-complete', 'approval-requested', 'plan-mode-prompt'];
const CLAUDE_NOTIFICATION_EVENTS = ['permission_prompt', 'idle_prompt', 'elicitation_dialog', 'agent_needs_input'];

function codexSandbox(mode) { return mode === 'full-access' ? 'danger-full-access' : mode === 'workspace-write' ? 'workspace-write' : 'read-only'; }

function buildCodex(profile, options) {
  const common = [...(profile.argv || []), '-m', profile.model, '-c', `model_reasoning_effort="${profile.effort}"`, '--sandbox', codexSandbox(options.permissionMode || 'read-only'), '-c', `tui.notifications=${JSON.stringify(ATTENTION_EVENTS)}`, '-c', 'tui.notification_method="bel"', '-c', 'tui.notification_condition="always"'];
  if (options.resume) return { command: 'codex', args: [...common, 'resume', options.sessionId], env: TERMINAL_ENV };
  return { command: 'codex', args: common, env: TERMINAL_ENV };
}

function buildClaude(profile, options) {
  const common = [...(profile.argv || []), ...(profile.model === 'default' ? [] : ['--model', profile.model]), '--effort', profile.effort, '--permission-mode', options.permissionMode === 'full-access' ? 'bypassPermissions' : options.permissionMode === 'workspace-write' ? 'acceptEdits' : 'plan'];
  if (options.skillDirectory) common.push('--add-dir', options.skillDirectory);
  const attentionHook = { type: 'command', command: process.execPath, args: [path.resolve(options.attentionHelper || path.join(__dirname, 'attention-hook.js'))] };
  const settings = { hooks: { Stop: [{ hooks: [attentionHook] }], Notification: [{ matcher: CLAUDE_NOTIFICATION_EVENTS.join('|'), hooks: [attentionHook] }] } };
  common.push('--settings', JSON.stringify(settings));
  if (options.resume) common.push('--resume', options.sessionId);
  else if (options.sessionId) common.push('--session-id', options.sessionId);
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

module.exports = { ROLE, ATTENTION_EVENTS, CLAUDE_NOTIFICATION_EVENTS, codexSandbox, buildLaunch, skillDestination };
