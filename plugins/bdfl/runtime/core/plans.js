'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function derivePlanTitle(content, projectRoot = process.cwd()) {
  const heading = `${content || ''}`.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/m);
  return heading?.[1]?.trim() || path.basename(projectRoot) || 'BDFL plan';
}

function slugify(value) {
  return `${value || 'plan'}`.normalize('NFKD').replace(/[^\w\s-]/g, '').trim().toLowerCase().replace(/[\s_-]+/g, '-').slice(0, 64) || 'plan';
}

function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }

function atomicWrite(file, content, io = fs) {
  io.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  io.writeFileSync(temporary, content, { mode: 0o600 });
  io.renameSync(temporary, file);
}

class PlanStore {
  constructor(projectRoot, { io = fs, now = () => new Date(), id = () => crypto.randomUUID() } = {}) {
    this.projectRoot = path.resolve(projectRoot);
    this.io = io;
    this.now = now;
    this.id = id;
    this.directory = path.join(this.projectRoot, '.bdfl', 'plans');
    this.indexFile = path.join(this.directory, 'index.json');
  }

  loadIndex() {
    if (!this.io.existsSync(this.indexFile)) return { version: 1, plans: [], migratedStatePlans: false };
    const index = JSON.parse(this.io.readFileSync(this.indexFile, 'utf8'));
    if (index.version !== 1 || !Array.isArray(index.plans)) throw new Error('Unsupported BDFL plan index');
    return index;
  }

  saveIndex(index) { atomicWrite(this.indexFile, `${JSON.stringify(index, null, 2)}\n`, this.io); return index; }
  planDirectory(plan) { return path.join(this.directory, plan.directory); }
  metadataFile(plan) { return path.join(this.planDirectory(plan), 'plan.json'); }
  versionFile(plan, number) { return path.join(this.planDirectory(plan), 'versions', `${String(number).padStart(4, '0')}.md`); }

  list() {
    return this.loadIndex().plans.map((entry) => this.get(entry.id)).filter(Boolean);
  }

  get(id) {
    const entry = this.loadIndex().plans.find((candidate) => candidate.id === id);
    if (!entry) return null;
    return JSON.parse(this.io.readFileSync(this.metadataFile(entry), 'utf8'));
  }

  content(id, number) {
    const plan = this.get(id);
    if (!plan) throw new Error(`Unknown plan: ${id}`);
    const version = plan.versions.find((candidate) => candidate.number === number);
    if (!version) throw new Error(`Unknown plan version: ${number}`);
    return this.io.readFileSync(this.versionFile(plan, number), 'utf8');
  }

  capture({ content, title, host, session, episode, sourcePath = null, createdAt } = {}) {
    if (!content || typeof content !== 'string') throw new Error('Plan content is required');
    if (!host || !session || !episode) throw new Error('Plan host, session, and episode are required');
    const timestamp = createdAt || this.now().toISOString();
    const index = this.loadIndex();
    let entry = index.plans.find((candidate) => candidate.host === host && candidate.session === session && candidate.episode === episode);
    let plan;
    if (entry) plan = this.get(entry.id);
    else {
      const identifier = `${this.id()}`;
      const readableTitle = title || derivePlanTitle(content, this.projectRoot);
      entry = { id: identifier, directory: `${slugify(readableTitle)}-${identifier.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8)}`, title: readableTitle, host, session, episode, createdAt: timestamp };
      plan = { version: 1, ...entry, nativeSourcePath: sourcePath, updatedAt: timestamp, selectedVersion: null, versions: [] };
      index.plans.push(entry);
    }
    const digest = sha256(content);
    const duplicate = plan.versions.find((candidate) => candidate.sha256 === digest);
    if (duplicate) return { plan, version: duplicate.number, deduplicated: true };
    const number = plan.versions.length + 1;
    plan.title = title || derivePlanTitle(content, this.projectRoot);
    plan.updatedAt = timestamp;
    plan.nativeSourcePath = sourcePath || plan.nativeSourcePath || null;
    plan.versions.push({ number, sha256: digest, createdAt: timestamp, sourcePath: sourcePath || null });
    atomicWrite(this.versionFile(plan, number), content, this.io);
    atomicWrite(this.metadataFile(plan), `${JSON.stringify(plan, null, 2)}\n`, this.io);
    entry.title = plan.title;
    this.saveIndex(index);
    return { plan, version: number, deduplicated: false };
  }

  select(id, number) {
    const plan = this.get(id);
    if (!plan) throw new Error(`Unknown plan: ${id}`);
    if (!plan.versions.some((version) => version.number === number)) throw new Error(`Unknown plan version: ${number}`);
    plan.selectedVersion = number;
    plan.updatedAt = this.now().toISOString();
    atomicWrite(this.metadataFile(plan), `${JSON.stringify(plan, null, 2)}\n`, this.io);
    return plan;
  }

  migrateStatePlans(state) {
    const index = this.loadIndex();
    if (index.migratedStatePlans) return { state, migrated: false };
    let migrated = false;
    for (const legacy of state.plans || []) {
      let captured;
      for (const version of legacy.versions || []) {
        captured = this.capture({
          content: version.content,
          title: legacy.title,
          host: legacy.host || 'legacy',
          session: legacy.session || legacy.runId || 'state',
          episode: legacy.episode || legacy.id,
          sourcePath: legacy.nativeSourcePath || null,
          createdAt: version.createdAt || legacy.createdAt
        });
      }
      if (captured && legacy.selectedVersion) this.select(captured.plan.id, legacy.selectedVersion);
      migrated = migrated || Boolean(captured);
    }
    const finalIndex = this.loadIndex();
    finalIndex.migratedStatePlans = true;
    this.saveIndex(finalIndex);
    return { state: { ...state, plans: [] }, migrated };
  }
}

function selectPlanVersion(plan, number) {
  if (!plan.versions.some((version) => version.number === number)) throw new Error(`Unknown plan version: ${number}`);
  return { ...plan, selectedVersion: number };
}

function diffLines(before = '', after = '') {
  const a = before.split('\n');
  const b = after.split('\n');
  const table = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) for (let j = b.length - 1; j >= 0; j -= 1) table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  const result = [];
  let i = 0; let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { result.push({ type: 'context', text: a[i++] }); j += 1; }
    else if (j < b.length && (i === a.length || table[i][j + 1] >= table[i + 1][j])) result.push({ type: 'addition', text: b[j++] });
    else result.push({ type: 'removal', text: a[i++] });
  }
  return result;
}

module.exports = { PlanStore, atomicWrite, derivePlanTitle, slugify, sha256, selectPlanVersion, diffLines };
