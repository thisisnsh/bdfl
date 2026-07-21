'use strict';

const { spawn, spawnSync } = require('node:child_process');
const { parseModelSpec } = require('../core/model-spec');
const { mapPermissionMode } = require('../core/permissions');

const EXECUTABLES = Object.freeze({ claude: 'claude', codex: 'codex', ollama: 'ollama' });

function codexSandbox(permissionMode) {
  if (permissionMode === 'read-only') return 'read-only';
  if (permissionMode === 'full-access') return 'danger-full-access';
  return 'workspace-write';
}

function buildInvocation(specification, options) {
  const { provider, model, effort } = parseModelSpec(specification);
  const permissionMode = mapPermissionMode(options.host, options.permissionMode);
  const prompt = options.prompt;
  if (!prompt) throw new Error('Provider prompt is required');

  if (provider === 'codex') {
    return {
      command: 'codex',
      args: ['exec', '--json', '-m', model, '-c', `model_reasoning_effort="${effort}"`, '--sandbox', codexSandbox(permissionMode), prompt],
      env: {}
    };
  }
  if (provider === 'claude') {
    return {
      command: 'claude',
      args: ['--print', '--output-format', 'stream-json', '--verbose', '--model', model, '--effort', effort, '--permission-mode', permissionMode, prompt],
      env: {}
    };
  }
  if (options.host === 'codex') {
    return {
      command: 'codex',
      args: ['exec', '--json', '--oss', '--local-provider', 'ollama', '-m', model, '-c', `model_reasoning_effort="${effort}"`, '--sandbox', codexSandbox(permissionMode), prompt],
      env: { OLLAMA_HOST: options.ollamaBaseUrl }
    };
  }
  return {
    command: 'claude',
    args: ['--print', '--output-format', 'stream-json', '--verbose', '--model', model, '--effort', effort, '--permission-mode', permissionMode, prompt],
    env: { ANTHROPIC_BASE_URL: options.ollamaBaseUrl, BDFL_OLLAMA_MODEL: model }
  };
}

function preflight(specification, options, run = spawnSync) {
  const parsed = parseModelSpec(specification);
  const invocation = buildInvocation(specification, { ...options, prompt: 'BDFL preflight' });
  const executable = run(invocation.command, ['--version'], { encoding: 'utf8' });
  if (executable.error || executable.status !== 0) return { ok: false, code: 'executable', message: `${invocation.command} is unavailable` };
  if (parsed.provider === 'codex') {
    const authentication = run('codex', ['login', 'status'], { encoding: 'utf8' });
    if (authentication.error || authentication.status !== 0) return { ok: false, code: 'authentication', message: 'Codex authentication is unavailable' };
  }
  if (parsed.provider === 'claude') {
    const authentication = run('claude', ['auth', 'status'], { encoding: 'utf8' });
    if (authentication.error || authentication.status !== 0) return { ok: false, code: 'authentication', message: 'Claude authentication is unavailable' };
  }
  if (parsed.provider === 'ollama') {
    const ollama = run(EXECUTABLES.ollama, ['list'], { encoding: 'utf8', env: { ...process.env, OLLAMA_HOST: options.ollamaBaseUrl } });
    if (ollama.error || ollama.status !== 0) return { ok: false, code: 'ollama-endpoint', message: `Ollama is unavailable at ${options.ollamaBaseUrl}` };
    const rows = `${ollama.stdout || ''}`.split(/\s+/);
    if (!rows.some((row) => row === parsed.model || row.startsWith(`${parsed.model}:`))) {
      return { ok: false, code: 'model', message: `Ollama model is unavailable: ${parsed.model}` };
    }
  }
  return { ok: true, invocation };
}

function normalizeEvent(provider, raw) {
  const event = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!event || typeof event !== 'object') throw new Error('Provider event must be an object');
  const type = event.type || event.event || 'message';
  if (type === 'thread.started') return { type: 'session', sessionId: event.thread_id, raw: event };
  if (type === 'system' && event.session_id) return { type: 'session', sessionId: event.session_id, raw: event };
  if (/permission|approval/.test(type)) return { type: 'permission', request: event, raw: event };
  if (/question|elicitation/.test(type)) return {
    type: 'question',
    question: event.options || event.choices ? event : event.question || event.message,
    raw: event
  };
  if (/failed|error/.test(type)) return { type: 'error', message: event.message || event.error || type, raw: event };
  if (/completed|result/.test(type)) return { type: 'completion', result: event.result || event.item || event, raw: event };
  return { type: 'progress', provider, eventType: type, raw: event };
}

function runProvider(specification, options) {
  const invocation = buildInvocation(specification, options);
  const child = spawn(invocation.command, invocation.args, {
    cwd: options.cwd,
    env: { ...process.env, ...invocation.env },
    signal: options.signal,
    stdio: ['pipe', 'pipe', 'pipe']
  });
  return child;
}

function buildResumeInvocation(specification, options) {
  const { provider, model, effort } = parseModelSpec(specification);
  if (!options.sessionId) throw new Error('A provider session ID is required to resume an agent');
  if (!options.prompt) throw new Error('A resume prompt is required');
  const permissionMode = mapPermissionMode(options.host, options.permissionMode);
  if (provider === 'codex') return {
    command: 'codex',
    args: ['exec', 'resume', '--json', '-m', model, '-c', `model_reasoning_effort="${effort}"`, options.sessionId, options.prompt],
    env: {}
  };
  if (provider === 'claude') return {
    command: 'claude',
    args: ['--resume', options.sessionId, '--print', '--output-format', 'stream-json', '--verbose', '--model', model, '--effort', effort, '--permission-mode', permissionMode, options.prompt],
    env: {}
  };
  return buildInvocation(specification, options);
}

function resumeProvider(specification, options) {
  const invocation = buildResumeInvocation(specification, options);
  return spawn(invocation.command, invocation.args, { cwd: options.cwd, env: { ...process.env, ...invocation.env }, signal: options.signal, stdio: ['ignore', 'pipe', 'pipe'] });
}

module.exports = { EXECUTABLES, buildInvocation, buildResumeInvocation, preflight, normalizeEvent, runProvider, resumeProvider };
