'use strict';

const fs = require('node:fs'); const path = require('node:path'); const { execFileSync } = require('node:child_process');
const { WorkspaceStore, WORKSPACE_SCHEMA, defaultWorkspace } = require('./workspace');
const { LineageStore } = require('../plans/store');

function git(root, args, command = execFileSync) { try { return `${command('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })}`.trim(); } catch { return null; } }
function canonical(directory, io = fs) { try { return io.realpathSync(directory); } catch { return path.resolve(directory); } }
function gitRepository(directory, command = execFileSync) { const top = git(directory, ['rev-parse', '--show-toplevel'], command); if (!top) return null; let root; try { root = fs.realpathSync(top); } catch { return null; } return { root, committed: Boolean(git(root, ['rev-parse', '--verify', 'HEAD'], command)) }; }
function inside(root, candidate) { const relative = path.relative(root, candidate); return relative === '' || relative && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative); }
function candidates(root, depth = 2, io = fs) {
  const found = [root]; const visit = (directory, level) => { if (level >= depth) return; let entries; try { entries = io.readdirSync(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) { if (!entry.isDirectory() || entry.isSymbolicLink?.() || entry.name === '.git' || entry.name === '.bdfl') continue; const child = path.join(directory, entry.name); found.push(child); visit(child, level + 1); }
  }; visit(root, 0); return found;
}
function discoverRepositories(start, { depth = 2, io = fs, command = execFileSync } = {}) {
  const launchRoot = canonical(start, io); const direct = gitRepository(launchRoot, command);
  if (direct) return { launchRoot, repositoryMode: true, repositories: [{ ...direct, label: '.', hasState: io.existsSync(path.join(direct.root, '.bdfl', 'workspace.json')) }] };
  if (io.existsSync(path.join(launchRoot, '.bdfl', 'workspace.json'))) { const error = new Error('BDFL state in a non-Git parent cannot be assigned safely. Remove this directory\'s .bdfl state and start again.'); error.code = 'RESET_REQUIRED'; throw error; }
  const values = new Map();
  for (const candidate of candidates(launchRoot, depth, io)) {
    const hasState = io.existsSync(path.join(candidate, '.bdfl', 'workspace.json')); const marker = io.existsSync(path.join(candidate, '.git'));
    if (!marker && !hasState) continue; const repository = gitRepository(candidate, command); const repositoryRoot = repository?.root || canonical(candidate, io);
    if (!inside(launchRoot, repositoryRoot) || repositoryRoot === launchRoot) continue; const current = values.get(repositoryRoot); values.set(repositoryRoot, { root: repositoryRoot, committed: Boolean(repository?.committed), hasState: hasState || current?.hasState || false, label: path.relative(launchRoot, repositoryRoot) || '.' });
  }
  return { launchRoot, repositoryMode: false, repositories: [...values.values()].filter((item) => item.committed || item.hasState).sort((a, b) => a.label.localeCompare(b.label)) };
}
function cleanRecord(value) { const result = { ...value }; delete result.repositoryRoot; delete result.repository; return result; }

class WorkspaceCatalog {
  constructor(root, { discovery, io = fs, storeFactory = (directory) => new WorkspaceStore(directory) } = {}) {
    this.root = canonical(root, io); this.io = io; this.discovery = discovery || discoverRepositories(root, { io }); this.entries = new Map();
    for (const repository of this.discovery.repositories) this.entries.set(repository.root, { ...repository, store: storeFactory(repository.root) });
  }
  selectableRepositories() { return [...this.entries.values()].filter((entry) => entry.committed).map(({ root, label, store }) => ({ root, label, lastUsed: store.loadConfig() })); }
  repositoryRoots() { return [...this.entries.keys()]; }
  coordinatorRoot() { return this.discovery.repositoryMode ? this.repositoryRoots()[0] : this.discovery.launchRoot; }
  lockRoots() { return this.repositoryRoots(); }
  decorate(value, root, label = this.entries.get(root)?.label || path.basename(root)) { return { ...value, repositoryRoot: root, repository: label }; }
  stateFor(root) { const entry = this.entries.get(canonical(root, this.io)); if (!entry) throw new Error(`Unknown repository: ${root}`); return entry; }
  owner(kind, id) { for (const [root, entry] of this.entries) if ((entry.store.load()[kind] || []).some((item) => item.id === id)) return { root, entry }; throw new Error(`Unknown ${kind === 'sessions' ? 'session' : 'workstream'}: ${id}`); }
  load() {
    const result = defaultWorkspace(); let active = null; let activeAt = '';
    for (const [root, entry] of this.entries) { const state = entry.store.load(); result.workstreams.push(...state.workstreams.map((item) => this.decorate(item, root))); result.sessions.push(...state.sessions.map((item) => this.decorate(item, root))); result.nextPaneNumber = Math.max(result.nextPaneNumber, state.nextPaneNumber || 1); const stream = state.workstreams.find((item) => item.id === state.activeWorkstreamId); if (stream && `${stream.updatedAt || ''}` >= activeAt) { active = stream.id; activeAt = `${stream.updatedAt || ''}`; } }
    result.activeWorkstreamId = active || result.workstreams.find((item) => item.status !== 'closed')?.id || null; return result;
  }
  save(value) {
    for (const [root, entry] of this.entries) { const current = entry.store.load(); const workstreams = value.workstreams.filter((item) => item.repositoryRoot === root).map(cleanRecord); const ids = new Set(workstreams.map((item) => item.id)); const sessions = value.sessions.filter((item) => item.repositoryRoot === root || ids.has(item.workstreamId)).map(cleanRecord); entry.store.save({ schema: WORKSPACE_SCHEMA, workstreams, sessions, activeWorkstreamId: ids.has(value.activeWorkstreamId) ? value.activeWorkstreamId : current.activeWorkstreamId && ids.has(current.activeWorkstreamId) ? current.activeWorkstreamId : workstreams.find((item) => item.status !== 'closed')?.id || null, nextPaneNumber: Math.max(current.nextPaneNumber || 1, value.nextPaneNumber || 1) }); }
    return this.load();
  }
  update(mutator) { const value = this.load(); return this.save(mutator(structuredClone(value)) || value); }
  loadConfig(root) { const repositoryRoot = root || this.selectableRepositories()[0]?.root; return repositoryRoot ? this.stateFor(repositoryRoot).store.loadConfig() : null; }
  createWorkstream(config, title, repositoryRoot = config.repositoryRoot) { const root = path.resolve(repositoryRoot || this.selectableRepositories()[0]?.root || ''); const entry = this.stateFor(root); return this.decorate(entry.store.createWorkstream(config, title || path.basename(root)), root); }
  activateWorkstream(id) { const { root, entry } = this.owner('workstreams', id); return entry.store.activateWorkstream(id) && this.decorate(entry.store.load().workstreams.find((item) => item.id === id), root); }
  setCapacity(id, capacity) { const { root, entry } = this.owner('workstreams', id); const value = entry.store.setCapacity(id, capacity); return { ...value, workstream: this.decorate(value.workstream, root) }; }
  closeWorkstream(id) { const { root, entry } = this.owner('workstreams', id); return this.decorate(entry.store.closeWorkstream(id), root); }
  reopenWorkstream(id) { const { root, entry } = this.owner('workstreams', id); return this.decorate(entry.store.reopenWorkstream(id), root); }
  deleteWorkstream(id) { return this.owner('workstreams', id).entry.store.deleteWorkstream(id); }
  createSession(workstreamId, role, profile, fields = {}) { const { root, entry } = this.owner('workstreams', workstreamId); return this.decorate(entry.store.createSession(workstreamId, role, profile, cleanRecord(fields)), root); }
  renameSession(id, name) { const { root, entry } = this.owner('sessions', id); return this.decorate(entry.store.renameSession(id, name), root); }
  setSessionTaskSnippet(id, input) { const { root, entry } = this.owner('sessions', id); return this.decorate(entry.store.setSessionTaskSnippet(id, input), root); }
  setSessionAttention(id, attention) { return this.owner('sessions', id).entry.store.setSessionAttention(id, attention); }
  touchSession(id) { const { root, entry } = this.owner('sessions', id); return this.decorate(entry.store.touchSession(id), root); }
}

class LineageCatalog {
  constructor(workspaces, { factory = (root) => new LineageStore(root) } = {}) { this.workspaces = workspaces; this.stores = new Map(workspaces.repositoryRoots().map((root) => [root, factory(root)])); }
  storeForWorkstream(id) { const stream = this.workspaces.load().workstreams.find((item) => item.id === id); if (!stream) throw new Error(`Unknown workstream: ${id}`); return this.stores.get(stream.repositoryRoot); }
  find(id) { for (const [root, store] of this.stores) { try { return { root, store, lineage: store.load(id) }; } catch {} } throw new Error(`Unknown plan: ${id}`); }
  list() { return [...this.stores.entries()].flatMap(([root, store]) => store.list().map((item) => ({ ...item, repositoryRoot: root, repository: this.workspaces.entries.get(root)?.label }))); }
  current(options = {}) { if (options.workstreamId) { const store = this.storeForWorkstream(options.workstreamId); const value = store.current(options); return value ? { ...value, repositoryRoot: store.root, repository: this.workspaces.entries.get(store.root)?.label } : null; } return this.list().sort((a, b) => `${b.updatedAt}`.localeCompare(`${a.updatedAt}`))[0] || null; }
  load(id) { const found = this.find(id); return { ...found.lineage, repositoryRoot: found.root, repository: this.workspaces.entries.get(found.root)?.label }; }
  versionDirectory(id, version) { const found = this.find(id); return found.store.versionDirectory(id, version); }
  readManifest(id, version) { return this.find(id).store.readManifest(id, version); }
  readSection(id, version, section) { return this.find(id).store.readSection(id, version, section); }
  create(source, options = {}) { return this.storeForWorkstream(options.workstreamId).create(source, options); }
  publish(source, options = {}) { return this.storeForWorkstream(options.workstreamId).publish(source, options); }
  approve(id, version, section) { return this.find(id).store.approve(id, version, section); }
  unlock(id, version, section) { return this.find(id).store.unlock(id, version, section); }
  removeApproval(id, version, section) { return this.find(id).store.removeApproval(id, version, section); }
  executable(id, version) { return this.find(id).store.executable(id, version); }
  revise(id, source) { return this.find(id).store.revise(id, source); }
}

module.exports = { git, gitRepository, discoverRepositories, WorkspaceCatalog, LineageCatalog };
