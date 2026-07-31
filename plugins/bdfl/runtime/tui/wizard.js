'use strict';

const { tokenizeCommand } = require('../core/profiles');
const { discoverProviderCatalogs } = require('../providers/models');

const PLANNING_STEPS = [
  'delegatorProvider',
  'delegatorModel',
  'delegatorEffort',
  'delegatorArgs',
  'workerProvider',
  'workerModel',
  'workerEffort',
  'workerArgs',
  'workerCapacity'
];
const DIRECT_STEPS = ['directProvider', 'directModel', 'directEffort', 'directArgs'];
const STEPS = ['sessionType', 'preset', ...PLANNING_STEPS, ...DIRECT_STEPS, 'confirmation'];
const COPY = {
  repository: [
    'Choose a repository',
    'Choose the repository for this session. A repository needs at least one Git commit to appear here.'
  ],
  sessionType: ['Choose how to work', 'Start a planning workflow or work directly with one editable agent.'],
  preset: ['Configure this session', 'Reuse the last setup for this session type or customize it.'],
  delegatorProvider: [
    'Choose your planning agent',
    'This is the main agent you talk with. It coordinates the work without implementing it.'
  ],
  delegatorModel: ['Choose the planning model', 'Choose a built-in model or enter a model ID manually.'],
  delegatorArgs: [
    'Planning agent options',
    'Optional CLI arguments, such as --search. Safe permission overrides are allowed; dangerous access requires bdfl --dangerous.'
  ],
  delegatorEffort: ['Planning effort', 'How much reasoning the planning agent should use.'],
  workerProvider: [
    'Choose the worker tool',
    'Workers connect through BDFL’s MCP workflow and implement approved chunks.'
  ],
  workerModel: ['Choose the worker model', 'Choose a built-in model or enter a model ID manually.'],
  workerEffort: ['Worker effort', 'How much reasoning each worker should use.'],
  workerArgs: [
    'Worker agent options',
    'Optional CLI arguments, such as --search. Safe permission overrides are allowed; dangerous access requires bdfl --dangerous.'
  ],
  workerCapacity: [
    'Parallel worker capacity',
    'Maximum active workers. Five is the default; dependencies still run in order.'
  ],
  directProvider: [
    'Choose your direct agent',
    'This is one editable agent working in the selected repository without BDFL planning or worker tools.'
  ],
  directModel: ['Choose the direct model', 'Choose a built-in model or enter a model ID manually.'],
  directEffort: ['Direct agent effort', 'How much reasoning the direct agent should use.'],
  directArgs: [
    'Direct agent options',
    'Optional CLI arguments, such as --search. The agent runs with workspace-write access.'
  ],
  confirmation: ['Review your session', 'This setup will be saved as “Last used” for this session type.']
};
const PLANNING_GROUPS = [
  { label: 'Planning agent', keys: ['delegatorProvider'] },
  { label: 'Planning model', keys: ['delegatorModel', 'delegatorEffort'] },
  { label: 'Planning agent options', keys: ['delegatorArgs'] },
  { label: 'Worker agent', keys: ['workerProvider'] },
  { label: 'Worker model', keys: ['workerModel', 'workerEffort'] },
  { label: 'Worker agent options', keys: ['workerArgs'] },
  { label: 'Max worker count', keys: ['workerCapacity'] }
];
const DIRECT_GROUPS = [
  { label: 'Direct agent', keys: ['directProvider'] },
  { label: 'Direct model', keys: ['directModel', 'directEffort'] },
  { label: 'Direct agent options', keys: ['directArgs'] }
];
const TEXT_STEPS = new Set(['delegatorArgs', 'workerArgs', 'workerCapacity', 'directArgs']);
const REASONING_EFFORTS = ['low', 'medium', 'high'];
const LABELS = {
  claude: 'Claude Code',
  codex: 'Codex',
  ollama: 'Ollama',
  default: 'Claude current default',
  medium: 'Medium',
  low: 'Low',
  high: 'High',
  planning: 'Planning agent',
  direct: 'Direct agent',
  'workspace-write': 'Accept edits'
};
const ESC = '\u001b[';
const COLOR = process.env.NO_COLOR
  ? {
      reset: '',
      bold: '',
      dim: '',
      accent: '',
      selected: '',
      input: '',
      done: '',
      white: '',
      black: '',
      bgYellow: '',
      bgCyan: '',
      error: ''
    }
  : {
      reset: `${ESC}0m`,
      bold: `${ESC}1m`,
      dim: `${ESC}38;5;245m`,
      accent: `${ESC}38;5;81m`,
      selected: `${ESC}38;5;220m`,
      input: `${ESC}38;5;213m`,
      done: `${ESC}38;5;114m`,
      white: `${ESC}38;5;255m`,
      black: `${ESC}38;5;16m`,
      bgYellow: `${ESC}48;5;220m`,
      bgCyan: `${ESC}48;5;81m`,
      error: `${ESC}38;5;203m`
    };

