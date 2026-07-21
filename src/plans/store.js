'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { atomicWrite, sha256, diffLines } = require('../core/plans');
const { parsePlan, validateGraph } = require('./format');

function versionName(number) { return `v${String(number).padStart(4, '0')}`; }
function cleanBody(value) { return value.replace(/^\s*\n|\s+$/g, '') + '\n'; }

function parsePatch(source) {
  const header = source.match(/<!--\s*bdfl-plan-patch:(\{[^\n]*\})\s*-->/);
  if (!header || !/<!--\s*bdfl-plan-patch:end\s*-->/.test(source)) throw new Error('Invalid plan patch');
  const metadata = JSON.parse(header[1]);
  const replacements = [];
  const shared = source.match(/<!-- bdfl-shared:start -->([\s\S]*?)<!-- bdfl-shared:end -->/);
  if (shared) replacements.push({ id: 'shared', body: cleanBody(shared[1]) });
  const chunks = /<!--\s*bdfl-chunk:(\{[^\n]*\})\s*-->([\s\S]*?)<!--\s*bdfl-chunk:end\s*-->/g;
  let match;
  while ((match = chunks.exec(source))) replacements.push({ id: JSON.parse(match[1]).id, control: JSON.parse(match[1]), body: cleanBody(match[2]) });
  const global = source.match(/<!-- bdfl-global:start -->([\s\S]*?)<!-- bdfl-global:end -->/);
  if (global) replacements.push({ id: 'global-validation', body: cleanBody(global[1]) });
  if (!replacements.length) throw new Error('Plan patch contains no replacement sections');
  return { metadata, replacements };
}

function renderSource(title, shared, chunks, globalValidation) {
  const lines = [`<!-- bdfl-plan:${JSON.stringify({ schema: 1, title })} -->`, `# ${title}`, '<!-- bdfl-shared:start -->', shared.body.trimEnd(), '<!-- bdfl-shared:end -->'];
  for (const chunk of chunks) lines.push(`<!-- bdfl-chunk:${JSON.stringify({ id: chunk.id, paths: chunk.paths, dependsOn: chunk.dependsOn, locks: chunk.locks })} -->`, chunk.body.trimEnd(), '<!-- bdfl-chunk:end -->');
  lines.push('<!-- bdfl-global:start -->', globalValidation.body.trimEnd(), '<!-- bdfl-global:end -->', '<!-- bdfl-plan:end -->');
  return `${lines.join('\n')}\n`;
}

class LineageStore {
  constructor(root, { io = fs, id = () => `plan-${crypto.randomUUID()}`, now = () => new Date(), skillVersion = '1' } = {}) {
    this.root = path.resolve(root); this.io = io; this.id = id; this.now = now; this.skillVersion = skillVersion;
    this.directory = path.join(this.root, '.bdfl', 'plans');
  }

  planDirectory(id) { return path.join(this.directory, id); }
  lineageFile(id) { return path.join(this.planDirectory(id), 'lineage.json'); }
  load(id) { return JSON.parse(this.io.readFileSync(this.lineageFile(id), 'utf8')); }
  versionDirectory(id, version) { return path.join(this.planDirectory(id), 'versions', versionName(version)); }
  readManifest(id, version) { return JSON.parse(this.io.readFileSync(path.join(this.versionDirectory(id, version), 'manifest.json'), 'utf8')); }
  readSection(id, version, sectionId) {
    const base = this.versionDirectory(id, version);
    const file = sectionId === 'shared' ? 'shared.md' : sectionId === 'global-validation' ? 'global-validation.md' : path.join('chunks', `${sectionId}.md`);
    return this.io.readFileSync(path.join(base, file), 'utf8');
  }

