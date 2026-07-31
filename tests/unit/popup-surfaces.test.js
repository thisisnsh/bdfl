'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PopupClient, ESCAPES, stripAnsi } = require('../../src/tui/popup');

function terminal() {
  return {
    input: {
      setRawMode() {},
      pause() {},
      off() {}
    },
    output: {
      columns: 100,
      rows: 28,
      write() {}
    }
  };
}

function sessionsSnapshot(status = 'idle') {
  return {
    protocolVersion: 2,
    snapshotVersion: 1,
    page: 'Sessions',
    activeId: 'worker',
    groups: [
      {
        id: 'stream',
        name: 'Build feature',
        agents: [
          { id: 'planning', name: 'Planning', role: 'delegator', open: true, turnState: 'idle' },
          {
            id: 'worker',
            name: 'Worker 1',
            role: 'worker',
            open: true,
            turnState: status,
            taskSnippet: 'Implement the native workflow overlay'
          }
        ]
      }
    ]
  };
}

test('live Sessions refresh preserves selection by durable agent ID', () => {
  const client = new PopupClient('socket', 'Sessions', terminal());
  client.snapshot = sessionsSnapshot('working');
  client.expanded.add('stream');
  client.selectionKey = 'agent:worker';
  client.reconcileSelection();
  assert.equal(client.selectedRow().item.id, 'worker');
  client.snapshot = sessionsSnapshot('idle');
  client.reconcileSelection();
  assert.equal(client.selectionKey, 'agent:worker');
  assert.equal(client.selectedRow().item.turnState, 'idle');
  const output = stripAnsi(client.listPresentation().join('\n'));
  assert.match(output, /Build feature/);
  assert.match(output, /Implement the native workflow overlay/);
});

test('Sessions supports grouped collapse and one-action focus', async () => {
  const client = new PopupClient('socket', 'Sessions', terminal());
  client.snapshot = sessionsSnapshot();
  client.expanded.add('stream');
  client.selectionKey = 'agent:worker';
  client.reconcileSelection();
  const calls = [];
  client.runAction = async (action, params) => calls.push([action, params]);
  client.stop = () => calls.push(['stop']);
  await client.activateSelection();
  assert.deepEqual(calls, [['sessions-action', { name: 'focus', id: 'worker' }], ['stop']]);
  client.selectionKey = 'group:stream';
  client.reconcileSelection();
  await client.workflowKey(ESCAPES.left);
  assert.equal(client.expanded.has('stream'), false);
});

test('Plans navigate versions and sections through explicit guarded actions', async () => {
  const client = new PopupClient('socket', 'Plans', terminal());
  client.detail = { id: 'plan', version: 2 };
  client.snapshot = {
    protocolVersion: 2,
    page: 'Plans',
    plans: [],
    groups: [],
    detail: {
      id: 'plan',
      name: 'Native overlays',
      version: 2,
      currentVersion: 3,
      executable: true,
      executionStatus: 'Ready',
      sections: [
        { id: 'summary', title: 'Summary', approved: false, content: 'Summary body' },
        { id: 'shared', approved: true, content: 'Shared body' }
      ],
      diff: '- old\n+ new'
    }
  };
  const calls = [];
  client.runAction = async (action, params) => calls.push([action, params]);
  await client.workflowKey(ESCAPES.down);
  await client.workflowKey('a');
  assert.deepEqual(calls, [['plans-action', { name: 'toggle-approval', id: 'plan', version: 2, sectionId: 'shared' }]]);
  await client.workflowKey('e');
  assert.equal(client.confirmation.kind, 'execute');
  client.confirmation = null;
  await client.workflowKey('d');
  assert.equal(client.planView, 'diff');
  await client.workflowKey('\u001b');
  assert.equal(client.planView, 'sections');
});

test('Reviews expose complete action routing and preserve diff selections', async () => {
  const client = new PopupClient('socket', 'Reviews', terminal());
  client.detail = { id: 'execution:chunk' };
  client.snapshot = {
    protocolVersion: 2,
    page: 'Reviews',
    groups: [],
    items: [],
    detail: {
      id: 'execution:chunk',
      executionId: 'execution',
      itemId: 'chunk',
      kind: 'chunk',
      status: 'review',
      agentLabel: 'Worker 1',
      planTitle: 'Native overlays',
      summary: 'Implemented the overlay',
      diff: 'diff --git a/a.js b/a.js\n--- a/a.js\n+++ b/a.js\n@@ -1 +1 @@\n-old\n+new'
    }
  };
  client.reviewView.open(client.snapshot.detail);
  const rows = client.reviewView.resize(80, 10).patchRows();
  client.reviewView.beginSelection(rows.find((row) => row.text === '-old').visualLine);
  client.reviewView.finishSelection(rows.find((row) => row.text === '+new').visualLine);
  assert.equal(client.reviewView.selections().length, 1);
  const calls = [];
  client.runAction = async (action, params) => calls.push([action, params]);
  await client.workflowKey('a');
  assert.deepEqual(calls, [['reviews-action', { name: 'accept', executionId: 'execution', itemId: 'chunk' }]]);
  client.startInput('feedback', 'execution:chunk', 'Please revise', 'Feedback');
  await client.submitInput();
  assert.equal(calls[1][1].selections.length, 1);
});

test('final review feedback enters the confirmed remedy flow', async () => {
  const client = new PopupClient('socket', 'Reviews', terminal());
  client.detail = { id: 'execution:combined-result' };
  client.snapshot = {
    protocolVersion: 2,
    page: 'Reviews',
    groups: [],
    items: [],
    detail: {
      id: 'execution:combined-result',
      executionId: 'execution',
      itemId: 'combined-result',
      kind: 'final',
      status: 'verification-failed',
      agentLabel: 'Execution 1',
      planTitle: 'Native overlays',
      diff: ''
    }
  };
  client.reviewView.open(client.snapshot.detail);
  await client.workflowKey('f');
  assert.equal(client.inputState.kind, 'remedy');
  client.inputState.value = 'Repair every finding';
  await client.submitInput();
  assert.equal(client.confirmation.kind, 'remedy');
  assert.equal(client.confirmation.target.message, 'Repair every finding');
});
