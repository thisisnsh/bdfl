'use strict';
const { EventEmitter } = require('node:events');
const test = require('node:test');
const assert = require('node:assert/strict');
const pkg = require('../../package.json');
const { HELP, run } = require('../../src/cli');
const {
  ISSUE_URL,
  REPOSITORY_URL,
  RESTORE_TERMINAL,
  errorDetails,
  formatErrorReport,
  installFatalErrorHandlers,
  externalOpenCommand,
  openIssue,
  openRepository
} = require('../../src/core/errors');

function io() {
  const processLike = new EventEmitter();
  processLike.env = { NO_COLOR: '1' };
  processLike.stdin = { isTTY: true };
  processLike.stdout = {
    isTTY: true,
    value: '',
    write(value) {
      this.value += value;
    }
  };
  processLike.stderr = {
    isTTY: false,
    value: '',
    write(value) {
      this.value += value;
    }
  };
  return processLike;
}

test('parses coded and unexpected errors into safe one-line details', () => {
  const coded = new Error('Reset\nthis workspace\u001b[31m');
  coded.code = 'RESET_REQUIRED';
  assert.deepEqual(errorDetails(coded), { code: 'RESET_REQUIRED', message: 'Reset this workspace' });
  assert.deepEqual(errorDetails(new TypeError('bad input')), { code: 'TYPE_ERROR', message: 'bad input' });
  assert.deepEqual(errorDetails('broken'), { code: 'UNEXPECTED_ERROR', message: 'broken' });
});
test('formats errors with code, message, environment, and the repository issue link but no stack', () => {
  const error = new Error('Readable failure');
  error.code = 'READABLE_FAILURE';
  const report = formatErrorReport(error, { version: '1.2.3', nodeVersion: 'v24.1.0' });
  assert.match(report, /BDFL encountered an error/);
  assert.match(report, /Code\s+READABLE_FAILURE/);
  assert.match(report, /Message\s+Readable failure/);
  assert.match(report, /BDFL 1\.2\.3 · Node v24\.1\.0/);
  assert.match(report, new RegExp(ISSUE_URL.replaceAll('/', '\\/')));
  assert.doesNotMatch(report, /at .*\.js:/);
});
test('the CLI catches startup errors, restores the terminal, and exits without a raw stack', () => {
  const streams = io();
  const error = new Error("Remove this repository's .bdfl directory.");
  error.code = 'RESET_REQUIRED';
  const code = run(
    [],
    streams,
    '/tmp/workspace',
    () => ({
      start() {
        throw error;
      }
    }),
    () => Promise.resolve()
  );
  assert.equal(code, 1);
  assert.equal(streams.stdout.value, RESTORE_TERMINAL);
  assert.match(streams.stderr.value, /RESET_REQUIRED/);
  assert.match(streams.stderr.value, /Remove this repository's \.bdfl directory\./);
  assert.match(streams.stderr.value, new RegExp(ISSUE_URL.replaceAll('/', '\\/')));
  assert.match(streams.stderr.value, new RegExp(`BDFL ${pkg.version.replaceAll('.', '\\.')}`));
  assert.doesNotMatch(streams.stderr.value, /WorkspaceStore\.load|at .*\.js:/);
});
test('the CLI documents direct controls and enables provider bypass only for standalone --dangerous', () => {
  const streams = io();
  let options;
  const code = run(
    ['--dangerous'],
    streams,
    '/tmp/workspace',
    (_root, value) => {
      options = value;
      return { start() {} };
    },
    () => Promise.resolve()
  );
  assert.equal(code, 0);
  assert.equal(options.dangerous, true);
  assert.match(HELP, /--dangerous/);
  assert.match(HELP, /tmux 3\.2/);
  assert.match(HELP, /C-b N\/P\/S\/R/);
  assert.match(HELP, /D deletes plans for the selected session/);
  const invalid = io();
  assert.equal(
    run(['--dangerous', 'status'], invalid, '/tmp/workspace', undefined, () => Promise.resolve()),
    1
  );
  assert.match(invalid.stderr.value, /Unknown command: --dangerous/);
});
test('fatal exception handlers use the same report before exiting', () => {
  const streams = io();
  const exits = [];
  const remove = installFatalErrorHandlers(streams, {
    version: 'test',
    exit(code) {
      exits.push(code);
    }
  });
  const error = new Error('Async failure');
  error.code = 'ASYNC_FAILURE';
  streams.emit('unhandledRejection', error);
  assert.deepEqual(exits, [1]);
  assert.match(streams.stderr.value, /ASYNC_FAILURE/);
  assert.equal(streams.stdout.value, RESTORE_TERMINAL);
  remove();
});
test('external links use exact repository URLs and platform launchers without a shell', async () => {
  assert.deepEqual(externalOpenCommand(ISSUE_URL, 'darwin'), { command: 'open', args: [ISSUE_URL] });
  assert.deepEqual(externalOpenCommand(REPOSITORY_URL, 'linux'), { command: 'xdg-open', args: [REPOSITORY_URL] });
  assert.deepEqual(externalOpenCommand(REPOSITORY_URL, 'win32'), {
    command: 'cmd.exe',
    args: ['/d', '/s', '/c', 'start', '', REPOSITORY_URL]
  });
  const launches = [];
  const spawn = (command, args, options) => {
    const child = new EventEmitter();
    child.unref = () => {
      child.unreferenced = true;
    };
    launches.push({ command, args, options, child });
    process.nextTick(() => child.emit('spawn'));
    return child;
  };
  await openIssue({ platform: 'darwin', spawn });
  await openRepository({ platform: 'linux', spawn });
  assert.deepEqual(
    launches.map(({ command, args }) => [command, args]),
    [
      ['open', [ISSUE_URL]],
      ['xdg-open', [REPOSITORY_URL]]
    ]
  );
  for (const launch of launches) {
    assert.equal(launch.options.shell, false);
    assert.equal(launch.options.detached, true);
    assert.equal(launch.options.stdio, 'ignore');
    assert.equal(launch.child.unreferenced, true);
  }
});
test('external launch errors reject with a reportable stable code', async () => {
  const spawn = () => {
    const child = new EventEmitter();
    process.nextTick(() => child.emit('error', new Error('missing opener')));
    return child;
  };
  await assert.rejects(
    openIssue({ platform: 'linux', spawn }),
    (error) => error.code === 'OPEN_EXTERNAL_FAILED' && /missing opener/.test(error.message)
  );
});
