'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { loadSettings, saveSettings } = require('../core/settings');
const { validateModelSpec } = require('../core/model-spec');
const { StateStore, recoveryOptions } = require('../state/store');
const { TuiController } = require('../tui/controller');

const HELP = `Usage: bdfl [on|off|models|plans|agents]

on                Turn BDFL on; this is the default
off               Turn BDFL off after running agents are resolved
models [model]    Choose the exact model for future runs
plans             Open plan versions, diffs, and actions
agents            Open agents, attempts, logs, and actions

Keys: arrows navigate; Enter opens; Esc returns; x stop; r rewind;
f follow-up; a approve; i integrate; o open; ? help.`;

function executableAvailable(command, run = spawnSync) {
  const result = run(command, ['--version'], { encoding: 'utf8', stdio: 'pipe' });
  return !result.error && result.status === 0;
}

function defaultModel(settings, available = executableAvailable) {
  if (settings.defaultModel !== 'claude:sonnet:medium') return settings.defaultModel;
  if (available('claude')) return 'claude:sonnet:medium';
  if (available('codex') && settings.models.includes('codex:gpt-5.6-sol:medium')) return 'codex:gpt-5.6-sol:medium';
  return settings.defaultModel;
}

function activate(root, requestedModel, settings = loadSettings(), store = new StateStore(root), available = executableAvailable) {
  const model = requestedModel || defaultModel(settings, available);
  validateModelSpec(model, settings.models);
  const recovery = recoveryOptions(store.load());
  if (recovery.required) return { active: false, model, recovery };
  const state = store.update((value) => {
    value.runs.push({ id: `run-${Date.now()}`, title: path.basename(root), status: 'pending', model, createdAt: new Date().toISOString() });
    return value;
  });
  return { active: true, model, state };
}

function deactivate(store) {
  const state = store.load();
  const running = state.agents.filter((agent) => ['running', 'waiting'].includes(agent.status));
  if (running.length) return { active: true, blocked: true, agents: running };
  store.update((value) => {
    for (const run of value.runs) if (!['completed', 'cancelled', 'archived'].includes(run.status)) run.status = 'completed';
    return value;
  });
  return { active: false, blocked: false };
}

function selectModel(model, settings, persist = saveSettings) {
  validateModelSpec(model, settings.models);
  return persist({ ...settings, models: [...settings.models], defaultModel: model });
}

function snapshot(state, settings, options, initialTab = 'Runs') {
  const controller = new TuiController({
    runs: state.runs,
    plans: state.plans,
    tasks: state.tasks,
    agents: state.agents,
    inbox: state.inbox,
    models: settings.models.map((model) => ({ id: model, selected: model === settings.defaultModel }))
  }, { ...options, initialTab });
  return controller.render(0);
}

function formatModelList(settings) {
  return [
    'BDFL · models',
    `Current: ${settings.defaultModel}`,
    '',
    ...settings.models.map((model) => `${model === settings.defaultModel ? '●' : '○'} ${model}`),
    '',
    'Select: bdfl models <provider:model:effort>'
  ].join('\n');
}

function interactiveList(store, settings, io = process, initialTab = 'Runs', persist = saveSettings) {
  const controller = new TuiController({
    runs: store.load().runs,
    plans: store.load().plans,
    tasks: store.load().tasks,
    agents: store.load().agents,
    inbox: store.load().inbox,
    models: settings.models.map((model) => ({ id: model, selected: model === settings.defaultModel }))
  }, { color: true, width: io.stdout.columns || 80, height: io.stdout.rows || 24, initialTab, focused: true });
  let frame = 0;
  const draw = () => {
    io.stdout.write(`\u001b[2J\u001b[H${controller.render(frame)}\n`);
    frame = (frame + 1) % 6;
  };
  const onResize = () => { controller.resize(io.stdout.columns || 80, io.stdout.rows || 24); draw(); };
  const onData = (buffer) => {
    const input = `${buffer}`;
    if (input === '\u0003') return cleanup();
    const result = controller.key(input);
    if (result.action === 'quit') return cleanup();
    if (result.action === 'select' && result.item?.id) {
      selectModel(result.item.id, settings, persist);
      cleanup();
      io.stdout.write(`Selected model: ${result.item.id}\n`);
      return;
    }
    draw();
  };
  const cleanup = () => {
    io.stdin.off('data', onData);
    io.stdout.off('resize', onResize);
    if (io.stdin.setRawMode) io.stdin.setRawMode(false);
    io.stdin.pause();
  };
  if (io.stdin.setRawMode) io.stdin.setRawMode(true);
  io.stdin.resume();
  io.stdin.on('data', onData);
  io.stdout.on('resize', onResize);
  draw();
  return { controller, close: cleanup };
}

function main(argv = process.argv.slice(2), io = process, root = process.cwd()) {
  const command = argv[0];
  const settings = loadSettings();
  const store = new StateStore(root);
  if (command === 'help' || command === '--help' || command === '-h') { io.stdout.write(`${HELP}\n`); return 0; }
  if (['models', 'plans', 'agents'].includes(command)) {
    const tab = command[0].toUpperCase() + command.slice(1);
    if (command === 'models' && argv[1]) {
      try {
        const selected = selectModel(argv[1], settings);
        io.stdout.write(`Selected model: ${selected.defaultModel}\n`);
        return 0;
      } catch (error) {
        io.stderr.write(`${error.message}\n`);
        return 1;
      }
    }
    if (io.stdin.isTTY && io.stdout.isTTY) interactiveList(store, settings, io, tab);
    else if (command === 'models') io.stdout.write(`${formatModelList(settings)}\n`);
    else io.stdout.write(`${snapshot(store.load(), settings, { color: false, width: io.stdout.columns || 80, height: io.stdout.rows || 24, focused: true }, tab)}\n`);
    return 0;
  }
  if (command === 'off') {
    const result = deactivate(store);
    if (result.blocked) { io.stderr.write(`Resolve ${result.agents.length} running agent(s) before deactivation.\n`); return 2; }
    io.stdout.write('BDFL is off.\n'); return 0;
  }
  try {
    if (command && command !== 'on') throw new Error(`Unknown BDFL command: ${command}`);
    const result = activate(root, null, settings, store);
    const active = 'BDFL · active';
    io.stdout.write(`${io.stdout.isTTY ? `\u001b[38;5;220m${active}\u001b[0m` : active}\n`);
    if (!result.active) {
      io.stderr.write(`Unfinished BDFL state found. Choose: ${result.recovery.choices.join(', ')}.\n`);
      return 2;
    }
    io.stdout.write(`Active model: ${result.model}\n`);
    return 0;
  } catch (error) {
    io.stderr.write(`${error.message}\n`);
    return 1;
  }
}

module.exports = { HELP, executableAvailable, defaultModel, activate, deactivate, selectModel, snapshot, formatModelList, interactiveList, main };
