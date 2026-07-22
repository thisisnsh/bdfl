'use strict';

const ISSUE_URL = 'https://github.com/thisisnsh/bdfl/issues/new';
const RESTORE_TERMINAL = '\u001b[?1006l\u001b[?1000l\u001b[?25h\u001b[?1049l';

function clean(value, fallback) { const result = `${value ?? ''}`.replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/gu, '').replace(/\u001b\[[0-?]*[ -/]*[@-~]/gu, '').replace(/[\u0000-\u001f\u007f-\u009f]/gu, ' ').replace(/\s+/gu, ' ').trim(); return result || fallback; }
function errorDetails(error) {
  const value = error && typeof error === 'object' ? error : null; const rawCode = value?.code || (value?.name && value.name !== 'Error' ? value.name : 'UNEXPECTED_ERROR');
  const code = clean(rawCode, 'UNEXPECTED_ERROR').replace(/([a-z\d])([A-Z])/g, '$1_$2').replace(/[^a-z\d_-]+/giu, '_').toUpperCase().slice(0, 64) || 'UNEXPECTED_ERROR';
  const message = clean(value?.message ?? error, 'An unexpected error occurred.'); return { code, message };
}
function formatErrorReport(error, { version = 'unknown', nodeVersion = process.version, color = false } = {}) {
  const { code, message } = errorDetails(error); const paint = color ? { red: '\u001b[38;5;203m', yellow: '\u001b[38;5;220m', cyan: '\u001b[38;5;81m', bold: '\u001b[1m', reset: '\u001b[0m' } : { red: '', yellow: '', cyan: '', bold: '', reset: '' };
  return ['', `${paint.red}${paint.bold}BDFL encountered an error.${paint.reset}`, '', `  ${paint.bold}Code${paint.reset}     ${paint.yellow}${code}${paint.reset}`, `  ${paint.bold}Message${paint.reset}  ${message}`, '', `  BDFL ${clean(version, 'unknown')} · Node ${clean(nodeVersion, 'unknown')}`, '', 'Please open an issue and include the code and message:', `  ${paint.cyan}${ISSUE_URL}${paint.reset}`, ''].join('\n');
}
function restoreTerminal(output) { if (output?.isTTY) output.write(RESTORE_TERMINAL); }
function reportError(error, io = process, { version = 'unknown', restore = true, nodeVersion = process.version } = {}) { if (restore) restoreTerminal(io.stdout); const report = formatErrorReport(error, { version, nodeVersion, color: Boolean(io.stderr?.isTTY && !io.env?.NO_COLOR) }); io.stderr.write(`${report}\n`); return errorDetails(error); }
function installFatalErrorHandlers(io = process, { version = 'unknown', exit = (code) => process.exit(code) } = {}) { let handling = false; const fatal = (error) => { if (handling) return exit(1); handling = true; reportError(error, io, { version }); exit(1); }; io.on('uncaughtException', fatal); io.on('unhandledRejection', fatal); return () => { io.off('uncaughtException', fatal); io.off('unhandledRejection', fatal); }; }

module.exports = { ISSUE_URL, RESTORE_TERMINAL, clean, errorDetails, formatErrorReport, restoreTerminal, reportError, installFatalErrorHandlers };
