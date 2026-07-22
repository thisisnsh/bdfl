'use strict';

const { tokenizeCommand } = require('../core/profiles'); const { discoverProviderCatalogs } = require('../providers/models');

const STEPS = ['preset', 'delegatorProvider', 'delegatorModel', 'delegatorEffort', 'delegatorArgs', 'workerProvider', 'workerModel', 'workerEffort', 'workerArgs', 'workerCapacity', 'confirmation'];
const COPY = {
  preset: ['Create a new session', 'Reuse your previous setup or customize a fresh session.'],
  delegatorProvider: ['Choose your planning agent', 'This is the main agent you talk with. It stays read-only and coordinates the work.'],
  delegatorModel: ['Choose the planning model', 'Choose a built-in model or enter a model ID manually.'],
  delegatorArgs: ['Planning agent options', 'Optional CLI arguments, such as --search. BDFL adds model, permissions, and session flags.'],
  delegatorEffort: ['Planning effort', 'How much reasoning the planning agent should use.'],
  workerProvider: ['Choose the worker tool', 'Workers connect through BDFL’s MCP workflow and implement approved chunks.'],
  workerModel: ['Choose the worker model', 'Choose a built-in model or enter a model ID manually.'],
  workerEffort: ['Worker effort', 'How much reasoning each worker should use.'],
  workerArgs: ['Worker agent options', 'Optional CLI arguments, such as --search. BDFL adds model, permissions, and session flags.'],
  workerCapacity: ['Parallel worker capacity', 'Maximum active workers. Five is the default; dependencies still run in order.'],
  confirmation: ['Review your session', 'This setup will be saved as “Last used” for your next session.']
};
const SETUP_GROUPS = [
  { label: 'Delegator agent', keys: ['delegatorProvider'] },
  { label: 'Delegator model', keys: ['delegatorModel', 'delegatorEffort'] },
  { label: 'Delegator agent options', keys: ['delegatorArgs'] },
  { label: 'Worker agent', keys: ['workerProvider'] },
  { label: 'Worker model', keys: ['workerModel', 'workerEffort'] },
  { label: 'Worker agent options', keys: ['workerArgs'] },
  { label: 'Max worker count', keys: ['workerCapacity'] }
];
const TEXT_STEPS = new Set(['delegatorArgs', 'workerArgs', 'workerCapacity']);
const REASONING_EFFORTS = ['low', 'medium', 'high'];
const LABELS = { claude: 'Claude Code', codex: 'Codex', ollama: 'Ollama', default: 'Claude current default', medium: 'Medium', low: 'Low', high: 'High', 'workspace-write': 'Accept edits', 'read-only': 'Read only', 'full-access': 'Full access' };
const ESC = '\u001b['; const COLOR = process.env.NO_COLOR ? { reset: '', bold: '', dim: '', accent: '', selected: '', input: '', done: '', white: '', black: '', bgYellow: '', bgCyan: '', error: '' } : { reset: `${ESC}0m`, bold: `${ESC}1m`, dim: `${ESC}38;5;245m`, accent: `${ESC}38;5;81m`, selected: `${ESC}38;5;220m`, input: `${ESC}38;5;213m`, done: `${ESC}38;5;114m`, white: `${ESC}38;5;255m`, black: `${ESC}38;5;16m`, bgYellow: `${ESC}48;5;220m`, bgCyan: `${ESC}48;5;81m`, error: `${ESC}38;5;203m` };

function display(value) { return LABELS[value] || `${value}`; }
function profileSummary(profile) { return `${display(profile.provider)} · ${profile.model} · ${display(profile.effort)}${profile.argv?.length ? ` · ${profile.argv.join(' ')}` : ''}`; }

