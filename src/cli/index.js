'use strict';

const { loadSettings, saveSettings } = require('../core/settings');
const { validateModelSpec } = require('../core/model-spec');
const { PlanStore } = require('../core/plans');
const { StateStore, recoveryOptions } = require('../state/store');
const { TuiController } = require('../tui/controller');

const HELP = `Usage: bdfl [status|models|plans|tasks|agents|help]

status            Inspect unfinished work and recovery choices
models [model]    Choose the exact model for future runs
plans             Open plan versions, diffs, and actions
tasks             Open tasks, attempts, and actions
agents            Open agents, attempts, logs, and actions

Keys: arrows navigate; Enter opens; Esc returns; x stop; r rewind;
f follow-up; a approve; i integrate; o open; ? help.`;

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
    'All models use medium effort.',
    'Select: bdfl models <provider:model>'
  ].join('\n');
}

function loadPlanRows(plans) {
  return plans.list().map((plan) => ({
    ...plan,
    versions: plan.versions.map((version) => ({ ...version, content: plans.content(plan.id, version.number) }))
  })).sort((left, right) => `${right.updatedAt || right.createdAt || ''}`.localeCompare(`${left.updatedAt || left.createdAt || ''}`));
}

function migratePlans(store, plans) {
  if (!store.exists?.()) return;
  const state = store.load();
  const migrated = plans.migrateStatePlans(state);
  if (migrated.migrated || state.plans?.length) store.save(migrated.state);
}

function interactiveList(store, settings, io = process, initialTab = 'Runs', persist = saveSettings, plans = null) {
  const state = store.load();
  const controller = new TuiController({
    runs: state.runs,
    plans: plans ? loadPlanRows(plans) : state.plans,
    tasks: state.tasks,
    agents: state.agents,
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
    if (result.action === 'approve' && initialTab === 'Plans' && result.item?.id) {
      if (!plans) throw new Error('Filesystem-backed plans are unavailable');
      plans.select(result.item.id, result.version);
      cleanup();
      io.stdout.write(`Approved plan: ${result.item.id} v${result.version}\n`);
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
  const plans = new PlanStore(root);
  migratePlans(store, plans);
  if (command === 'help' || command === '--help' || command === '-h') { io.stdout.write(`${HELP}\n`); return 0; }
  if (['models', 'plans', 'tasks', 'agents'].includes(command)) {
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
    if (io.stdin.isTTY && io.stdout.isTTY) interactiveList(store, settings, io, tab, saveSettings, plans);
    else if (command === 'models') io.stdout.write(`${formatModelList(settings)}\n`);
    else {
      const state = store.load();
      if (command === 'plans') state.plans = loadPlanRows(plans);
      io.stdout.write(`${snapshot(state, settings, { color: false, width: io.stdout.columns || 80, height: io.stdout.rows || 24, focused: true }, tab)}\n`);
    }
    return 0;
  }
  if (command === 'status') {
    const recovery = recoveryOptions(store.load());
    if (recovery.required) {
      io.stdout.write(`Unfinished BDFL work. Choose in the host: Continue, Manage tasks, Archive run, or Cancel run.\n`);
      return 2;
    }
    io.stdout.write('No unfinished BDFL run.\n');
    return 0;
  }
  io.stderr.write(`${command ? `Unknown BDFL command: ${command}. ` : ''}${HELP}\n`);
  return 1;
}

module.exports = { HELP, selectModel, snapshot, formatModelList, loadPlanRows, migratePlans, interactiveList, main };
