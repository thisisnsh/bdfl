'use strict';

const path = require('node:path');
const { validateProfile } = require('../core/profiles');

const ROLE = "You are this workstream's read-only delegator. Use bdfl-plan whenever creating or revising an implementation plan. Define the smallest useful dependency graph; do not create work merely to fill worker capacity. All implementation must run through approved BDFL workers.";

function codexSandbox(mode) { return mode === 'full-access' ? 'danger-full-access' : mode === 'workspace-write' ? 'workspace-write' : 'read-only'; }

function buildCodex(profile, options) {
  const common = [...(profile.argv || []), '-m', profile.model, '-c', `model_reasoning_effort="${profile.effort}"`, '--sandbox', codexSandbox(options.permissionMode || 'read-only')];
  if (options.resume) return { command: 'codex', args: [...common, 'resume', options.sessionId], env: {} };
  return { command: 'codex', args: common, env: {} };
}

function buildClaude(profile, options) {
  const common = [...(profile.argv || []), '--model', profile.model, '--effort', profile.effort, '--permission-mode', options.permissionMode === 'full-access' ? 'bypassPermissions' : options.permissionMode === 'workspace-write' ? 'acceptEdits' : 'plan'];
  if (options.skillDirectory) common.push('--add-dir', options.skillDirectory);
  if (options.resume) common.push('--resume', options.sessionId);
  return { command: 'claude', args: common, env: {} };
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

module.exports = { ROLE, codexSandbox, buildLaunch, skillDestination };
