'use strict';

const path = require('node:path');
const { loadSettings } = require('../core/settings');
const { validateModelSpec } = require('../core/model-spec');
const { StateStore, recoveryOptions } = require('../state/store');
const { TuiController } = require('../tui/controller');
const { bannerFrame, verbForState } = require('../tui/banner');

const HELP = `Usage: bdfl [list|help|off|provider:model:effort]

/bdfl [model]  Activate BDFL with an optional listed model
/bdfl list     Open Runs, Plans, Tasks, Agents, Inbox, and Models
/bdfl help     Show commands, keys, permissions, and recovery
/bdfl off      Deactivate after running agents are resolved

Keys: arrows navigate; Enter opens; Esc returns; x stop; r rewind;
f follow-up; a approve; i integrate; o open; ? help.`;

function activate(root, requestedModel, settings = loadSettings(), store = new StateStore(root)) {
  const model = requestedModel || settings.defaultModel;
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

function snapshot(state, settings, options) {
  const controller = new TuiController({
    runs: state.runs,
    plans: state.plans,
    tasks: state.tasks,
    agents: state.agents,
    inbox: state.inbox,
    models: settings.models.map((model) => ({ id: model }))
  }, options);
  return controller.render(0);
}

function interactiveList(store, settings, io = process) {
  const controller = new TuiController({
    runs: store.load().runs,
    plans: store.load().plans,
    tasks: store.load().tasks,
    agents: store.load().agents,
    inbox: store.load().inbox,
    models: settings.models.map((model) => ({ id: model }))
  }, { color: true, width: io.stdout.columns || 80, height: io.stdout.rows || 24 });
  let frame = 0;
  const draw = () => {
    io.stdout.write(`\u001b[2J\u001b[H${controller.render(frame)}\n`);
    frame = (frame + 1) % 6;
  };
  const onResize = () => { controller.resize(io.stdout.columns || 80, io.stdout.rows || 24); draw(); };
  const onData = (buffer) => {
    const input = `${buffer}`;
    if (input === '\u0003') return cleanup();
    controller.key(input);
    draw();
  };
  const cleanup = () => {
    clearInterval(timer);
    io.stdin.off('data', onData);
    io.stdout.off('resize', onResize);
    if (io.stdin.setRawMode) io.stdin.setRawMode(false);
    io.stdin.pause();
  };
  if (io.stdin.setRawMode) io.stdin.setRawMode(true);
  io.stdin.resume();
  io.stdin.on('data', onData);
  io.stdout.on('resize', onResize);
  const timer = setInterval(draw, 500);
  draw();
  return { controller, close: cleanup };
}

function main(argv = process.argv.slice(2), io = process, root = process.cwd()) {
  const command = argv[0];
  const settings = loadSettings();
  const store = new StateStore(root);
  if (command === 'help' || command === '--help' || command === '-h') { io.stdout.write(`${HELP}\n`); return 0; }
  if (command === 'list') {
    if (io.stdin.isTTY && io.stdout.isTTY) interactiveList(store, settings, io);
    else io.stdout.write(`${snapshot(store.load(), settings, { color: false, width: io.stdout.columns || 80, height: io.stdout.rows || 24 })}\n`);
    return 0;
  }
  if (command === 'off') {
    const result = deactivate(store);
    if (result.blocked) { io.stderr.write(`Resolve ${result.agents.length} running agent(s) before deactivation.\n`); return 2; }
    io.stdout.write('BDFL is off.\n'); return 0;
  }
  try {
    const result = activate(root, command, settings, store);
    io.stdout.write(`${bannerFrame(0, Boolean(io.stdout.isTTY), verbForState(result.state))}\n`);
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

module.exports = { HELP, activate, deactivate, snapshot, interactiveList, main };
