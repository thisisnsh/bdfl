'use strict';

const fs = require('node:fs');
const path = require('node:path');

class CodexSessionIndex {
  constructor(directory, { io = fs, now = Date.now, maxAge = 7 * 24 * 60 * 60 * 1000 } = {}) {
    this.directory = directory;
    this.io = io;
    this.now = now;
    this.maxAge = maxAge;
    this.files = new Map();
    this.sessions = [];
  }
  refresh() {
    const found = [];
    const visit = (directory) => {
      let entries;
      try {
        entries = this.io.readdirSync(directory, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) visit(file);
        else if (entry.name.endsWith('.jsonl')) found.push(file);
      }
    };
    visit(this.directory);
    const recent = [];
    for (const file of found) {
      try {
        const stat = this.io.statSync(file);
        const modified = stat.mtimeMs || stat.ctimeMs;
        if (this.now() - modified > this.maxAge) continue;
        let metadata = this.files.get(file);
        if (!metadata || metadata.modified !== modified) {
          const first = this.io.readFileSync(file, 'utf8').split('\n', 1)[0];
          const value = JSON.parse(first);
          metadata =
            value.type === 'session_meta' && value.payload?.id
              ? {
                  id: value.payload.id,
                  cwd: path.resolve(value.payload.cwd || ''),
                  created: stat.birthtimeMs || stat.ctimeMs,
                  modified
                }
              : { modified };
          this.files.set(file, metadata);
        }
        if (metadata.id) recent.push(metadata);
      } catch {}
    }
    this.sessions = recent.sort((a, b) => a.created - b.created);
    return this.sessions;
  }
  claim(cwd, launchedAt, claimed = new Set()) {
    return this.refresh().find(
      (item) => item.cwd === path.resolve(cwd) && item.created >= launchedAt - 2000 && !claimed.has(item.id)
    );
  }
}

module.exports = { CodexSessionIndex };
