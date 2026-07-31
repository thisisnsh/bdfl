'use strict';

const { PROTOCOL_VERSION, SURFACE_SNAPSHOT_VERSION, request, subscribe } = require('../daemon/protocol');
const { cellWidth, cropCells } = require('../tmux/cells');
const { WorkstreamWizard } = require('./wizard');
const { ReviewView, stateDescriptor } = require('./review-view');

const ANSI = {
  clear: '\u001b[2J\u001b[H',
  white: '\u001b[38;5;255m',
  gray: '\u001b[38;5;245m',
  cyan: '\u001b[38;5;81m',
  yellow: '\u001b[38;5;220m',
  red: '\u001b[38;5;203m',
  reset: '\u001b[0m'
};
const STATUS = { Working: ANSI.yellow, Idle: ANSI.gray, Paused: ANSI.cyan, Waiting: ANSI.gray, Exited: ANSI.red };
const HELP_LINES = [
  `${ANSI.cyan}Focused agents${ANSI.reset}`,
  'C-b Left/Right or C-b h/l  Cycle through every open agent',
  'C-b o                       Toggle the current session overview',
  'C-b x                       Pause the focused agent and choose a fallback',
  'C-b [ / C-b z               Copy mode / tmux zoom',
  '',
  `${ANSI.cyan}Workflows${ANSI.reset}`,
  'C-b n / p / s / r           New / Plans / Sessions / Reviews',
  'C-b q                       Confirm a normal BDFL shutdown',
  'C-b ?                       Show these controls',
  '',
  `${ANSI.gray}Unprefixed keys always go to the provider. Hold Shift while dragging to select native terminal text.${ANSI.reset}`,
  `${ANSI.gray}In an overview, prefixed arrows move spatially; Enter or C-b o returns to the selected agent.${ANSI.reset}`,
  '',
  `${ANSI.cyan}Esc or q closes help${ANSI.reset}`
];
const ESCAPES = {
  up: '\u001b[A',
  down: '\u001b[B',
  right: '\u001b[C',
  left: '\u001b[D',
  pageUp: '\u001b[5~',
  pageDown: '\u001b[6~'
};

function inputTokens(value) {
  return (
    `${value}`.match(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)|\u001b\[[0-?]*[ -/]*[@-~]|\u001bO.|\u001b.|./gsu) || []
  );
}

