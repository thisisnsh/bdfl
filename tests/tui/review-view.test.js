'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { COLORS, ReviewView, parsePatch, renderPatch, stateDescriptor } = require('../../src/tui/review-view');

const PATCH = [
  'diff --git a/old.js b/new.js',
  'similarity index 90%',
  'rename from old.js',
  'rename to new.js',
  'index 1111111..2222222 100644',
  '--- a/old.js',
  '+++ b/new.js',
  '@@ -1,2 +1,3 @@ function example()',
  '-const oldValue = a very long removed value;',
  '+const newValue = a very long replacement value;',
  ' unchanged();'
].join('\n');

test('parses file, hunk, and source coordinates and colors every wrapped patch row', () => {
  const parsed = parsePatch(PATCH);
  assert.equal(parsed[0].file, 'new.js');
  assert.equal(parsed[7].hunk, '@@ -1,2 +1,3 @@ function example()');
  assert.equal(parsed[9].sourceLine, 10);

  const rows = renderPatch(PATCH, 18);
  assert.ok(rows.filter((row) => row.sourceLine === 10).length > 1);
  assert.ok(
    rows.filter((row) => row.sourceLine === 10).every((row) => row.file === 'new.js' && row.hunk === parsed[7].hunk)
  );
  assert.ok(rows.filter((row) => row.type === 'file').every((row) => row.styled.startsWith(COLORS.blue)));
  assert.ok(rows.filter((row) => row.type === 'hunk').every((row) => row.styled.startsWith(COLORS.cyan)));
  assert.ok(rows.filter((row) => row.type === 'addition').every((row) => row.styled.startsWith(COLORS.green)));
  assert.ok(rows.filter((row) => row.type === 'removal').every((row) => row.styled.startsWith(COLORS.red)));
});

test('mouse drags append ordered scoped ranges, highlight them, and preserve outside selection', () => {
  const view = new ReviewView({ columns: 24, viewportHeight: 40 }).open({
    executionId: 'e',
    id: 'c',
    status: 'review',
    diff: PATCH
  });
  let frame = view.render({ bodyTop: 5, bodyLeft: 3, bodyWidth: 24 });
  const removal = frame.rows.find((row) => row.patch && row.sourceLine === 9);
  const addition = frame.rows.filter((row) => row.patch && row.sourceLine === 10).at(-1);
  assert.equal(view.handleMouse({ final: 'M', button: 0, row: 1, column: 1 }), false);
  assert.equal(view.handleMouse({ final: 'M', button: 0, row: removal.screenRow, column: 4 }), true);
  assert.equal(view.handleMouse({ final: 'M', button: 32, row: addition.screenRow, column: 4 }), true);
  assert.equal(view.handleMouse({ final: 'm', button: 0, row: addition.screenRow, column: 4 }), true);
  assert.deepEqual(view.selections(), [
    {
      file: 'new.js',
      hunk: '@@ -1,2 +1,3 @@ function example()',
      startLine: 9,
      endLine: 10,
      text: '-const oldValue = a very long removed value;\n+const newValue = a very long replacement value;'
    }
  ]);

  frame = view.render({ bodyTop: 5, bodyLeft: 3, bodyWidth: 24 });
  assert.ok(
    frame.rows
      .filter((row) => [9, 10].includes(row.sourceLine))
      .every((row) => row.selected && row.styled.includes(COLORS.inverse))
  );
  const context = frame.rows.find((row) => row.patch && row.sourceLine === 11);
  view.handleMouse({ final: 'M', button: 0, row: context.screenRow, column: 4 });
  view.handleMouse({ final: 'm', button: 0, row: context.screenRow, column: 4 });
  assert.deepEqual(
    view.selections().map(({ startLine, endLine }) => [startLine, endLine]),
    [
      [9, 10],
      [11, 11]
    ]
  );
  assert.equal(view.removeLastSelection(), true);
  assert.deepEqual(
    view.selections().map(({ startLine }) => startLine),
    [9]
  );
  assert.deepEqual(
    view.feedback('Fix this').selections.map(({ startLine }) => startLine),
    [9]
  );
  view.clearSelections();
  assert.deepEqual(view.selections(), []);
  assert.deepEqual(view.feedback('No excerpt').selections, []);
  assert.equal(view.removeLastSelection(), false);
});

test('ignores patch rows that cannot produce a normalized file-and-hunk selection', () => {
  const view = new ReviewView({ columns: 80, viewportHeight: 40 }).open({
    executionId: 'e',
    id: 'c',
    status: 'review',
    diff: PATCH
  });
  assert.deepEqual(view.rangesForVisualSpan(0, 6), []);
  const hunk = renderPatch(PATCH, 80).find((row) => row.sourceLine === 8);
  assert.deepEqual(view.rangesForVisualSpan(hunk.visualLine, hunk.visualLine), [
    {
      file: 'new.js',
      hunk: '@@ -1,2 +1,3 @@ function example()',
      startLine: 8,
      endLine: 8,
      text: '@@ -1,2 +1,3 @@ function example()'
    }
  ]);
});

