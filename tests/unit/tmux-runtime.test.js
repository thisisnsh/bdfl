'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const {
  parseTmuxVersion,
  supportedTmux,
  installationGuidance,
  requireTmux,
  runtimePaths
} = require('../../src/tmux/command');
const { tmuxConfig } = require('../../src/tmux/config');
const { paneRows, clientWidths, FIELD_SEPARATOR } = require('../../src/tmux/server');
const { parseControlLine } = require('../../src/tmux/control');
const { readLaunchDescriptor } = require('../../src/tmux/pane-helper');
const { cellWidth, cropCells, fitsRail } = require('../../src/tmux/cells');
const { agentLabel, statusToken, agentRail } = require('../../src/tmux/status');
const { encodeMessage, createDecoder, listen, request, subscribe } = require('../../src/daemon/protocol');
const { popupLines } = require('../../src/tui/popup');

test('parses the tmux compatibility floor and gives platform-specific installation help', () => {
  assert.deepEqual(parseTmuxVersion('tmux 3.2a'), { major: 3, minor: 2, suffix: 'a' });
  assert.equal(supportedTmux('tmux 3.1c'), false);
  assert.equal(supportedTmux('tmux 3.2'), true);
  assert.equal(supportedTmux('tmux 4.0'), true);
  assert.match(installationGuidance('darwin'), /brew install tmux/);
  assert.match(installationGuidance('linux'), /apt install tmux/);
  assert.throws(
    () => requireTmux({ command: () => 'tmux 3.1', platform: 'linux' }),
    (error) => error.code === 'TMUX_TOO_OLD' && /apt install tmux/.test(error.message)
  );
  assert.throws(
    () =>
      requireTmux({
        command() {
          throw new Error('missing');
        },
        platform: 'darwin'
      }),
    (error) => error.code === 'TMUX_REQUIRED' && /brew install tmux/.test(error.message)
  );
});

test('generates an isolated clickable tmux configuration with consistent session and agent navigation', () => {
  const root = '/tmp/bdfl package';
  const paths = runtimePaths(root);
  const config = tmuxConfig({ packageRoot: root, daemonSocket: paths.daemonSocket });
  assert.match(config, /set -g mouse on/);
  assert.match(config, /set -g history-limit 5000/);
  assert.match(config, /set -g remain-on-exit on/);
  assert.match(config, /set -g status 2/);
  assert.match(config, /pane-border-status off/);
  assert.match(config, /bind N display-popup/);
  assert.match(config, /bind n display-popup/);
  assert.match(config, /bind Q display-popup .*Shutdown/);
  assert.match(config, /bind Left if-shell .*focus-relative/);
  assert.match(config, /bind Right if-shell .*focus-relative/);
  assert.match(config, /bind o run-shell .*toggle-overview/);
  assert.match(config, /bind Enter if-shell/);
  assert.match(config, /bind \? display-popup/);
  assert.match(config, /bind -T root MouseDown1Control2 display-popup/);
  assert.doesNotMatch(config, /bind C-c/);
});

test('parses tmux pane and control notifications without constructing a VT buffer', () => {
  const row = ['%1', '@2', 'session-1', 'workstream-1', '0', '1', '1', '1'].join(FIELD_SEPARATOR);
  assert.deepEqual(paneRows(row), [
    {
      paneId: '%1',
      windowId: '@2',
      sessionId: 'session-1',
      workstreamId: 'workstream-1',
      dead: '0',
      active: '1',
      windowActive: '1',
      zoomed: '1'
    }
  ]);
  assert.deepEqual(clientWidths('120\n80\n'), [120, 80]);
  assert.deepEqual(parseControlLine('%output %1 hello\\040world'), {
    type: 'output',
    paneId: '%1',
    data: 'hello world'
  });
  assert.deepEqual(parseControlLine('%pane-exited %1 2'), { type: 'exit', paneId: '%1', code: 2 });
});

