'use strict';

const VALID = new Set(['default', 'accept-edits', 'read-only', 'full-access']);

function mapPermissionMode(host, parentMode) {
  if (!['claude', 'codex'].includes(host)) throw new Error(`Unsupported host: ${host}`);
  if (parentMode === 'plan') return 'default';
  if (!VALID.has(parentMode)) throw new Error(`Unsupported permission mode: ${parentMode}`);
  return parentMode;
}

function assertPermissionRequest(currentMode, requestedMode) {
  if (currentMode === requestedMode) return currentMode;
  throw new Error(`Permission change requires parent approval: ${currentMode} -> ${requestedMode}`);
}

module.exports = { mapPermissionMode, assertPermissionRequest };