test('serializes all selections in selection order and renders durable feedback excerpts', () => {
  const item = {
    executionId: 'e',
    id: 'c',
    status: 'running',
    diff: PATCH,
    feedback: [
      {
        at: 'now',
        message: 'Please revise',
        selections: [{ file: 'new.js', hunk: '@@ hunk', startLine: 9, endLine: 10, text: '-old\n+new' }]
      }
    ]
  };
  const view = new ReviewView({ columns: 80, viewportHeight: 50 }).open(item);
  view.beginSelection(8);
  view.finishSelection(8);
  view.beginSelection(10);
  view.finishSelection(10);
  const payload = view.feedback('Fix both');
  assert.equal(payload.message, 'Fix both');
  assert.deepEqual(
    payload.selections.map(({ startLine }) => startLine),
    [9, 11]
  );
  const content = view.render().lines.join('\n');
  assert.match(content, /Feedback · now/);
  assert.match(content, /Please revise/);
  assert.match(content, /new\.js · @@ hunk · lines 9-10/);
  assert.match(content, /-old\n\+new/);
  assert.equal(stateDescriptor(item).label, 'Feedback sent · Revising');
});

test('one scroll operation clamps line, wheel, page, resize, shrink, selection, and state transitions', () => {
  const long = {
    executionId: 'e',
    id: 'c',
    status: 'review',
    diff: `${PATCH}\n${Array.from({ length: 20 }, (_, index) => ` line ${index}`).join('\n')}`
  };
  const view = new ReviewView({ columns: 30, viewportHeight: 5 }).open(long);
  assert.equal(view.scroll(-100), 0);
  assert.equal(view.scroll(10000), view.maximumScroll());
  assert.equal(view.page(1), view.maximumScroll());
  view.resize(200, 50);
  assert.equal(view.state().scroll, view.maximumScroll());
  view.update({ ...long, status: 'accepted', diff: '+short' });
  assert.equal(view.state().scroll, 0);
  view.beginSelection(0);
  view.finishSelection(0);
  assert.equal(view.state().scroll, 0);
  assert.ok(view.render().offset >= 0 && view.render().offset <= view.render().maxScroll);
});

test('keeps item state by durable identity and exposes immediate labels with distinct confirmations', () => {
  const view = new ReviewView().open({ executionId: 'e', id: 'one', status: 'review', diff: PATCH });
  view.beginSelection(8);
  view.finishSelection(8);
  view.open({ executionId: 'e', id: 'two', status: 'accepted', diff: '+two' });
  assert.deepEqual(view.selections(), []);
  view.open({ executionId: 'e', id: 'one', status: 'review', diff: PATCH });
  assert.equal(view.selections().length, 1);

  const labels = [
    'accepted',
    'running',
    'checking',
    'verifying',
    'failed',
    'retrying',
    'integration-queued',
    'integrating',
    'integration-conflict',
    'integration-review',
    'complete'
  ].map((status) => stateDescriptor({ status, feedback: status === 'running' ? [{}] : [] }).label);
  assert.deepEqual(labels, [
    'Accepted',
    'Feedback sent · Revising',
    'Checking',
    'Verifying',
    'Failed',
    'Retrying',
    'Integrating',
    'Integrating',
    'Integration repair',
    'Ready to integrate',
    'Complete'
  ]);
  assert.deepEqual(stateDescriptor({ status: 'failed', kind: 'chunk' }).actions, ['feedback']);

  view.update({ executionId: 'e', id: 'one', status: 'verification-failed', diff: '+one' });
  assert.deepEqual(view.requestAction('remedy'), { action: 'confirm-remedy' });
  view.update({ executionId: 'e', id: 'one', status: 'integration-checking', diff: '+one' });
  assert.equal(view.state().confirmation, null);
  view.update({ executionId: 'e', id: 'one', status: 'verification-failed', diff: '+one' });
  assert.deepEqual(view.requestAction('remedy'), { action: 'confirm-remedy' });
  assert.deepEqual(view.confirmAction(), { action: 'remedy' });
  assert.deepEqual(view.requestAction('override'), { action: 'confirm-override' });
  assert.equal(view.state().confirmationChoice, 'cancel');
  view.moveConfirmation();
  assert.deepEqual(view.confirmAction(), { action: 'override' });
  assert.notEqual(view.requestAction('remedy').action, view.requestAction('override').action);
  assert.deepEqual(stateDescriptor({ status: 'running', attention: true, feedback: [{}] }), {
    label: 'Needs response',
    tone: 'yellow',
    actions: ['feedback']
  });
});

test('mouse hit regions begin at the rendered content origin and exclude adjacent padding', () => {
  const view = new ReviewView({ columns: 24, viewportHeight: 40 }).open({
    executionId: 'e',
    id: 'c',
    status: 'review',
    diff: PATCH
  });
  const frame = view.render({ bodyTop: 5, bodyLeft: 4, bodyWidth: 24 });
  const patch = frame.rows.find((row) => row.patch);
  assert.equal(view.hit(patch.screenRow, 3), null);
  assert.ok(view.hit(patch.screenRow, 4));
  assert.ok(view.hit(patch.screenRow, 27));
  assert.equal(view.hit(patch.screenRow, 28), null);
});
