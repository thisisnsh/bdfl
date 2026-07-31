'use strict';

const { cellWidth, cropCells } = require('./cells');

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

function safeTmuxText(value) {
  return `${value ?? ''}`.replace(/[\u0000-\u001f\u007f-\u009f]/gu, ' ').replaceAll('#', '##');
}

function railStatus(session) {
  if (session.attention) return { marker: '!', color: 'colour203' };
  const status = statusToken(session);
  if (status === 'Working') return { marker: '●', color: 'colour220' };
  if (status === 'Exited') return { marker: '×', color: 'colour203' };
  if (status === 'Paused') return { marker: '○', color: 'colour81' };
  return { marker: '○', color: 'colour245' };
}

function agentRail(workspace, panes, columns = 80) {
  const sessions = new Map((workspace.sessions || []).map((session) => [session.id, session]));
  const streams = new Map((workspace.workstreams || []).map((stream) => [stream.id, stream]));
  const live = panes
    .filter(
      (pane) => /^%\d+$/u.test(pane.paneId) && pane.sessionId && pane.dead !== '1' && sessions.has(pane.sessionId)
    )
    .sort((left, right) => {
      const leftStream = workspace.workstreams.findIndex((stream) => stream.id === left.workstreamId);
      const rightStream = workspace.workstreams.findIndex((stream) => stream.id === right.workstreamId);
      if (leftStream !== rightStream) return leftStream - rightStream;
      return (sessions.get(left.sessionId).paneNumber || 0) - (sessions.get(right.sessionId).paneNumber || 0);
    });
  const prefix = ' Agents  ';
  const budget = Math.max(1, columns - cellWidth(prefix));
  const active = Math.max(
    0,
    live.findIndex((pane) => pane.active === '1' && pane.windowActive === '1')
  );
  const label = (pane, firstInGroup = true, limit = Infinity) => {
    const session = sessions.get(pane.sessionId);
    const stream = streams.get(pane.workstreamId);
    const parent = stream?.name || stream?.title || 'Session';
    const full = `${firstInGroup ? `${parent} › ` : ''}${session.name || 'Agent'} ${railStatus(session).marker}`;
    return `[${Number.isFinite(limit) ? cropCells(full, Math.max(1, limit - 2)) : full}]`;
  };
  let start = active;
  let end = active;
  const selectionWidth = (from, to) => {
    let total = 0;
    let previous = null;
    for (let index = from; index <= to; index += 1) {
      const pane = live[index];
      const current = pane.workstreamId;
      total += cellWidth(label(pane, current !== previous)) + (index > from ? 1 : 0);
      previous = current;
    }
    return total;
  };
  while (live.length && (start > 0 || end < live.length - 1)) {
    const leftFirst = active - start <= end - active;
    const candidateStart = leftFirst && start > 0 ? start - 1 : start;
    const candidateEnd = !leftFirst && end < live.length - 1 ? end + 1 : end;
    if ((candidateStart !== start || candidateEnd !== end) && selectionWidth(candidateStart, candidateEnd) <= budget) {
      start = candidateStart;
      end = candidateEnd;
      continue;
    }
    const alternateStart = candidateStart === start && start > 0 ? start - 1 : start;
    const alternateEnd = candidateEnd === end && end < live.length - 1 ? end + 1 : end;
    if ((alternateStart !== start || alternateEnd !== end) && selectionWidth(alternateStart, alternateEnd) <= budget) {
      start = alternateStart;
      end = alternateEnd;
      continue;
    }
    break;
  }
  const omissionWidth = () => (start > 0 ? 2 : 0) + (end < live.length - 1 ? 2 : 0);
  while (start < end && selectionWidth(start, end) + omissionWidth() > budget) {
    if (active - start > end - active) start += 1;
    else end -= 1;
  }
  const visible = live.slice(start, end + 1);
  let previous = null;
  const formatted = visible.map((pane, offset) => {
    const session = sessions.get(pane.sessionId);
    const current = pane.workstreamId;
    const focused = start + offset === active;
    const only = visible.length === 1;
    const plain = label(pane, current !== previous, only ? Math.max(1, budget - omissionWidth()) : Infinity);
    previous = current;
    const status = railStatus(session);
    const style = focused ? '#[bold,fg=colour81]' : `#[fg=${status.color}]`;
    return `#[range=pane|${pane.paneId}]${style}${safeTmuxText(plain)}#[default]#[norange]`;
  });
  const left = start > 0 ? '#[fg=colour245]… ' : '';
  const right = end < live.length - 1 ? ' #[fg=colour245]…' : '';
  return `#[fg=colour245]${prefix}${left}${formatted.join(' ')}${right}`;
}

module.exports = { ROLE_LABELS, STATUS_COLORS, statusToken, agentLabel, entityRow, safeTmuxText, agentRail };