class WorkstreamWizard {
  constructor({ catalogs, models, lastUsed = null } = {}) { this.catalogs = catalogs || (models ? Object.fromEntries(Object.entries(models).map(([provider, values]) => [provider, values.map((id) => ({ id, label: id, efforts: [...REASONING_EFFORTS], defaultEffort: 'medium' }))])) : discoverProviderCatalogs()); this.models = Object.fromEntries(Object.entries(this.catalogs).map(([provider, values]) => [provider, values.map((model) => model.id)])); const available = (profile) => Array.isArray(this.models[profile?.provider]) && typeof profile.model === 'string' && Boolean(profile.model) && typeof profile.effort === 'string' && Boolean(profile.effort); this.lastUsed = lastUsed && available(lastUsed.delegatorProfile) && available(lastUsed.workerProfile) ? structuredClone(lastUsed) : null; if (this.lastUsed) this.lastUsed.workerProfile.permissionMode = 'workspace-write'; this.step = this.lastUsed ? 0 : 1; this.selection = 0; this.values = { workerCapacity: 5 }; this.input = ''; this.message = ''; this.history = []; }
  key() { return STEPS[this.step]; }
  modelOptions(provider) { return this.models[provider] || []; }
  model(provider, id) { return (this.catalogs[provider] || []).find((model) => model.id === id); }
  prefix() { return this.key().startsWith('delegator') ? 'delegator' : 'worker'; }
  manualModelOnly() { return this.key().endsWith('Model') && this.modelOptions(this.values[`${this.prefix()}Provider`]).length === 0; }
  optionLabel(option) { if (this.key().endsWith('Model') && option !== 'Type a model ID…') { const prefix = this.key().startsWith('delegator') ? 'delegator' : 'worker'; const model = this.model(this.values[`${prefix}Provider`], option); if (model?.label && model.label !== option) return `${model.label} · ${option}`; } return display(option); }
  options() {
    const key = this.key();
    if (key === 'preset') return ['Last used', 'Customize'];
    if (key === 'delegatorProvider' || key === 'workerProvider') return Object.keys(this.catalogs);
    if (key === 'delegatorModel') return [...this.modelOptions(this.values.delegatorProvider), 'Type a model ID…'];
    if (key === 'workerModel') return [...this.modelOptions(this.values.workerProvider), 'Type a model ID…'];
    if (key === 'delegatorEffort' || key === 'workerEffort') return [...REASONING_EFFORTS];
    if (key === 'confirmation') return ['Create session', 'Go back'];
    return [];
  }
  move(delta) { const length = this.options().length; if (length) this.selection = (this.selection + delta + length) % length; }
  prepareInput() { const key = this.key(); if (key === 'workerCapacity') this.input = `${this.values.workerCapacity || 5}`; else if (key.endsWith('Args')) this.input = (this.values[key] || []).join(' '); else this.input = `${this.values[key] || ''}`; }
  advance(answer) { if (answer !== undefined) this.history.push({ key: this.key(), title: COPY[this.key()][0], answer }); this.step += 1; this.selection = 0; this.input = ''; this.message = ''; if (TEXT_STEPS.has(this.key())) this.prepareInput(); else if (this.manualModelOnly()) this.message = 'Type the model ID, then press Enter.'; }
  back() {
    const firstStep = this.lastUsed ? 0 : 1; if (this.step <= firstStep) return;
    this.step -= 1; this.history.pop(); this.selection = 0; this.message = '';
    if (TEXT_STEPS.has(this.key())) this.prepareInput();
    else { const selected = this.options().indexOf(this.values[this.key()]); if (selected >= 0 && !this.manualModelOnly()) this.selection = selected; else if (this.key().endsWith('Model') && (this.values[this.key()] || this.manualModelOnly())) { this.input = this.values[this.key()] || ''; this.message = 'Type the model ID, then press Enter.'; } }
  }
  parseArgs(provider) { if (!this.input.trim()) return []; return tokenizeCommand(`${provider} ${this.input}`).argv; }
  config() { return { version: 1, delegatorProfile: { provider: this.values.delegatorProvider, model: this.values.delegatorModel, effort: this.values.delegatorEffort, ...(this.values.delegatorArgs?.length ? { argv: this.values.delegatorArgs } : {}) }, workerProfile: { provider: this.values.workerProvider, model: this.values.workerModel, effort: this.values.workerEffort, permissionMode: 'workspace-write', ...(this.values.workerArgs?.length ? { argv: this.values.workerArgs } : {}) }, workerCapacity: this.values.workerCapacity }; }
  choose() {
    const key = this.key(); const value = this.options()[this.selection];
    if (key === 'preset') { if (value === 'Last used') return structuredClone(this.lastUsed); this.advance('Custom setup'); return null; }
    if (key === 'confirmation') { if (value === 'Go back') { this.back(); return null; } return this.config(); }
    if (key.endsWith('Model') && value === 'Type a model ID…') { this.input = ''; this.message = 'Type the model ID, then press Enter.'; return null; }
    if (value === undefined) { this.message = 'Install Claude Code, Codex, or Ollama before continuing.'; return null; }
    this.values[key] = value; this.advance(display(value)); return null;
  }
  submitText() {
    const key = this.key();
    try {
      if (key === 'workerModel' || key === 'delegatorModel') { if (!this.input.trim()) throw new Error('A model ID is required.'); this.values[key] = this.input.trim(); }
      else if (key === 'workerCapacity') { const capacity = Number(this.input); if (!Number.isInteger(capacity) || capacity < 1 || capacity > 5) throw new Error('Enter a whole number from 1 to 5.'); this.values[key] = capacity; }
      else this.values[key] = this.parseArgs(key === 'delegatorArgs' ? this.values.delegatorProvider : this.values.workerProvider);
      const answer = key.endsWith('Args') ? (this.values[key].length ? this.values[key].join(' ') : 'No extra options') : this.values[key]; this.advance(answer); return null;
    } catch (error) { this.message = error.message; return null; }
  }
  handle(value) {
    if (value === '\u001b[D') { this.back(); return null; }
    const typingModel = this.key().endsWith('Model') && (this.manualModelOnly() || this.message.startsWith('Type the model'));
    if (TEXT_STEPS.has(this.key()) || typingModel) {
      if (value === '\r') return this.submitText();
      if (value === '\u007f' || value === '\b') this.input = this.input.slice(0, -1);
      else if (!value.startsWith('\u001b') && !/[\u0000-\u001f]/.test(value) && (this.key() !== 'workerCapacity' || /^\d$/.test(value))) this.input += value;
      return null;
    }
    if (value === '\u001b[A') this.move(-1); else if (value === '\u001b[B') this.move(1); else if (value === '\r') return this.choose();
    return null;
  }
  summary(config = this.config()) { return [`Delegator agent  ${profileSummary(config.delegatorProfile)}`, `Worker agent     ${profileSummary(config.workerProfile)}`, `Max workers      ${config.workerCapacity}`]; }
  answer(key) { const completed = this.history.findLast((item) => item.key === key)?.answer; if (completed !== undefined) return completed; const value = this.values[key]; if (Array.isArray(value)) return value.length ? value.join(' ') : 'No extra options'; return value === undefined || value === '' ? 'Not set' : display(value); }
  groupCompleted(group) { return group.keys.every((groupKey) => STEPS.indexOf(groupKey) < this.step); }
  groupAnswer(group) {
    if (group.keys.length === 2) {
      const model = this.answer(group.keys[0]); const effort = this.answer(group.keys[1]);
      if (model === 'Not set') return model;
      return effort === 'Not set' ? model : `${model} · ${effort}`;
    }
    const value = this.answer(group.keys[0]);
    if (group.keys[0] === 'workerCapacity' && !this.groupCompleted(group)) return `${value} (default)`;
    return value;
  }
  visibleOptions() { const options = this.options(); if (options.length <= 5) return options.map((option, index) => ({ option, index })); const start = Math.max(0, Math.min(this.selection - 2, options.length - 5)); return options.slice(start, start + 5).map((option, offset) => ({ option, index: start + offset })); }
  render() {
    const key = this.key(); const [title, baseDescription] = COPY[key]; let description = baseDescription; const provider = this.values[`${this.prefix()}Provider`]; if (this.manualModelOnly()) description = `Enter the model ID you want ${display(provider)} to use.`; else if (key.endsWith('Model') && provider === 'ollama') description = 'Choose an installed Ollama model or enter a model ID manually.'; else if (key.endsWith('Args') && provider === 'ollama') description = 'Optional Codex CLI arguments passed through Ollama, such as --search. BDFL adds model, permissions, and session flags.'; const lines = [`${COLOR.selected}New session${COLOR.reset}`, `${COLOR.dim}Choose the agents and defaults BDFL should restore with this session.${COLOR.reset}`, ''];
    const optionLine = (option, index) => index === this.selection ? `${COLOR.bgYellow}${COLOR.black}${COLOR.bold} › ${this.optionLabel(option)} ${COLOR.reset}` : `   ${COLOR.white}${COLOR.bold}${this.optionLabel(option)}${COLOR.reset}`;
    const activeDetails = () => {
      lines.push(`${COLOR.dim}  ${description}${COLOR.reset}`);
      if (TEXT_STEPS.has(key) || key.endsWith('Model') && (this.manualModelOnly() || this.message.startsWith('Type the model'))) {
        const optional = key.endsWith('Args');
        lines.push(`${COLOR.input}${COLOR.bold} › ${this.input}${COLOR.bgCyan}${COLOR.black} ${COLOR.reset}`, `${COLOR.dim}${optional ? 'Enter skips or continues.' : 'Enter continues.'}${COLOR.reset}`);
      } else if (key === 'confirmation') {
        lines.push(...this.visibleOptions().map(({ option, index }) => optionLine(option, index)));
      } else if (!this.options().length) {
        lines.push(`${COLOR.error}${COLOR.bold}! No supported agent executable was found on PATH.${COLOR.reset}`);
      } else {
        lines.push(...this.visibleOptions().map(({ option, index }) => optionLine(option, index)));
      }
    };
    if (key === 'preset' && this.lastUsed) lines.push(...this.options().flatMap((option, index) => option === 'Last used' ? [optionLine(option, index), ...this.summary(this.lastUsed).map((line) => `${COLOR.dim}    ${line}${COLOR.reset}`)] : [optionLine(option, index)]));
    else {
      for (const [index, group] of SETUP_GROUPS.entries()) {
        const active = group.keys.includes(key); const value = this.groupAnswer(group); const answered = this.groupCompleted(group); const label = `${index + 1}. ${group.label}`;
        if (index) lines.push('');
        if (active) lines.push(`${COLOR.white}${COLOR.bold}○ ${label}${COLOR.reset}${value === 'Not set' ? '' : `  ${COLOR.bold}${COLOR.white}${value}${COLOR.reset}`}`);
        else if (answered) lines.push(`${COLOR.done}✓ ${label}${COLOR.reset}  ${COLOR.bold}${COLOR.white}${value}${COLOR.reset}`);
        else lines.push(`${COLOR.dim}○ ${label}  ${value}${COLOR.reset}`);
        if (active) activeDetails();
      }
      if (key === 'confirmation') {
        lines.push('', ...this.visibleOptions().map(({ option, index }) => optionLine(option, index)));
      }
    }
    if (this.message && !this.message.startsWith('Type the model')) lines.push(`${COLOR.error}${COLOR.bold}! ${this.message}${COLOR.reset}`);
    lines.push('', `${COLOR.accent}↑/↓ choose  •  ← edit previous  •  Enter continue  •  Esc back${COLOR.reset}`); return lines.join('\n');
  }
}

module.exports = { COPY, STEPS, WorkstreamWizard, display, profileSummary };
