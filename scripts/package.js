#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { writeSkill } = require('./skill-archive');

const root = path.resolve(__dirname, '..');
const check = process.argv.includes('--check');
const mappings = [
  ['skills/bdfl', 'plugins/bdfl/skills/bdfl'],
  ['src', 'plugins/bdfl/runtime'],
  ['commands/bdfl.toml', 'plugins/bdfl/commands/bdfl.toml'],
  ['bin/bdfl.js', 'plugins/bdfl/bin/bdfl.js'],
  ['agents/bdfl-agent.md', 'plugins/bdfl/agents/bdfl-agent.md'],
  ['docs/assets/bdfl-mark.svg', 'plugins/bdfl/assets/bdfl-mark.svg']
];

function filesUnder(relative) {
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute)) return [];
  if (fs.statSync(absolute).isFile()) return [relative];
  return fs.readdirSync(absolute, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => filesUnder(path.join(relative, entry.name)));
}

function digest(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function sync(source, target) {
  const sourcePath = path.join(root, source);
  const targetPath = path.join(root, target);
  if (!fs.existsSync(sourcePath)) return [];
  if (fs.statSync(sourcePath).isFile()) {
    const differs = !fs.existsSync(targetPath) || digest(sourcePath) !== digest(targetPath);
    if (differs && !check) {
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.copyFileSync(sourcePath, targetPath);
    }
    return differs ? [target] : [];
  }

  const expected = new Set();
  const changed = [];
  for (const file of filesUnder(source)) {
    const relative = path.relative(source, file);
    expected.add(relative);
    changed.push(...sync(file, path.join(target, relative)));
  }
  for (const file of filesUnder(target)) {
    const relative = path.relative(target, file);
    if (!expected.has(relative)) {
      changed.push(file);
      if (!check) fs.rmSync(path.join(root, file));
    }
  }
  return changed;
}

const changed = mappings.flatMap(([source, target]) => sync(source, target));
if (check && !writeSkill({ check: true })) changed.push('dist/bdfl.skill');
if (!check) writeSkill();
if (check && changed.length) {
  console.error(`Packaged files are stale:\n${changed.map((file) => `- ${file}`).join('\n')}`);
  process.exit(1);
}
if (!check) console.log(`Packaged ${mappings.length} canonical source trees.`);