function display(value) {
  return LABELS[value] || `${value}`;
}
function profileSummary(profile) {
  return `${display(profile.provider)} · ${profile.model} · ${display(profile.effort)}${profile.argv?.length ? ` · ${profile.argv.join(' ')}` : ''}`;
}

class WorkstreamWizard {
  constructor({ catalogs, models, lastUsed = null, repositories = null, rememberedRepositoryRoot = null } = {}) {
    this.catalogs =
      catalogs ||
      (models
        ? Object.fromEntries(
            Object.entries(models).map(([provider, values]) => [
              provider,
              values.map((id) => ({ id, label: id, efforts: [...REASONING_EFFORTS], defaultEffort: 'medium' }))
            ])
          )
        : discoverProviderCatalogs());
    this.models = Object.fromEntries(
      Object.entries(this.catalogs).map(([provider, values]) => [provider, values.map((model) => model.id)])
    );
    this.repositories = repositories || [{ root: null, label: '.', lastUsed }];
    this.availableProfile = (profile) =>
      Array.isArray(this.models[profile?.provider]) &&
      typeof profile.model === 'string' &&
      Boolean(profile.model) &&
      typeof profile.effort === 'string' &&
      Boolean(profile.effort);
    this.values = { workerCapacity: 5 };
    this.presets = {};
    this.setPresets(lastUsed);
    this.steps = [];
    this.step = 0;
    this.selection = 0;
    this.selections = {};
    this.scrolls = {};
    this.input = '';
    this.message = '';
    this.history = [];
    this.lastHits = [];
    this.rebuildSteps();
    {
      const remembered = this.repositories.findIndex((item) => item.root === rememberedRepositoryRoot);
      this.selection = remembered >= 0 ? remembered : 0;
    }
  }
  setPresets(lastUsed) {
    this.presets = {};
    if (lastUsed && this.availableProfile(lastUsed.delegatorProfile) && this.availableProfile(lastUsed.workerProfile)) {
      this.presets.planning = structuredClone({
        version: 1,
        sessionType: 'planning',
        delegatorProfile: lastUsed.delegatorProfile,
        workerProfile: { ...lastUsed.workerProfile, permissionMode: 'workspace-write' },
        workerCapacity: lastUsed.workerCapacity
      });
    }
    const direct = lastUsed?.directProfile;
    if (direct && this.availableProfile(direct))
      this.presets.direct = {
        version: 1,
        sessionType: 'direct',
        directProfile: { ...structuredClone(direct), permissionMode: 'workspace-write' }
      };
  }
  rebuildSteps() {
    const type = this.values.sessionType;
    const setup =
      this.values.preset === 'Customize'
        ? type === 'direct'
          ? DIRECT_STEPS
          : type === 'planning'
            ? PLANNING_STEPS
            : []
        : [];
    this.steps = [
      'repository',
      'sessionType',
      ...(type ? ['preset'] : []),
      ...setup,
      ...(type && this.values.preset ? ['confirmation'] : [])
    ];
  }
  key() {
    return this.steps[this.step];
  }
  groups() {
    return this.values.sessionType === 'direct' ? DIRECT_GROUPS : PLANNING_GROUPS;
  }
  modelOptions(provider) {
    return this.models[provider] || [];
  }
  model(provider, id) {
    return (this.catalogs[provider] || []).find((model) => model.id === id);
  }
  prefix() {
    return this.key().startsWith('delegator') ? 'delegator' : this.key().startsWith('direct') ? 'direct' : 'worker';
  }
  manualModelOnly() {
    return this.key().endsWith('Model') && this.modelOptions(this.values[`${this.prefix()}Provider`]).length === 0;
  }
  optionLabel(option) {
    if (this.key().endsWith('Model') && option !== 'Type a model ID…') {
      const model = this.model(this.values[`${this.prefix()}Provider`], option);
      if (model?.label && model.label !== option) return `${model.label} · ${option}`;
    }
    return display(option);
  }
  options() {
    const key = this.key();
    if (key === 'repository') return this.repositories.map((item) => item.label);
    if (key === 'sessionType') return ['planning', 'direct'];
    if (key === 'preset') return this.presets[this.values.sessionType] ? ['Last used', 'Customize'] : ['Customize'];
    if (key.endsWith('Provider')) return Object.keys(this.catalogs);
    if (key.endsWith('Model'))
      return [...this.modelOptions(this.values[`${this.prefix()}Provider`]), 'Type a model ID…'];
    if (key.endsWith('Effort')) return [...REASONING_EFFORTS];
    if (key === 'confirmation') return ['Create session', 'Go back'];
    return [];
  }
  move(delta) {
    const length = this.options().length;
    if (length) {
      this.selection = (this.selection + delta + length) % length;
      this.selections[this.key()] = this.selection;
      const start = this.scrolls[this.key()] || 0;
      if (this.selection < start) this.scrolls[this.key()] = this.selection;
      else if (this.selection >= start + 5) this.scrolls[this.key()] = this.selection - 4;
    }
  }
  prepareInput() {
    const key = this.key();
    if (key === 'workerCapacity') this.input = `${this.values.workerCapacity || 5}`;
    else if (key.endsWith('Args')) this.input = (this.values[key] || []).join(' ');
    else this.input = `${this.values[key] || ''}`;
  }
  advance(answer) {
    if (answer !== undefined) this.history.push({ key: this.key(), title: COPY[this.key()][0], answer });
    this.selections[this.key()] = this.selection;
    this.step += 1;
    this.selection = this.selections[this.key()] || 0;
    this.input = '';
    this.message = '';
    if (TEXT_STEPS.has(this.key())) this.prepareInput();
    else if (this.manualModelOnly()) this.message = 'Type the model ID, then press Enter.';
  }
  back() {
    if (this.step <= 0) return;
    this.selections[this.key()] = this.selection;
    this.step -= 1;
    this.history.pop();
    this.selection = this.selections[this.key()] || 0;
    this.message = '';
    if (TEXT_STEPS.has(this.key())) this.prepareInput();
    else {
      const selected = this.options().indexOf(this.values[this.key()]);
      if (selected >= 0 && !this.manualModelOnly()) this.selection = selected;
      else if (this.key().endsWith('Model') && (this.values[this.key()] || this.manualModelOnly())) {
        this.input = this.values[this.key()] || '';
        this.message = 'Type the model ID, then press Enter.';
      }
    }
  }
  parseArgs(provider) {
    if (!this.input.trim()) return [];
    return tokenizeCommand(`${provider} ${this.input}`).argv;
  }
  applyPreset(preset) {
    if (preset.sessionType === 'direct')
      Object.assign(this.values, {
        directProvider: preset.directProfile.provider,
        directModel: preset.directProfile.model,
        directEffort: preset.directProfile.effort,
        directArgs: [...(preset.directProfile.argv || [])]
      });
    else
      Object.assign(this.values, {
        delegatorProvider: preset.delegatorProfile.provider,
        delegatorModel: preset.delegatorProfile.model,
        delegatorEffort: preset.delegatorProfile.effort,
        delegatorArgs: [...(preset.delegatorProfile.argv || [])],
        workerProvider: preset.workerProfile.provider,
        workerModel: preset.workerProfile.model,
        workerEffort: preset.workerProfile.effort,
        workerArgs: [...(preset.workerProfile.argv || [])],
        workerCapacity: preset.workerCapacity
      });
  }
  config() {
    const repository = this.values.repositoryRoot ? { repositoryRoot: this.values.repositoryRoot } : {};
    if (this.values.sessionType === 'direct')
      return {
        version: 1,
        sessionType: 'direct',
        ...repository,
        directProfile: {
          provider: this.values.directProvider,
          model: this.values.directModel,
          effort: this.values.directEffort,
          permissionMode: 'workspace-write',
          ...(this.values.directArgs?.length ? { argv: this.values.directArgs } : {})
        }
      };
    return {
      version: 1,
      sessionType: 'planning',
      ...repository,
      delegatorProfile: {
        provider: this.values.delegatorProvider,
        model: this.values.delegatorModel,
        effort: this.values.delegatorEffort,
        ...(this.values.delegatorArgs?.length ? { argv: this.values.delegatorArgs } : {})
      },
      workerProfile: {
        provider: this.values.workerProvider,
        model: this.values.workerModel,
        effort: this.values.workerEffort,
        permissionMode: 'workspace-write',
        ...(this.values.workerArgs?.length ? { argv: this.values.workerArgs } : {})
      },
      workerCapacity: this.values.workerCapacity
    };
  }
  choose() {
    const key = this.key();
    const value = this.options()[this.selection];
    if (key === 'repository') {
      const selected = this.repositories[this.selection];
      if (!selected) {
        this.message = 'No Git repository with at least one commit was found within two directory levels.';
        return null;
      }
      this.values.repositoryRoot = selected.root;
      this.values.repository = selected.label;
      this.setPresets(selected.lastUsed);
      this.rebuildSteps();
      this.advance(selected.label);
      return null;
    }
    if (key === 'sessionType') {
      if (this.values.sessionType !== value) this.values.preset = undefined;
      this.values.sessionType = value;
      this.rebuildSteps();
      this.advance(display(value));
      return null;
    }
    if (key === 'preset') {
      this.values.preset = value;
      if (value === 'Last used') this.applyPreset(this.presets[this.values.sessionType]);
      this.rebuildSteps();
      this.advance(value === 'Last used' ? 'Last used' : 'Customize');
      return null;
    }
    if (key === 'confirmation') {
      if (value === 'Go back') {
        this.back();
        return null;
      }
      return this.config();
    }
    if (key.endsWith('Model') && value === 'Type a model ID…') {
      this.input = '';
      this.message = 'Type the model ID, then press Enter.';
      return null;
    }
    if (value === undefined) {
      this.message = 'Install Claude Code, Codex, or Ollama before continuing.';
      return null;
    }
    this.values[key] = value;
    this.advance(display(value));
    return null;
  }
  submitText() {
    const key = this.key();
    try {
      if (key.endsWith('Model')) {
        if (!this.input.trim()) throw new Error('A model ID is required.');
        this.values[key] = this.input.trim();
      } else if (key === 'workerCapacity') {
        const capacity = Number(this.input);
        if (!Number.isInteger(capacity) || capacity < 1 || capacity > 5)
          throw new Error('Enter a whole number from 1 to 5.');
        this.values[key] = capacity;
      } else this.values[key] = this.parseArgs(this.values[`${this.prefix()}Provider`]);
      const answer = key.endsWith('Args')
        ? this.values[key].length
          ? this.values[key].join(' ')
          : 'No extra options'
        : this.values[key];
      this.advance(answer);
      return null;
    } catch (error) {
      this.message = error.message;
      return null;
    }
  }
  acceptsText() {
    return (
      TEXT_STEPS.has(this.key()) ||
      (this.key().endsWith('Model') && (this.manualModelOnly() || this.message.startsWith('Type the model')))
    );
  }
  handle(value) {
    if (value === '\u001b[D') {
      this.back();
      return null;
    }
    if (this.acceptsText()) {
      if (value === '\r') return this.submitText();
      if (value === '\u007f' || value === '\b') this.input = this.input.slice(0, -1);
      else if (
        !value.startsWith('\u001b') &&
        !/[\u0000-\u001f]/.test(value) &&
        (this.key() !== 'workerCapacity' || /^\d$/.test(value))
      )
        this.input += value;
      return null;
    }
    if (value === '\u001b[A') this.move(-1);
    else if (value === '\u001b[B') this.move(1);
    else if (value === '\r') return this.choose();
    return null;
  }
  summary(config = this.config()) {
    return config.sessionType === 'direct'
      ? [`Direct agent    ${profileSummary(config.directProfile)}`]
      : [
          `Planning agent  ${profileSummary(config.delegatorProfile)}`,
          `Worker agent    ${profileSummary(config.workerProfile)}`,
          `Max workers     ${config.workerCapacity}`
        ];
  }
  answer(key) {
    const completed = this.history.findLast((item) => item.key === key)?.answer;
    if (completed !== undefined) return completed;
    const value = this.values[key];
    if (Array.isArray(value)) return value.length ? value.join(' ') : 'No extra options';
    return value === undefined || value === '' ? 'Not set' : display(value);
  }
  groupCompleted(group) {
    return group.keys.every((groupKey) => this.steps.indexOf(groupKey) < this.step);
  }
  groupAnswer(group) {
    if (group.keys.length === 2) {
      const model = this.answer(group.keys[0]);
      const effort = this.answer(group.keys[1]);
      if (model === 'Not set') return model;
      return effort === 'Not set' ? model : `${model} · ${effort}`;
    }
    const value = this.answer(group.keys[0]);
    if (group.keys[0] === 'workerCapacity' && !this.groupCompleted(group)) return `${value} (default)`;
    return value;
  }
  visibleOptions() {
    const options = this.options();
    const start = Math.max(0, Math.min(this.scrolls[this.key()] || 0, Math.max(0, options.length - 5)));
    return options.slice(start, start + 5).map((option, offset) => ({ option, index: start + offset }));
  }
  render() {
    const key = this.key();
    const [, baseDescription] = COPY[key];
    let description = baseDescription;
    const provider = this.values[`${this.prefix()}Provider`];
    if (this.manualModelOnly()) description = `Enter the model ID you want ${display(provider)} to use.`;
    else if (key.endsWith('Model') && provider === 'ollama')
      description = 'Choose an installed Ollama model or enter a model ID manually.';
    else if (key.endsWith('Args') && provider === 'ollama')
      description =
        'Optional Codex CLI arguments passed through Ollama, such as --search or --sandbox. Dangerous access requires bdfl --dangerous.';
    const lines = [
      `${COLOR.selected}New session${COLOR.reset}`,
      `${COLOR.dim}Choose a planning workflow or one direct editable agent.${COLOR.reset}`,
      ''
    ];
    const optionLine = (option, index) =>
      index === this.selection
        ? `${COLOR.bgYellow}${COLOR.black}${COLOR.bold} › ${this.optionLabel(option)} ${COLOR.reset}`
        : `   ${COLOR.white}${COLOR.bold}${this.optionLabel(option)}${COLOR.reset}`;
    const activeDetails = () => {
      lines.push(`${COLOR.dim}  ${description}${COLOR.reset}`);
      if (key === 'sessionType')
        lines.push(
          ...this.visibleOptions().flatMap(({ option, index }) => [
            optionLine(option, index),
            `${COLOR.dim}     ${option === 'planning' ? 'Use a read-only planning agent and isolated managed workers.' : 'Use one workspace-write agent without BDFL delegation tools.'}${COLOR.reset}`
          ])
        );
      else if (key === 'preset')
        lines.push(
          ...this.visibleOptions().flatMap(({ option, index }) =>
            option === 'Last used'
              ? [
                  optionLine(option, index),
                  ...this.summary(this.presets[this.values.sessionType]).map(
                    (line) => `${COLOR.dim}     ${line}${COLOR.reset}`
                  )
                ]
              : [optionLine(option, index)]
          )
        );
      else if (
        TEXT_STEPS.has(key) ||
        (key.endsWith('Model') && (this.manualModelOnly() || this.message.startsWith('Type the model')))
      ) {
        const optional = key.endsWith('Args');
        lines.push(
          `${COLOR.input}${COLOR.bold} › ${this.input}${COLOR.bgCyan}${COLOR.black} ${COLOR.reset}`,
          `${COLOR.dim}${optional ? 'Enter skips or continues.' : 'Enter continues.'}${COLOR.reset}`
        );
      } else if (!this.options().length) {
        const empty =
          key === 'repository'
            ? 'No Git repository with at least one commit was found within two directory levels.'
            : 'No supported agent executable was found on PATH.';
        lines.push(`${COLOR.error}${COLOR.bold}! ${empty}${COLOR.reset}`);
      } else lines.push(...this.visibleOptions().map(({ option, index }) => optionLine(option, index)));
    };
    const question = (questionKey, label, answer = this.answer(questionKey)) => {
      const position = this.steps.indexOf(questionKey);
      const active = key === questionKey;
      const answered = position >= 0 && position < this.step;
      if (active)
        lines.push(
          `${COLOR.white}${COLOR.bold}○ ${label}${COLOR.reset}${answer === 'Not set' ? '' : `  ${COLOR.bold}${COLOR.white}${answer}${COLOR.reset}`}`
        );
      else if (answered)
        lines.push(`${COLOR.done}✓ ${label}${COLOR.reset}  ${COLOR.bold}${COLOR.white}${answer}${COLOR.reset}`);
      else lines.push(`${COLOR.dim}○ ${label}${answer === 'Not set' ? '' : `  ${answer}`}${COLOR.reset}`);
      if (active) activeDetails();
    };
    question('repository', 'Repository');
    question('sessionType', 'Session type');
    if (this.values.sessionType) {
      question('preset', 'Setup');
      if (this.values.preset === 'Last used' && key !== 'preset')
        lines.push(...this.summary(this.config()).map((line) => `${COLOR.dim}  ${line}${COLOR.reset}`));
    }
    if (this.values.preset === 'Customize')
      for (const group of this.groups()) {
        const active = group.keys.includes(key);
        const value = this.groupAnswer(group);
        const answered = this.groupCompleted(group);
        if (active)
          lines.push(
            `${COLOR.white}${COLOR.bold}○ ${group.label}${COLOR.reset}${value === 'Not set' ? '' : `  ${COLOR.bold}${COLOR.white}${value}${COLOR.reset}`}`
          );
        else if (answered)
          lines.push(`${COLOR.done}✓ ${group.label}${COLOR.reset}  ${COLOR.bold}${COLOR.white}${value}${COLOR.reset}`);
        else lines.push(`${COLOR.dim}○ ${group.label}${value === 'Not set' ? '' : `  ${value}`}${COLOR.reset}`);
        if (active) activeDetails();
      }
    if (key === 'confirmation') {
      lines.push(
        `${COLOR.white}${COLOR.bold}○ Create session${COLOR.reset}`,
        `${COLOR.dim}  ${description}${COLOR.reset}`,
        ...this.visibleOptions().map(({ option, index }) => optionLine(option, index))
      );
    }
    if (this.message && !this.message.startsWith('Type the model'))
      lines.push(`${COLOR.error}${COLOR.bold}! ${this.message}${COLOR.reset}`);
    this.lastHits = [];
    return lines.join('\n');
  }
}

module.exports = { COPY, STEPS, PLANNING_STEPS, DIRECT_STEPS, WorkstreamWizard, display, profileSummary };