  assertSafeOwnership(parsed) {
    for (const owned of parsed.chunks.flatMap((chunk) => chunk.paths)) {
      const fixed = owned.split('/').filter((part) => !part.includes('*'));
      let current = this.root;
      for (const part of fixed) { current = path.join(current, part); if (!this.io.existsSync(current)) break; if (this.io.lstatSync(current).isSymbolicLink()) throw new Error(`Unsafe symlink ownership: ${owned}`); }
    }
  }

  writeVersion(id, number, parsed, lineage, approvals = {}) {
    const directory = this.versionDirectory(id, number);
    const manifest = { schema: 1, planId: id, version: number, title: parsed.title, skillVersion: lineage.skillVersion, shared: { id: 'shared', sha: parsed.shared.sha }, chunks: parsed.chunks.map(({ body: _body, ...chunk }, order) => ({ ...chunk, order })), globalValidation: { id: 'global-validation', sha: parsed.globalValidation.sha }, approvals };
    atomicWrite(path.join(directory, 'source.md'), parsed.source, this.io);
    atomicWrite(path.join(directory, 'consolidated.md'), parsed.consolidated, this.io);
    atomicWrite(path.join(directory, 'shared.md'), parsed.shared.body, this.io);
    for (const chunk of parsed.chunks) atomicWrite(path.join(directory, 'chunks', `${chunk.id}.md`), chunk.body, this.io);
    atomicWrite(path.join(directory, 'global-validation.md'), parsed.globalValidation.body, this.io);
    atomicWrite(path.join(directory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, this.io);
    return manifest;
  }

  create(source, options = {}) {
    const parsed = parsePlan(source); this.assertSafeOwnership(parsed); const id = options.planId || this.id(); const createdAt = this.now().toISOString();
    if (this.io.existsSync(this.lineageFile(id))) throw new Error(`Plan already exists: ${id}`);
    const lineage = { schema: 1, planId: id, title: parsed.title, skillVersion: options.skillVersion || this.skillVersion, currentVersion: 1, createdAt, updatedAt: createdAt };
    this.writeVersion(id, 1, parsed, lineage);
    atomicWrite(this.lineageFile(id), `${JSON.stringify(lineage, null, 2)}\n`, this.io);
    return { lineage, manifest: this.readManifest(id, 1) };
  }

  approve(id, version, sectionId) {
    const lineage = this.load(id); if (lineage.currentVersion !== version) throw new Error('Only the current plan version can be approved');
    const manifest = this.readManifest(id, version);
    const section = sectionId === 'shared' ? manifest.shared : sectionId === 'global-validation' ? manifest.globalValidation : manifest.chunks.find((chunk) => chunk.id === sectionId);
    if (!section) throw new Error(`Unknown plan section: ${sectionId}`);
    manifest.approvals[sectionId] = { planId: id, version, sectionId, sectionSha: section.sha, approvedAt: this.now().toISOString() };
    atomicWrite(path.join(this.versionDirectory(id, version), 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, this.io);
    return manifest.approvals[sectionId];
  }

  unlock(id, version, sectionId) {
    const manifest = this.readManifest(id, version); delete manifest.approvals[sectionId];
    atomicWrite(path.join(this.versionDirectory(id, version), 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, this.io); return manifest;
  }

  executable(id, version) {
    const manifest = this.readManifest(id, version); const ids = ['shared', ...manifest.chunks.map((chunk) => chunk.id), 'global-validation'];
    return ids.every((sectionId) => manifest.approvals[sectionId]?.sectionSha === (sectionId === 'shared' ? manifest.shared.sha : sectionId === 'global-validation' ? manifest.globalValidation.sha : manifest.chunks.find((chunk) => chunk.id === sectionId).sha));
  }

  revise(id, patchSource) {
    const lineage = this.load(id); const patch = parsePatch(patchSource);
    if (patch.metadata.schema !== 1 || patch.metadata.planId !== id || patch.metadata.baseVersion !== lineage.currentVersion) throw new Error('Plan patch base does not match current lineage');
    const previous = this.readManifest(id, lineage.currentVersion);
    let shared = { ...previous.shared, body: this.readSection(id, lineage.currentVersion, 'shared') };
    let globalValidation = { ...previous.globalValidation, body: this.readSection(id, lineage.currentVersion, 'global-validation') };
    let chunks = previous.chunks.map((chunk) => ({ ...chunk, body: this.readSection(id, lineage.currentVersion, chunk.id) }));
    for (const replacement of patch.replacements) {
      if (replacement.id === 'shared') shared = { id: 'shared', body: replacement.body };
      else if (replacement.id === 'global-validation') globalValidation = { id: 'global-validation', body: replacement.body };
      else {
        const index = chunks.findIndex((chunk) => chunk.id === replacement.id); if (index < 0) throw new Error(`Patch cannot introduce unknown chunk: ${replacement.id}`);
        chunks[index] = { ...chunks[index], ...replacement.control, body: replacement.body };
      }
    }
    validateGraph(chunks);
    const source = renderSource(lineage.title, shared, chunks, globalValidation); const parsed = parsePlan(source); this.assertSafeOwnership(parsed);
    const sharedChanged = parsed.shared.sha !== previous.shared.sha;
    const changedChunks = new Set(parsed.chunks.filter((chunk) => chunk.sha !== previous.chunks.find((old) => old.id === chunk.id)?.sha).map((chunk) => chunk.id));
    const metadataChanged = new Set(parsed.chunks.filter((chunk) => { const old = previous.chunks.find((item) => item.id === chunk.id); return old && JSON.stringify([chunk.paths, chunk.dependsOn, chunk.locks]) !== JSON.stringify([old.paths, old.dependsOn, old.locks]); }).map((chunk) => chunk.id));
    const affected = new Set(metadataChanged); let changed = true;
    while (changed) { changed = false; for (const chunk of parsed.chunks) if (!affected.has(chunk.id) && chunk.dependsOn.some((dependency) => affected.has(dependency))) { affected.add(chunk.id); changed = true; } }
    const lockedChanges = [...changedChunks, ...(sharedChanged ? ['shared'] : []), ...(parsed.globalValidation.sha !== previous.globalValidation.sha ? ['global-validation'] : [])].filter((sectionId) => previous.approvals[sectionId]);
    if (lockedChanges.length) throw new Error(`Approved sections must receive feedback or be unlocked before revision: ${lockedChanges.join(', ')}`);
    const approvals = {};
    if (!sharedChanged && previous.approvals.shared) approvals.shared = { ...previous.approvals.shared, version: lineage.currentVersion + 1 };
    if (!sharedChanged) for (const chunk of parsed.chunks) if (!changedChunks.has(chunk.id) && !affected.has(chunk.id) && previous.approvals[chunk.id]) approvals[chunk.id] = { ...previous.approvals[chunk.id], version: lineage.currentVersion + 1 };
    if (!sharedChanged && parsed.globalValidation.sha === previous.globalValidation.sha && previous.approvals['global-validation']) approvals['global-validation'] = { ...previous.approvals['global-validation'], version: lineage.currentVersion + 1 };
    lineage.currentVersion += 1; lineage.updatedAt = this.now().toISOString();
    const manifest = this.writeVersion(id, lineage.currentVersion, parsed, lineage, approvals);
    atomicWrite(this.lineageFile(id), `${JSON.stringify(lineage, null, 2)}\n`, this.io);
    return { lineage, manifest };
  }

  feedback(id, version, sectionId, value) {
    if (!value?.trim()) throw new Error('Plan feedback is required');
    const file = path.join(this.planDirectory(id), 'feedback', `${version}-${sectionId}-${Date.now()}.md`); atomicWrite(file, `${value.trim()}\n`, this.io); this.unlock(id, version, sectionId); return file;
  }

  diff(id, before, after, sectionId) { return diffLines(this.readSection(id, before, sectionId), this.readSection(id, after, sectionId)); }
}

module.exports = { LineageStore, parsePatch, renderSource, versionName };