test('validates safe mode-0600 launch descriptors and rejects group-readable data', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bdfl-descriptor-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'launch.json');
  const value = { schema: 1, sessionId: 's', command: '/bin/echo', args: ['hello world'], cwd: directory, env: {} };
  fs.writeFileSync(file, JSON.stringify(value), { mode: 0o600 });
  assert.deepEqual(readLaunchDescriptor(file), value);
  fs.chmodSync(file, 0o640);
  assert.throws(() => readLaunchDescriptor(file), /Unsafe/);
});

test('uses rendered terminal cells for canonical labels and admission', () => {
  const session = { name: '構築 agent', role: 'worker', turnState: 'working' };
  assert.equal(cellWidth('構築'), 4);
  assert.equal(statusToken(session), 'Working');
  assert.match(agentLabel(session), /構築 agent worker Working/);
  assert.equal(cropCells('構築 agent', 6), '構築 …');
  assert.equal(fitsRail(['one', '構築'], 8), true);
  assert.equal(fitsRail(['one', '構築'], 7), false);
});

test('builds one safe global rail centered on the active agent', () => {
  const workspace = {
    workstreams: [
      { id: 'one', name: 'First # session' },
      { id: 'two', name: 'Second session' }
    ],
    sessions: [
      { id: 'a', workstreamId: 'one', name: 'Planning', paneNumber: 1, turnState: 'idle' },
      { id: 'b', workstreamId: 'one', name: 'Worker', paneNumber: 2, turnState: 'working' },
      { id: 'c', workstreamId: 'two', name: 'Review', paneNumber: 1, attention: true }
    ]
  };
  const panes = [
    { paneId: '%1', sessionId: 'a', workstreamId: 'one', dead: '0', active: '1', windowActive: '0' },
    { paneId: '%2', sessionId: 'b', workstreamId: 'one', dead: '0', active: '0', windowActive: '0' },
    { paneId: '%3', sessionId: 'c', workstreamId: 'two', dead: '0', active: '1', windowActive: '1' }
  ];
  const rail = agentRail(workspace, panes, 42);
  assert.match(rail, /range=pane\|%3/);
  assert.match(rail, /Second session/);
  assert.match(rail, /!/);
  assert.doesNotMatch(rail, /First # session/);
  assert.doesNotMatch(rail, /range=pane\|[^%]/);
});

test('decodes fragmented JSON protocol messages and popup rows start with one blank line', () => {
  const messages = [];
  const decode = createDecoder((value) => messages.push(value));
  const encoded = encodeMessage({ id: 1, action: 'state' });
  decode(encoded.slice(0, 4));
  decode(encoded.slice(4));
  assert.deepEqual(messages, [{ id: 1, action: 'state' }]);
  const lines = popupLines('Sessions', [{ name: 'Worker 2', agent: 'Worker 2', status: 'Idle' }]);
  assert.equal(lines[0], '');
  assert.match(lines[1], /↑\/↓ or j\/k/);
  assert.match(lines[3], /Worker 2/);
});

test('serves UI actions over a private mode-0600 Unix socket', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bdfl-protocol-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const socket = path.join(directory, 'supervisor.sock');
  const server = listen(socket, ({ action }) => ({ action, owner: 'daemon' }));
  t.after(() => server.close());
  await once(server, 'listening');
  assert.equal(fs.statSync(socket).mode & 0o777, 0o600);
  assert.deepEqual(await request(socket, 'state'), { action: 'state', owner: 'daemon' });
});

test('streams daemon-owned state subscriptions on the same private protocol', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bdfl-subscription-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const socket = path.join(directory, 'supervisor.sock');
  const server = listen(socket, (_request, client) => {
    setImmediate(() => client.write(encodeMessage({ event: 'state', state: { revision: 2 } })));
    return { subscribed: true };
  });
  t.after(() => server.close());
  await once(server, 'listening');
  const state = new Promise((resolve) => {
    const close = subscribe(socket, (value) => {
      close();
      resolve(value);
    });
  });
  assert.deepEqual(await state, { revision: 2 });
});
