'use strict';

const { cropCells } = require('./cells');

const ROLE_LABELS = {
  delegator: 'planning',
  direct: 'direct',
  worker: 'worker',
  verifier: 'worker',
  integration: 'execution'
};
const STATUS_COLORS = {
  Working: 'colour220',
  Idle: 'colour245',
  Paused: 'colour81',
  Waiting: 'colour245',
  Exited: 'colour203'
};

function statusToken(session) {
  if (session.waitingForRail) return 'Waiting';
  if (session.status === 'paused') return 'Paused';
  if (session.status === 'exited' || session.status === 'failed') return 'Exited';
  return session.turnState === 'working' ? 'Working' : 'Idle';
}

function agentLabel(session, { focused = false, columns = Infinity, tmux = false } = {}) {
  const name = `${session.name || 'Agent'}`;
  const role = ROLE_LABELS[session.role] || session.role || 'agent';
  const status = statusToken(session);
  const marker = focused ? '◆ ' : '';
  if (!tmux) return cropCells(`${marker}${name} ${role} ${status}`, columns);
  const color = STATUS_COLORS[status] || 'colour245';
  const fixed = `${marker} ${role} ${status}`.length;
  const visibleName = Number.isFinite(columns) ? cropCells(name, Math.max(1, columns - fixed)) : name;
  const safeName = visibleName.replaceAll('#', '##');
  return `${focused ? '#[bold,fg=colour81]◆ ' : ''}#[fg=white]${safeName} #[fg=colour245]${role} #[fg=${color}]${status}#[default]`;
}

function entityRow(name, agent, status, { selected = false } = {}) {
  const color = STATUS_COLORS[status] || 'colour245';
  return `${selected ? '#[bold,fg=colour81]› ' : '  '}#[fg=white]${name} #[fg=colour245]${agent || ''} #[fg=${color}]${status}#[default]`;
}

module.exports = { ROLE_LABELS, STATUS_COLORS, statusToken, agentLabel, entityRow };
