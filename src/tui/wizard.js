'use strict';
const STEPS = ['delegatorProvider', 'delegatorModel', 'delegatorEffort', 'workerProvider', 'workerModel', 'workerEffort', 'workerCapacity', 'permissionMode', 'confirmation'];
class WorkstreamWizard {
  constructor({ models = { claude: ['sonnet'], codex: ['gpt-5'] } } = {}) { this.models = models; this.step = 0; this.selection = 0; this.values = {}; }
  key() { return STEPS[this.step]; }
  options() { const key = this.key(); if (key === 'delegatorProvider' || key === 'workerProvider') return ['claude', 'codex']; if (key === 'delegatorModel') return this.models[this.values.delegatorProvider] || []; if (key === 'workerModel') return this.models[this.values.workerProvider] || []; if (key === 'delegatorEffort' || key === 'workerEffort') return ['medium', 'low', 'high']; if (key === 'workerCapacity') return [4, 1, 2, 3, 5]; if (key === 'permissionMode') return ['workspace-write', 'read-only', 'full-access']; return ['Confirm worker permissions', 'Back']; }
  move(delta) { const length = this.options().length; this.selection = (this.selection + delta + length) % length; }
  choose() { const key = this.key(); const value = this.options()[this.selection]; if (key === 'confirmation' && value === 'Back') { this.step -= 1; this.selection = 0; return null; } this.values[key] = value; if (this.step < STEPS.length - 1) { this.step += 1; this.selection = 0; return null; } return { version: 1, delegatorProfile: { provider: this.values.delegatorProvider, model: this.values.delegatorModel, effort: this.values.delegatorEffort }, workerProfile: { provider: this.values.workerProvider, model: this.values.workerModel, effort: this.values.workerEffort, permissionMode: this.values.permissionMode }, workerCapacity: this.values.workerCapacity }; }
  render() { return [`Create workstream · ${this.step + 1}/${STEPS.length}`, this.key(), '', ...this.options().map((option, index) => `${index === this.selection ? '›' : ' '} ${option}`)].join('\n'); }
}
module.exports = { STEPS, WorkstreamWizard };
