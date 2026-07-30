'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { discoverRepositories, WorkspaceCatalog, LineageCatalog } = require('../../src/state/repositories');
const { SessionManager } = require('../../src/sessions/manager');
const { TerminalSupervisor } = require('../../src/tui/supervisor');
const { FakeTmux } = require('../helpers/fake-tmux');

function git(root, args) {
  return `${execFileSync('git', args, { cwd: root, encoding: 'utf8' })}`.trim();
}
function repository(root, committed = true) {
  fs.mkdirSync(root, { recursive: true });
  git(root, ['init', '-b', 'main']);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'Test']);
  if (committed) {
    fs.writeFileSync(path.join(root, 'README.md'), `${path.basename(root)}\n`);
    git(root, ['add', '.']);
    git(root, ['commit', '-m', 'base']);
  }
  return root;
}
function config() {
  return {
    version: 1,
    delegatorProfile: { provider: 'claude', model: 'opus', effort: 'high' },
    workerProfile: { provider: 'codex', model: 'gpt-5', effort: 'medium', permissionMode: 'workspace-write' },
    workerCapacity: 2
  };
}
function plan() {
  return '<!-- bdfl-plan:{"schema":1,"title":"Scope repository state"} -->\n# Scope repository state\n<!-- bdfl-summary:start -->\n## Summary\n- Scope durable state to its repository.\n<!-- bdfl-summary:end -->\n<!-- bdfl-shared:start -->\n## Shared decisions\nOne.\n<!-- bdfl-shared:end -->\n<!-- bdfl-chunk:{"id":"code","paths":["src/**"],"dependsOn":[],"locks":[],"checks":[]} -->\n## Code\n### Outcome\nDone.\n### Implementation\nBuild it.\n### Local validation\nTest.\n### Acceptance conditions\nPass.\n<!-- bdfl-chunk:end -->\n<!-- bdfl-global:{"checks":[]} -->\n## Global validation\nTest.\n<!-- bdfl-global:end -->\n<!-- bdfl-plan:end -->\n';
}

test('discovers committed repositories at two levels and keeps unborn and deeper repositories out of the picker', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bdfl-repositories-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  repository(path.join(root, 'claudia'));
  repository(path.join(root, 'group', 'mango'));
  repository(path.join(root, 'group', 'deep', 'hidden'));
  repository(path.join(root, 'unborn'), false);
  const discovery = discoverRepositories(root);
  assert.deepEqual(
    discovery.repositories.filter((item) => item.committed).map((item) => item.label),
    ['claudia', path.join('group', 'mango')]
  );
  assert.equal(discovery.repositoryMode, false);
});

test('writes repository-owned sessions and plans locally while a parent catalog aggregates them', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bdfl-catalog-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const claudia = repository(path.join(root, 'claudia'));
  const mango = repository(path.join(root, 'mango'));
  const catalog = new WorkspaceCatalog(root);
  const first = catalog.createWorkstream(config(), undefined, claudia);
  const planning = catalog.createSession(first.id, 'delegator', config().delegatorProfile);
  const second = catalog.createWorkstream(config(), undefined, mango);
  catalog.createSession(second.id, 'delegator', config().delegatorProfile);
  assert.equal(fs.existsSync(path.join(claudia, '.bdfl', 'workspace.json')), true);
  assert.equal(fs.existsSync(path.join(mango, '.bdfl', 'workspace.json')), true);
  assert.equal(fs.existsSync(path.join(root, '.bdfl', 'workspace.json')), false);
  const lineages = new LineageCatalog(catalog);
  const published = lineages.create(plan(), { workstreamId: first.id, sessionId: planning.id });
  assert.equal(fs.existsSync(path.join(claudia, '.bdfl', 'plans', published.lineage.planId, 'lineage.json')), true);
  assert.equal(fs.existsSync(path.join(mango, '.bdfl', 'plans', published.lineage.planId)), false);
  assert.deepEqual(
    new WorkspaceCatalog(root)
      .load()
      .workstreams.map((item) => item.repository)
      .sort(),
    ['claudia', 'mango']
  );
  fs.mkdirSync(path.join(claudia, 'src'), { recursive: true });
  const local = new WorkspaceCatalog(path.join(claudia, 'src'));
  assert.equal(local.load().workstreams.length, 1);
  assert.equal(local.load().workstreams[0].id, first.id);
});

test('remembers the repository of the most recently updated workstream', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bdfl-remembered-repository-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const alpha = repository(path.join(root, 'alpha'));
  const beta = repository(path.join(root, 'beta'));
  const catalog = new WorkspaceCatalog(root);
  const first = catalog.createWorkstream(config(), undefined, alpha);
  const second = catalog.createWorkstream(config(), undefined, beta);
  catalog.stateFor(alpha).store.update((state) => {
    state.workstreams.find((stream) => stream.id === first.id).updatedAt = '2026-07-25T12:00:00.000Z';
    return state;
  });
  catalog.stateFor(beta).store.update((state) => {
    state.workstreams.find((stream) => stream.id === second.id).updatedAt = '2026-07-24T12:00:00.000Z';
    return state;
  });
  assert.equal(catalog.rememberedRepositoryRoot(), fs.realpathSync(alpha));
});

