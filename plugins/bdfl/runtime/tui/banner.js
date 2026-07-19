'use strict';

const VERBS = Object.freeze([
  'commanding',
  'strategizing',
  'delegating',
  'orchestrating',
  'executing',
  'awaiting',
  'reviewing',
  'validating',
  'integrating'
]);
const PERIODS = Object.freeze([1, 2, 3, 4, 3, 2]);
const YELLOW = '\u001b[38;5;220m';
const RESET = '\u001b[0m';

function verbForState(state = {}) {
  const records = [...(state.runs || []), ...(state.tasks || []), ...(state.agents || [])];
  const statuses = new Set(records.map((record) => record.status));
  if (statuses.has('integrating')) return 'integrating';
  if (statuses.has('validating')) return 'validating';
  if (statuses.has('review') || statuses.has('approved')) return 'reviewing';
  if (statuses.has('waiting') || (state.inbox || []).some((item) => item.status === 'open')) return 'awaiting';
  if ((state.agents || []).some((agent) => agent.status === 'running')) return 'orchestrating';
  if ((state.tasks || []).some((task) => task.status === 'running')) return 'executing';
  if ([...(state.tasks || []), ...(state.agents || [])].some((record) => record.status === 'pending')) return 'delegating';
  if ((state.plans || []).some((plan) => plan.selectedVersion == null) || (state.runs || []).some((run) => run.status === 'pending')) return 'strategizing';
  return 'commanding';
}

function bannerFrame(index, color = true, verb = 'commanding') {
  if (!VERBS.includes(verb)) throw new Error(`Unknown BDFL status verb: ${verb}`);
  const text = `BDFL is ${verb}${'.'.repeat(PERIODS[((index % PERIODS.length) + PERIODS.length) % PERIODS.length])}`;
  return color ? `${YELLOW}${text}${RESET}` : text;
}

function frameAt(time = Date.now(), color = true, verb = 'commanding', interval = 500) {
  return bannerFrame(Math.floor(time / interval), color, verb);
}

module.exports = { VERBS, PERIODS, YELLOW, RESET, verbForState, bannerFrame, frameAt };