function mouseEvent(value) {
  const match = /^\u001b\[<([0-9]+);([0-9]+);([0-9]+)([Mm])$/u.exec(value);
  if (!match) return null;
  return { button: Number(match[1]), column: Number(match[2]), row: Number(match[3]), final: match[4] };
}

function stripAnsi(value) {
  return `${value}`.replace(/\u001b\[[0-?]*[ -/]*[@-~]/gu, '');
}

function fitLine(value, columns) {
  if (cellWidth(stripAnsi(value)) <= columns) return value;
  return cropCells(stripAnsi(value), columns);
}

function statusLabel(item) {
  if (item.attention) return { label: 'Needs attention', color: ANSI.red };
  if (item.turnState === 'working' || item.status === 'running') return { label: 'Working', color: ANSI.yellow };
  if (item.open) return { label: 'Idle', color: ANSI.gray };
  if (item.status === 'paused' || item.status === 'closed') return { label: 'Paused', color: ANSI.cyan };
  if (item.status === 'failed' || item.status === 'exited') return { label: 'Exited', color: ANSI.red };
  return { label: item.status || 'Idle', color: ANSI.gray };
}

function reviewKey(item) {
  return item?.id || `${item?.executionId || ''}:${item?.itemId || ''}`;
}

function entityRow(item, selected = false) {
  return `${selected ? `${ANSI.cyan}› ` : '  '}${ANSI.white}${item.name}${ANSI.reset} ${ANSI.gray}${item.agent || ''}${ANSI.reset} ${STATUS[item.status] || ANSI.gray}${item.status}${ANSI.reset}`;
}

function popupLines(page, items, selection = 0, confirmation = null) {
  const action = page === 'Sessions' ? 'open agent' : page === 'Reviews' ? 'open review' : 'select';
  const lines = [
    '',
    `${ANSI.gray}  ${page} · ↑/↓ or j/k to select · Enter to ${action} · Esc/q to close${['Sessions', 'Plans'].includes(page) ? ' · d/D to delete' : ''}${ANSI.reset}`,
    ''
  ];
  if (!items.length) lines.push(`${ANSI.gray}  No ${page.toLowerCase()} available.${ANSI.reset}`);
  else lines.push(...items.map((item, index) => entityRow(item, index === selection)));
  if (confirmation) lines.push('', `${ANSI.red}${confirmation} Press Enter to confirm; Esc cancels.${ANSI.reset}`);
  return lines;
}

class PopupClient {
  constructor(socket, page, { input = process.stdin, output = process.stdout } = {}) {
    this.socket = socket;
    this.page = page;
    this.input = input;
    this.output = output;
    this.items = [];
    this.selection = 0;
    this.selectionKey = null;
    this.expanded = new Set();
    this.expansionInitialized = false;
    this.snapshot = null;
    this.scroll = 0;
    this.followSelection = true;
    this.confirmation = null;
    this.wizard = null;
    this.detail = null;
    this.detailIndex = 0;
    this.rangeStart = null;
    this.planView = 'sections';
    this.inputState = null;
    this.hits = [];
    this.reviewView = new ReviewView();
    this.unsubscribe = null;
    this.refreshing = null;
    this.stopped = false;
  }
  async load() {
    if (this.page === 'Help') this.detail = { id: 'help', lines: HELP_LINES };
    else if (this.page === 'Shutdown') this.confirmation = { shutdown: true };
    else if (this.page === 'New') {
      const state = await request(this.socket, 'new-context');
      this.wizard = new WorkstreamWizard(state);
    } else await this.refresh();
  }
  snapshotParams() {
    if (this.page === 'Plans' && this.detail)
      return { page: this.page, id: this.detail.id, version: this.detail.version };
    if (this.page === 'Reviews' && this.detail) return { page: this.page, id: this.detail.id };
    return { page: this.page };
  }
  async refresh(force = false) {
    if (!['Sessions', 'Plans', 'Reviews'].includes(this.page)) return;
    if (this.refreshing) return force ? this.refreshing.then(() => this.refresh()) : this.refreshing;
    this.refreshing = request(this.socket, 'surface-snapshot', this.snapshotParams())
      .then((snapshot) => {
        if (snapshot.protocolVersion !== PROTOCOL_VERSION)
          throw new Error(`BDFL protocol changed; close and reopen this surface`);
        if (snapshot.snapshotVersion !== SURFACE_SNAPSHOT_VERSION)
          throw new Error(`BDFL surface snapshot changed; close and reopen this surface`);
        this.snapshot = snapshot;
        this.reconcileSelection();
        if (this.page === 'Plans' && snapshot.detail) {
          this.detail = { ...this.detail, id: snapshot.detail.id, version: snapshot.detail.version };
          this.detailIndex = Math.min(this.detailIndex, Math.max(0, snapshot.detail.sections.length - 1));
        }
        if (this.page === 'Reviews' && snapshot.detail) {
          const changed = reviewKey(this.reviewView.item) !== snapshot.detail.id;
          if (changed) this.reviewView.open(snapshot.detail);
          else this.reviewView.update(snapshot.detail);
        }
      })
      .finally(() => {
        this.refreshing = null;
      });
    return this.refreshing;
  }
  groupedRows() {
    if (!this.snapshot) return [];
    if (this.page === 'Sessions')
      return this.snapshot.groups.flatMap((group) => [
        { key: `group:${group.id}`, kind: 'group', group },
        ...(this.expanded.has(group.id)
          ? group.agents.map((item) => ({ key: `agent:${item.id}`, kind: 'agent', group, item }))
          : [])
      ]);
    const values = this.page === 'Plans' ? this.snapshot.plans : this.snapshot.items;
    const groups = new Map((this.snapshot.groups || []).map((group) => [group.id, { ...group, items: [] }]));
    for (const item of values || []) {
      const group = groups.get(item.workstreamId) || {
        id: item.workstreamId || 'earlier',
        name: 'Earlier sessions',
        items: []
      };
      if (!groups.has(group.id)) groups.set(group.id, group);
      group.items.push(item);
    }
    return [...groups.values()]
      .filter((group) => group.items.length)
      .flatMap((group) => [
        { key: `group:${group.id}`, kind: 'group', group },
        ...(this.expanded.has(group.id)
          ? group.items.map((item) => ({ key: `item:${item.id}`, kind: 'item', group, item }))
          : [])
      ]);
  }
  reconcileSelection() {
    const rows = this.groupedRows();
    if (!this.expansionInitialized && rows.length) {
      if (!this.expanded.size) {
        const activeGroup =
          this.page === 'Sessions'
            ? this.snapshot.groups.find((group) => group.agents.some((agent) => agent.id === this.snapshot.activeId))
            : null;
        this.expanded.add(activeGroup?.id || rows.find((row) => row.kind === 'group')?.group.id);
      }
      this.expansionInitialized = true;
    }
    const currentRows = this.groupedRows();
    let index = currentRows.findIndex((row) => row.key === this.selectionKey);
    if (index < 0 && this.page === 'Sessions')
      index = currentRows.findIndex((row) => row.item?.id === this.snapshot.activeId);
    if (index < 0) index = currentRows.findIndex((row) => row.kind !== 'group');
    if (index < 0) index = 0;
    this.selection = Math.max(0, index);
    this.selectionKey = currentRows[this.selection]?.key || null;
  }
  selectedRow() {
    return this.groupedRows()[this.selection] || null;
  }
  moveSelection(delta) {
    const rows = this.groupedRows();
    if (!rows.length) return;
    this.selection = Math.max(0, Math.min(rows.length - 1, this.selection + delta));
    this.selectionKey = rows[this.selection].key;
    this.followSelection = true;
  }
  headerLines(title, description) {
    return [`${ANSI.cyan}${title}${ANSI.reset}`, `${ANSI.gray}${description}${ANSI.reset}`, ''];
  }
  listPresentation() {
    const rows = this.groupedRows();
    const lines = this.headerLines(
      this.page,
      this.page === 'Sessions'
        ? 'Saved sessions and every managed agent, with live status and task context.'
        : this.page === 'Plans'
          ? 'Versioned plans and execution readiness, grouped by session.'
          : 'Worker results and complete integration reviews, grouped by session.'
    );
    const body = [];
    const bodyHits = [];
    for (const row of rows) {
      const selected = row.key === this.selectionKey;
      if (row.kind === 'group') {
        const count = row.group.agents?.length ?? row.group.items?.length ?? 0;
        bodyHits.push({ key: row.key, index: body.length });
        body.push(
          `${selected ? ANSI.cyan : ANSI.white}${this.expanded.has(row.group.id) ? '▾' : '▸'} ${row.group.name}${ANSI.reset} ${ANSI.gray}${count}${ANSI.reset}`
        );
        continue;
      }
      const item = row.item;
      bodyHits.push({ key: row.key, index: body.length });
      if (this.page === 'Sessions') {
        const status = statusLabel(item);
        body.push(
          `${selected ? ANSI.cyan : ANSI.white}${selected ? '›' : ' '}  ${item.name || item.role}${ANSI.reset} ${ANSI.gray}${item.role}${ANSI.reset} ${status.color}${status.label}${ANSI.reset}`
        );
        if (item.taskSnippet || item.turnStateReason)
          body.push(`${ANSI.gray}     ${item.taskSnippet || item.turnStateReason}${ANSI.reset}`);
      } else if (this.page === 'Plans') {
        body.push(
          `${selected ? ANSI.cyan : ANSI.white}${selected ? '›' : ' '}  ${item.name}${ANSI.reset} ${ANSI.gray}v${item.currentVersion} · ${item.status}${ANSI.reset}`
        );
      } else {
        body.push(
          `${selected ? ANSI.cyan : ANSI.white}${selected ? '›' : ' '}  ${item.agentLabel} · ${item.planTitle}${ANSI.reset} ${ANSI.gray}${item.status}${ANSI.reset}`
        );
        if (item.summary) body.push(`${ANSI.gray}     ${item.summary}${ANSI.reset}`);
      }
    }
    if (!rows.length) body.push(`${ANSI.gray}No ${this.page.toLowerCase()} available.${ANSI.reset}`);
    const footer =
      this.page === 'Sessions'
        ? '↑/↓ or j/k select · ←/→ collapse/expand · Enter focus/resume · r rename · d agent · D session · Esc/q close'
        : this.page === 'Plans'
          ? '↑/↓ or j/k select · ←/→ collapse/expand · Enter open · r rename · d plan · D session plans · Esc/q close'
          : '↑/↓ or j/k select · ←/→ collapse/expand · Enter review · Esc/q close';
    const available = Math.max(1, (this.output.rows || 24) - lines.length - 2);
    const selectedHit = bodyHits.find((hit) => hit.key === this.selectionKey);
    if (this.followSelection && selectedHit) {
      if (selectedHit.index < this.scroll) this.scroll = selectedHit.index;
      else if (selectedHit.index >= this.scroll + available) this.scroll = selectedHit.index - available + 1;
    }
    this.scroll = Math.max(0, Math.min(this.scroll, Math.max(0, body.length - available)));
    const visible = body.slice(this.scroll, this.scroll + available);
    this.hits = bodyHits
      .filter((hit) => hit.index >= this.scroll && hit.index < this.scroll + available)
      .map((hit) => ({ ...hit, row: lines.length + hit.index - this.scroll + 1 }));
    return [...lines, ...visible, `${ANSI.cyan}${footer}${ANSI.reset}`];
  }
  planPresentation() {
    const detail = this.snapshot?.detail;
    if (!detail) return this.listPresentation();
    const section = detail.sections[this.detailIndex];
    const lines = this.headerLines(
      `${detail.name} · v${detail.version} of ${detail.currentVersion}`,
      `${detail.executionStatus} · ${detail.sections.filter((item) => item.approved).length}/${detail.sections.length} sections approved`
    );
    let content;
    if (this.planView === 'read') content = `${section?.content || ''}`.trimEnd().split('\n');
    else if (this.planView === 'diff') content = `${detail.diff || 'No earlier version diff.'}`.split('\n');
    else
      content = detail.sections.map(
        (item, index) =>
          `${index === this.detailIndex ? `${ANSI.cyan}›` : ' '} ${item.id === 'shared' ? 'Shared decisions' : item.id === 'global-validation' ? 'Global validation' : item.title || item.id} · ${item.approved ? `${ANSI.cyan}Approved` : `${ANSI.gray}Needs approval`}${ANSI.reset}`
      );
    const available = Math.max(1, (this.output.rows || 24) - lines.length - 3);
    if (this.planView !== 'sections')
      this.scroll = Math.max(0, Math.min(this.scroll, Math.max(0, content.length - available)));
    else this.scroll = 0;
    const visible = content.slice(this.scroll, this.scroll + available);
    const footer =
      this.planView === 'sections'
        ? '↑/↓ or j/k section · ←/→ version · Enter read · a toggle approval · d diff · e execute · Esc back'
        : '↑/↓ or j/k scroll · Page Up/Down · Esc back';
    this.hits = [];
    return [...lines, ...visible, '', `${ANSI.cyan}${footer}${ANSI.reset}`];
  }
  reviewPresentation() {
    const detail = this.snapshot?.detail;
    if (!detail) return this.listPresentation();
    const descriptor = stateDescriptor(detail);
    const header = this.headerLines(`${detail.agentLabel} · ${detail.planTitle}`, descriptor.label);
    const controls = descriptor.actions
      .map((action) =>
        action === 'accept'
          ? 'a accept'
          : action === 'feedback'
            ? 'f feedback'
            : action === 'remedy'
              ? 'r remedy'
              : action === 'integrate'
                ? 'i integrate'
                : action === 'override'
                  ? 'o override'
                  : action
      )
      .join(' · ');
    const footer = `${controls ? `${controls} · ` : ''}↑/↓ or j/k scroll · drag excerpts · u undo · x clear · Esc back`;
    const available = Math.max(1, (this.output.rows || 24) - header.length - 2);
    this.reviewView.resize(Math.max(8, (this.output.columns || 80) - 1), available);
    const frame = this.reviewView.render({
      bodyTop: header.length + 1,
      bodyLeft: 1,
      bodyWidth: this.output.columns || 80
    });
    this.hits = frame.hits.map((hit) => ({ ...hit, review: true }));
    return [...header, ...frame.lines, `${ANSI.cyan}${footer}${ANSI.reset}`];
  }
  promptPresentation(lines) {
    return ['', ...lines, '', `${ANSI.cyan}Enter confirms · Esc cancels${ANSI.reset}`];
  }
  draw() {
    let value;
    if (this.page === 'Shutdown')
      value = [
        '',
        `${ANSI.red}Shut down BDFL?${ANSI.reset}`,
        '',
        'Providers will be snapshotted and paused. Saved sessions and provider identities remain resumable.',
        '',
        `${ANSI.cyan}Enter confirms · Esc/q cancels${ANSI.reset}`
      ];
    else if (this.wizard) value = ['', ...this.wizard.render().split('\n')];
    else if (this.inputState)
      value = this.promptPresentation([
        `${ANSI.white}${this.inputState.label}${ANSI.reset}`,
        `${ANSI.cyan}${this.inputState.value}${ANSI.reset}`,
        ...(this.inputState.error ? [`${ANSI.red}${this.inputState.error}${ANSI.reset}`] : [])
      ]);
    else if (this.confirmation)
      value = this.promptPresentation([
        `${ANSI.red}${this.confirmation.label}${ANSI.reset}`,
        `${ANSI.gray}${this.confirmation.consequence || ''}${ANSI.reset}`
      ]);
    else if (this.snapshot)
      value =
        this.page === 'Plans'
          ? this.planPresentation()
          : this.page === 'Reviews'
            ? this.reviewPresentation()
            : this.listPresentation();
    else if (this.detail) {
      const start = this.rangeStart === null ? null : Math.min(this.rangeStart, this.detailIndex);
      const end = this.rangeStart === null ? null : Math.max(this.rangeStart, this.detailIndex);
      value = [
        '',
        ...this.detail.lines.map((line, index) => {
          const marker = index === this.detailIndex ? '›' : ' ';
          const selected = start !== null && index >= start && index <= end;
          return `${selected ? ANSI.cyan : ''}${marker} ${line}${selected ? ANSI.reset : ''}`;
        })
      ];
    } else value = popupLines(this.page, this.items, this.selection, this.confirmation);
    const columns = Math.max(20, this.output.columns || 80);
    const rows = Math.max(5, this.output.rows || 24);
    const fitted = value.slice(0, rows).map((line) => fitLine(line, columns));
    this.output.write(`${ANSI.clear}${fitted.join('\n')}\n`);
  }
  async runAction(action, params) {
    await request(this.socket, action, params);
    await this.refresh(true);
  }
  startInput(kind, target, value, label) {
    this.inputState = { kind, target, value: value || '', label, error: null };
  }
  startConfirmation(kind, target, label, consequence = '') {
    this.confirmation = { kind, target, label, consequence };
  }
  async submitInput() {
    const input = this.inputState;
    try {
      if (input.kind === 'rename-session')
        await this.runAction('sessions-action', { name: 'rename', id: input.target, value: input.value });
      else if (input.kind === 'rename-plan')
        await this.runAction('plans-action', { name: 'rename', id: input.target, value: input.value });
      else if (input.kind === 'feedback') {
        const detail = this.snapshot.detail;
        await this.runAction('reviews-action', {
          name: 'feedback',
          executionId: detail.executionId,
          itemId: detail.itemId,
          message: input.value,
          selections: this.reviewView.selections()
        });
      } else if (input.kind === 'remedy') {
        this.inputState = null;
        this.startConfirmation(
          'remedy',
          { executionId: this.snapshot.detail.executionId, message: input.value },
          'Apply the verifier remedy?',
          'Affected contextual workers will repair in isolation and return for renewed review.'
        );
        return;
      }
      this.inputState = null;
    } catch (error) {
      input.error = error.message;
    }
  }
  async confirmAction() {
    const confirmation = this.confirmation;
    if (!confirmation) return;
    if (confirmation.kind === 'error') {
      this.confirmation = null;
      return;
    }
    const target = confirmation.target;
    if (confirmation.kind === 'delete-agent')
      await this.runAction('sessions-action', { name: 'delete-agent', id: target.id });
    else if (confirmation.kind === 'delete-session')
      await this.runAction('sessions-action', { name: 'delete-session', id: target.id });
    else if (confirmation.kind === 'delete-plan')
      await this.runAction('plans-action', { name: 'delete', id: target.id });
    else if (confirmation.kind === 'delete-session-plans')
      await this.runAction('plans-action', { name: 'delete-session-plans', id: target.id });
    else if (confirmation.kind === 'execute')
      await this.runAction('plans-action', { name: 'execute', id: target.id, version: target.version });
    else
      await this.runAction('reviews-action', {
        name: confirmation.kind,
        executionId: target.executionId,
        ...(target.message ? { message: target.message } : {})
      });
    this.confirmation = null;
    if (['delete-plan', 'delete-session-plans'].includes(confirmation.kind)) this.detail = null;
  }
  async activateSelection() {
    const row = this.selectedRow();
    if (!row) return;
    if (row.kind === 'group') {
      if (this.expanded.has(row.group.id)) this.expanded.delete(row.group.id);
      else this.expanded.add(row.group.id);
      this.reconcileSelection();
      return;
    }
    if (this.page === 'Sessions') {
      await this.runAction('sessions-action', { name: row.item.open ? 'focus' : 'resume', id: row.item.id });
      return this.stop();
    }
    this.detail = {
      id: row.item.id,
      ...(this.page === 'Plans' ? { version: row.item.currentVersion } : {})
    };
    this.detailIndex = 0;
    this.scroll = 0;
    this.planView = 'sections';
    await this.refresh(true);
  }
  async workflowKey(value) {
    if (this.inputState) {
      if (value === '\u001b') this.inputState = null;
      else if (value === '\r') await this.submitInput();
      else if (value === '\u007f' || value === '\b')
        this.inputState.value = [...this.inputState.value].slice(0, -1).join('');
      else if (!/[\u0000-\u001f\u007f-\u009f]/u.test(value)) this.inputState.value += value;
      return;
    }
    if (this.confirmation) {
      if (value === '\u001b') this.confirmation = null;
      else if (value === '\r') {
        try {
          await this.confirmAction();
        } catch (error) {
          this.confirmation = null;
          this.showError(error);
        }
      }
      return;
    }
    if (value === 'q' && !this.detail) return this.stop();
    if (value === '\u001b') {
      if (this.page === 'Plans' && this.detail && this.planView !== 'sections') {
        this.planView = 'sections';
        this.scroll = 0;
      } else if (this.detail) {
        this.detail = null;
        this.snapshot.detail = null;
        this.scroll = 0;
      } else return this.stop();
      return;
    }
    if (this.detail && this.page === 'Plans') {
      const detail = this.snapshot.detail;
      if (value === ESCAPES.up || value === 'k') {
        if (this.planView === 'sections') this.detailIndex = Math.max(0, this.detailIndex - 1);
        else this.scroll = Math.max(0, this.scroll - 1);
      } else if (value === ESCAPES.down || value === 'j') {
        if (this.planView === 'sections') this.detailIndex = Math.min(detail.sections.length - 1, this.detailIndex + 1);
        else this.scroll += 1;
      } else if (value === ESCAPES.pageUp)
        this.scroll = Math.max(0, this.scroll - Math.max(1, (this.output.rows || 24) - 8));
      else if (value === ESCAPES.pageDown) this.scroll += Math.max(1, (this.output.rows || 24) - 8);
      else if (value === ESCAPES.left && detail.version > 1) {
        this.detail.version -= 1;
        this.planView = 'sections';
        await this.refresh(true);
      } else if (value === ESCAPES.right && detail.version < detail.currentVersion) {
        this.detail.version += 1;
        this.planView = 'sections';
        await this.refresh(true);
      } else if (value === '\r' && this.planView === 'sections') {
        this.planView = 'read';
        this.scroll = 0;
      } else if (value === 'd' && detail.version > 1) {
        this.planView = this.planView === 'diff' ? 'sections' : 'diff';
        this.scroll = 0;
      } else if (value === 'a' && this.planView !== 'diff') {
        const section = detail.sections[this.detailIndex];
        await this.runAction('plans-action', {
          name: 'toggle-approval',
          id: detail.id,
          version: detail.version,
          sectionId: section.id
        });
      } else if (value === 'e' && detail.executable)
        this.startConfirmation(
          'execute',
          { id: detail.id, version: detail.version },
          `Execute ${detail.name} v${detail.version}?`,
          detail.version < detail.currentVersion
            ? `A newer v${detail.currentVersion} exists; execution will remain pinned to this approved version.`
            : 'The approved plan will be frozen and worker execution will begin.'
        );
      return;
    }
    if (this.detail && this.page === 'Reviews') {
      const detail = this.snapshot.detail;
      const descriptor = stateDescriptor(detail);
      if (value === ESCAPES.up || value === 'k') this.reviewView.scroll(-1);
      else if (value === ESCAPES.down || value === 'j') this.reviewView.scroll(1);
      else if (value === ESCAPES.pageUp) this.reviewView.page(-1);
      else if (value === ESCAPES.pageDown) this.reviewView.page(1);
      else if (value === 'u') this.reviewView.removeLastSelection();
      else if (value === 'x') this.reviewView.clearSelections();
      else if (value === 'a' && descriptor.actions.includes('accept'))
        await this.runAction('reviews-action', {
          name: 'accept',
          executionId: detail.executionId,
          itemId: detail.itemId
        });
      else if (value === 'f' && descriptor.actions.includes('feedback'))
        this.startInput(
          detail.kind === 'final' ? 'remedy' : 'feedback',
          detail.id,
          '',
          detail.kind === 'final' ? 'Optional remedy guidance' : 'Feedback (selected diff excerpts will be included)'
        );
      else if (value === 'r' && descriptor.actions.includes('remedy'))
        this.startInput('remedy', detail.id, '', 'Optional remedy guidance');
      else if (value === 'i' && descriptor.actions.includes('integrate'))
        this.startConfirmation(
          'integrate',
          detail,
          'Integrate this verified result?',
          'The frozen target advances only after the guarded integration checks.'
        );
      else if (value === 'o' && descriptor.actions.includes('override'))
        this.startConfirmation(
          'override',
          detail,
          'Override failed verification?',
          'This may integrate a broken result and should be used only with explicit intent.'
        );
      return;
    }
    if (value === ESCAPES.up || value === 'k') this.moveSelection(-1);
    else if (value === ESCAPES.down || value === 'j') this.moveSelection(1);
    else if (value === ESCAPES.pageUp) this.moveSelection(-Math.max(1, (this.output.rows || 24) - 7));
    else if (value === ESCAPES.pageDown) this.moveSelection(Math.max(1, (this.output.rows || 24) - 7));
    else if (value === ESCAPES.left) {
      const row = this.selectedRow();
      if (row) {
        this.expanded.delete(row.group.id);
        this.selectionKey = `group:${row.group.id}`;
        this.reconcileSelection();
      }
    } else if (value === ESCAPES.right && this.selectedRow()?.kind === 'group') {
      this.expanded.add(this.selectedRow().group.id);
      this.reconcileSelection();
    } else if (value === '\r') await this.activateSelection();
    else if (value === 'r') {
      const row = this.selectedRow();
      if (row?.kind === 'group') this.startInput('rename-session', row.group.id, row.group.name, 'Rename session');
      else if (this.page === 'Plans' && row?.kind === 'item')
        this.startInput('rename-plan', row.item.id, row.item.name, 'Rename plan');
    } else if (value === 'd') {
      const row = this.selectedRow();
      if (this.page === 'Sessions' && row?.kind === 'agent')
        this.startConfirmation(
          ['delegator', 'direct'].includes(row.item.role) ? 'delete-session' : 'delete-agent',
          ['delegator', 'direct'].includes(row.item.role) ? row.group : row.item,
          `Delete ${['delegator', 'direct'].includes(row.item.role) ? row.group.name : row.item.name}?`,
          ['delegator', 'direct'].includes(row.item.role)
            ? 'The primary owns this session, so every managed agent in it is removed after active-execution checks.'
            : 'Only this managed agent is removed. Provider history and Git commits are not rewritten.'
        );
      else if (this.page === 'Sessions' && row?.kind === 'group')
        this.startConfirmation(
          'delete-session',
          row.group,
          `Delete ${row.group.name}?`,
          'Every managed agent in this session is removed after active-execution checks.'
        );
      else if (this.page === 'Plans' && row?.kind === 'item')
        this.startConfirmation(
          'delete-plan',
          row.item,
          `Delete ${row.item.name}?`,
          'The complete durable plan lineage and its versions are removed.'
        );
    } else if (value === 'D') {
      const row = this.selectedRow();
      if (this.page === 'Sessions' && row)
        this.startConfirmation(
          'delete-session',
          row.group,
          `Delete ${row.group.name}?`,
          'Every managed agent in this session is removed after active-execution checks.'
        );
      else if (this.page === 'Plans' && row?.kind === 'item')
        this.startConfirmation(
          'delete-session-plans',
          row.item,
          `Delete plans for ${row.group.name}?`,
          'Only plans created by this planning session are removed.'
        );
    }
  }
  async handleMouse(mouse) {
    if ((mouse.button & 4) !== 0) return;
    const wheel = mouse.final === 'M' && (mouse.button & 64) !== 0;
    if (wheel) {
      const delta = (mouse.button & 1) === 0 ? -3 : 3;
      if (this.page === 'Reviews' && this.detail) this.reviewView.scroll(delta);
      else {
        this.scroll = Math.max(0, this.scroll + delta);
        this.followSelection = false;
      }
      return;
    }
    if (this.page === 'Reviews' && this.detail && this.reviewView.handleMouse(mouse)) return;
    const hit = this.hits.find((candidate) => candidate.row === mouse.row);
    if (!hit || mouse.final !== 'M' || mouse.button !== 0) return;
    const previous = this.selectionKey;
    this.selectionKey = hit.key;
    this.reconcileSelection();
    if (previous === hit.key) await this.activateSelection();
  }
  async key(value) {
    if (value === '\u001b' && !this.snapshot) return this.stop();
    if (this.page === 'Shutdown') {
      if (value === 'q') return this.stop();
      if (value === '\r') {
        await request(this.socket, 'shutdown');
        return this.stop();
      }
      return;
    }
    if (this.snapshot) {
      const mouse = mouseEvent(value);
      if (mouse) await this.handleMouse(mouse);
      else await this.workflowKey(value);
      this.draw();
      return;
    }
    if (this.wizard) {
      const typing = this.wizard.acceptsText();
      if (value === 'q' && !typing) return this.stop();
      const config = this.wizard.handle(
        !typing && value === 'j' ? ESCAPES.down : !typing && value === 'k' ? ESCAPES.up : value
      );
      if (config) {
        await request(this.socket, 'create', { config });
        return this.stop();
      }
      this.draw();
      return;
    }
    if (value === 'q') return this.stop();
    if (this.detail) {
      if (value === '\u001b[A' || value === 'k') this.detailIndex = Math.max(0, this.detailIndex - 1);
      else if (value === '\u001b[B' || value === 'j')
        this.detailIndex = Math.min(this.detail.lines.length - 1, this.detailIndex + 1);
      else if (value === 'v') this.rangeStart = this.detailIndex;
      else if (value === '\r' && this.rangeStart !== null) {
        const start = Math.min(this.rangeStart, this.detailIndex);
        const end = Math.max(this.rangeStart, this.detailIndex);
        await request(this.socket, 'review-excerpt', {
          id: this.detail.id,
          start,
          end,
          lines: this.detail.lines.slice(start, end + 1)
        });
        this.rangeStart = null;
      }
      this.draw();
      return;
    }
    if (value === '\u001b[A' || value === 'k') this.selection = Math.max(0, this.selection - 1);
    else if (value === '\u001b[B' || value === 'j')
      this.selection = Math.min(this.items.length - 1, this.selection + 1);
    else if (value === 'd' || value === 'D') {
      const item = this.items[this.selection];
      if (item && ['Sessions', 'Plans'].includes(this.page)) this.confirmation = { item, cascade: value === 'D' };
    } else if (value === '\r' && this.confirmation) {
      const { item, cascade } = this.confirmation;
      await request(this.socket, this.page === 'Sessions' ? 'delete-session' : 'delete-plan', {
        id: item.id,
        ...(this.page === 'Sessions' ? { cascade } : { sessionPlans: cascade })
      });
      this.confirmation = null;
      this.items = await request(this.socket, 'rows', { page: this.page });
      this.selection = Math.min(this.selection, Math.max(0, this.items.length - 1));
    } else if (value === '\r') {
      const item = this.items[this.selection];
      if (item && this.page === 'Sessions') {
        await request(this.socket, 'open', { sessionId: item.id });
        // Keep compatibility with supervisors started by older releases where
        // opening an existing session did not also focus its pane.
        await request(this.socket, 'focus', { sessionId: item.id });
        return this.stop();
      } else if (item && this.page === 'Reviews') {
        this.detail = await request(this.socket, 'review-detail', { id: item.id });
        this.detailIndex = 0;
      }
    }
    this.draw();
  }
  async start() {
    await this.load();
    this.input.setRawMode?.(true);
    this.input.resume?.();
    this.input.setEncoding?.('utf8');
    this.onData = (data) => {
      for (const value of inputTokens(data)) void this.key(value).catch((error) => this.showError(error));
    };
    this.input.on('data', this.onData);
    if (this.snapshot)
      this.unsubscribe = subscribe(this.socket, () => {
        void this.refresh()
          .then(() => this.draw())
          .catch((error) => this.showError(error));
      });
    this.output.write('\u001b[?1000h\u001b[?1006h\u001b[?25l');
    this.draw();
  }
  showError(error) {
    if (this.snapshot) this.startConfirmation('error', {}, error.message, 'Esc returns to the surface.');
    else this.confirmation = `${error.message}`;
    this.draw();
  }
  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.unsubscribe?.();
    this.input.off?.('data', this.onData);
    this.input.setRawMode?.(false);
    this.input.pause?.();
    this.output.write('\u001b[?1006l\u001b[?1000l\u001b[?25h');
    process.exitCode = 0;
  }
}

module.exports = {
  ANSI,
  ESCAPES,
  inputTokens,
  mouseEvent,
  stripAnsi,
  fitLine,
  entityRow,
  popupLines,
  PopupClient
};