test('preserves independent planning and direct presets in schema-2 configuration', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bdfl-independent-presets-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const project = repository(path.join(root, 'project'));
  const catalog = new WorkspaceCatalog(root);
  catalog.createWorkstream(config(), undefined, project);
  const directProfile = {
    provider: 'ollama',
    model: 'qwen3:4b',
    effort: 'high',
    permissionMode: 'workspace-write',
    argv: ['--search']
  };
  catalog.createWorkstream({ version: 1, sessionType: 'direct', directProfile }, undefined, project);
  const saved = JSON.parse(fs.readFileSync(path.join(project, '.bdfl', 'config.json'), 'utf8'));
  assert.equal(saved.schema, 2);
  assert.deepEqual(saved.profiles.delegator, config().delegatorProfile);
  assert.deepEqual(saved.profiles.worker, config().workerProfile);
  assert.deepEqual(saved.profiles.direct, directProfile);
  assert.equal(saved.workerCapacity, 2);
  const loaded = catalog.loadConfig(project);
  assert.equal(loaded.sessionType, 'planning');
  assert.deepEqual(loaded.directProfile, directProfile);
  const changed = {
    ...config(),
    delegatorProfile: { provider: 'codex', model: 'gpt-new', effort: 'low' },
    workerCapacity: 4
  };
  catalog.createWorkstream(changed, undefined, project);
  assert.deepEqual(catalog.loadConfig(project).directProfile, directProfile);
});

test('launches a planning session in its owning repository', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bdfl-session-repository-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const claudia = repository(path.join(root, 'claudia'));
  const catalog = new WorkspaceCatalog(root);
  const stream = catalog.createWorkstream(config(), undefined, claudia);
  const session = catalog.createSession(stream.id, 'delegator', config().delegatorProfile);
  const tmux = new FakeTmux();
  const manager = new SessionManager(root, catalog, { tmux });
  manager.open(session.id);
  assert.equal(tmux.launches[0].invocation.cwd, fs.realpathSync(claudia));
  manager.shutdown();
});

test('rejects legacy session state in a non-Git parent', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bdfl-legacy-parent-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, '.bdfl'), { recursive: true });
  fs.writeFileSync(path.join(root, '.bdfl', 'workspace.json'), '{"schema":2,"workstreams":[],"sessions":[]}\n');
  assert.throws(
    () => discoverRepositories(root),
    (error) => error.code === 'RESET_REQUIRED'
  );
});

test('uses the Git top level as coordinator when launched from a repository subdirectory', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bdfl-subdirectory-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repositoryRoot = repository(path.join(root, 'claudia'));
  const nested = path.join(repositoryRoot, 'src', 'feature');
  fs.mkdirSync(nested, { recursive: true });
  const supervisor = new TerminalSupervisor(nested, { sessions: {}, scheduler: {}, integration: {}, bridge: {} });
  assert.equal(supervisor.root, fs.realpathSync(repositoryRoot));
  assert.deepEqual(supervisor.lockFiles(), [
    path.join(fs.realpathSync(repositoryRoot), '.bdfl', 'run', 'supervisor.lock')
  ]);
  const wizard = supervisor.createWizard();
  assert.equal(wizard.key(), 'repository');
  wizard.choose();
  assert.equal(wizard.key(), 'sessionType');
  assert.equal(fs.existsSync(path.join(nested, '.bdfl')), false);
});

test('routes plan rename and deletion to the owning repository and fans out bulk deletion', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bdfl-delete-catalog-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const claudia = repository(path.join(root, 'claudia'));
  const mango = repository(path.join(root, 'mango'));
  const catalog = new WorkspaceCatalog(root);
  const first = catalog.createWorkstream(config(), undefined, claudia);
  const firstSession = catalog.createSession(first.id, 'delegator', config().delegatorProfile);
  const second = catalog.createWorkstream(config(), undefined, mango);
  const secondSession = catalog.createSession(second.id, 'delegator', config().delegatorProfile);
  const lineages = new LineageCatalog(catalog);
  const firstPlan = lineages.create(plan(), { workstreamId: first.id, sessionId: firstSession.id });
  const secondPlan = lineages.create(plan(), {
    workstreamId: second.id,
    sessionId: secondSession.id,
    planId: 'plan-mango'
  });
  const renamed = lineages.rename(secondPlan.lineage.planId, 'Mango release');
  assert.equal(renamed.name, 'Mango release');
  assert.equal(renamed.repositoryRoot, fs.realpathSync(mango));
  assert.equal(lineages.load(secondPlan.lineage.planId).name, 'Mango release');
  const selected = lineages.delete(secondPlan.lineage.planId);
  assert.equal(selected.deleted, 1);
  assert.equal(selected.repositoryRoot, fs.realpathSync(mango));
  assert.equal(fs.existsSync(path.join(mango, '.bdfl', 'plans', secondPlan.lineage.planId)), false);
  assert.equal(fs.existsSync(path.join(claudia, '.bdfl', 'plans', firstPlan.lineage.planId)), true);
  const allPlans = lineages.deleteAll();
  assert.equal(allPlans.deleted, 1);
  assert.deepEqual(
    allPlans.repositories.map((item) => item.deleted),
    [1, 0]
  );
  assert.equal(fs.existsSync(path.join(claudia, '.bdfl', 'plans')), false);
  assert.deepEqual(catalog.deleteAllWorkstreams(), { workstreams: 2, sessions: 2 });
  assert.deepEqual(catalog.load().workstreams, []);
  assert.deepEqual(catalog.load().sessions, []);
  assert.ok(fs.existsSync(path.join(claudia, '.bdfl', 'config.json')));
  assert.ok(fs.existsSync(path.join(mango, '.bdfl', 'config.json')));
  assert.deepEqual(catalog.deleteAllWorkstreams(), { workstreams: 0, sessions: 0 });
});
