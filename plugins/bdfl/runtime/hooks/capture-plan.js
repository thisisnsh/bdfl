'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { PlanStore, atomicWrite, derivePlanTitle } = require('../core/plans');
const { hostIsLive } = require('../host/presence');

function gitRoot(cwd, run = execFileSync) {
  if (!cwd || !path.isAbsolute(cwd)) return null;
  try { return `${run('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })}`.trim(); }
  catch { return null; }
}

function newestProposedPlan(transcript, io = fs) {
  if (!transcript || !io.existsSync(transcript)) return null;
  const text = io.readFileSync(transcript, 'utf8');
  const matches = [...text.matchAll(/<proposed_plan>([\s\S]*?)<\/proposed_plan>/g)];
  return matches.at(-1)?.[1]?.trim() || null;
}

function stateFile(root) { return path.join(root, '.bdfl', 'plans', 'hook-state.json'); }
function readHookState(root, io = fs) {
  const file = stateFile(root);
  return io.existsSync(file) ? JSON.parse(io.readFileSync(file, 'utf8')) : { version: 1, sessions: {} };
}

function writeHookState(root, state, io = fs) { atomicWrite(stateFile(root), `${JSON.stringify(state, null, 2)}\n`, io); }

function activeRepository(payload, run = execFileSync, io = fs) {
  const root = gitRoot(payload.cwd, run);
  return root || null;
}

function captureClaude(payload, root, store, io = fs) {
  const session = payload.session_id;
  const event = payload.hook_event_name;
  if (!session || payload.tool_name !== 'ExitPlanMode') return null;
  const state = readHookState(root, io);
  const key = `claude:${session}`;
  const current = state.sessions[key] || { episode: 0, active: false, sourcePath: null };
  if (event === 'PostToolUse') {
    current.active = false;
    state.sessions[key] = current;
    writeHookState(root, state, io);
    return null;
  }
  if (event !== 'PreToolUse') return null;
  const content = payload.tool_input?.plan;
  const sourcePath = payload.tool_input?.planFilePath || null;
  if (!content) return null;
  if (!current.active || current.sourcePath && sourcePath && current.sourcePath !== sourcePath) current.episode += 1;
  current.active = true;
  current.sourcePath = sourcePath;
  state.sessions[key] = current;
  writeHookState(root, state, io);
  return store.capture({ content, host: 'claude', session, episode: `${current.episode}`, sourcePath });
}

function captureCodex(payload, root, store, io = fs) {
  if (payload.hook_event_name !== 'Stop' || !payload.session_id) return null;
  const state = readHookState(root, io);
  const key = `codex:${payload.session_id}`;
  const current = state.sessions[key] || { episode: 0, active: false };
  const inPlanMode = payload.permission_mode === 'plan' || payload.mode === 'plan';
  if (!inPlanMode) {
    current.active = false;
    state.sessions[key] = current;
    writeHookState(root, state, io);
    return null;
  }
  const content = newestProposedPlan(payload.transcript_path, io);
  if (!content) return null;
  const title = derivePlanTitle(content, root);
  if (!current.active || current.title && current.title !== title) current.episode += 1;
  current.active = true;
  current.title = title;
  state.sessions[key] = current;
  writeHookState(root, state, io);
  return store.capture({ content, host: 'codex', session: payload.session_id, episode: `${current.episode}`, sourcePath: payload.transcript_path || null });
}

function handleHook(host, payload, options = {}) {
  const io = options.io || fs;
  const live = options.hostIsLive || hostIsLive;
  if (!live(host, options.registryFile, { io })) return null;
  const root = activeRepository(payload, options.run || execFileSync, io);
  if (!root) return null;
  const store = options.store || new PlanStore(root, { io });
  return host === 'claude' ? captureClaude(payload, root, store, io) : captureCodex(payload, root, store, io);
}

module.exports = { gitRoot, newestProposedPlan, readHookState, activeRepository, captureClaude, captureCodex, handleHook };
