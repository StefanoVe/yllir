import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MIGRATIONS_DIR, compareVersions, isSupported, loadRegistry, runComplete, runRegistry } from './registry.mjs';

const tempDirs = [];
after(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

function tmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-registry-'));
  tempDirs.push(dir);
  return dir;
}

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

/** A registry folder with supported_from and no migrations yet. */
function registryDir(supported = '0.0.0') {
  const dir = tmp();
  write(path.join(dir, 'registry.yaml'), `supported_from: "${supported}"\n`);
  return dir;
}

const DEFAULTS = {
  after: '[]',
  introduced_in: '0.1.0',
  needed: 'detect',
  deterministic: 'deterministic.mjs',
  guided: 'null',
  complete: 'null',
};

/**
 * Writes migrations/<id>/migration.yaml from the given fields, plus the modules. The
 * modules log their calls on globalThis.__log and return the given results.
 */
function migration(dir, id, fields = {}, { detect = true, apply = { status: 'complete' }, complete = { status: 'complete', errors: [] } } = {}) {
  const values = { ...DEFAULTS, ...fields };
  const lines = [`id: ${id}`];
  for (const key of ['after', 'introduced_in', 'needed', 'deterministic', 'guided', 'complete', 'version_record_before']) {
    if (values[key] === undefined) continue;
    // Tests write from_version_below in the block form the registry reads: {from_version_below: "x"} stands for it.
    const below = key === 'needed' ? /^\{from_version_below: "([^"]+)"\}$/.exec(values[key]) : null;
    if (below !== null) lines.push('needed:', `  from_version_below: "${below[1]}"`);
    else lines.push(`${key}: ${values[key]}`);
  }
  const folder = path.join(dir, id);
  write(path.join(folder, 'migration.yaml'), `${lines.join('\n')}\n`);
  if (values.deterministic !== 'null' && values.deterministic !== undefined) {
    write(path.join(folder, 'deterministic.mjs'), [
      `export function detect(root) { globalThis.__log.push('detect:${id}'); return ${detect}; }`,
      `export function apply(root, options = {}) { globalThis.__log.push('apply:${id}' + (options.dryRun ? ':dry' : '')); return ${JSON.stringify(apply)}; }`,
      '',
    ].join('\n'));
  }
  if (values.guided !== 'null' && values.guided !== undefined) write(path.join(folder, 'guided.md'), `# ${id}\n`);
  if (values.complete !== 'null' && values.complete !== undefined) {
    write(path.join(folder, 'complete.mjs'), `export function complete(root) { return ${JSON.stringify(complete)}; }\n`);
  }
  return folder;
}

globalThis.__log = [];

// ---------------------------------------------------------------- the real registry

test('the registry of the framework lists the six migrations in their order', () => {
  const registry = loadRegistry();
  assert.deepEqual(registry.errors, []);
  assert.equal(registry.supported_from, '0.0.0');
  assert.deepEqual(
    registry.migrations.map((m) => m.id),
    ['session-layout-v1', 'category-first-geography-v1', 'item-descriptions-v1', 'item-knowledge-v1', 'statistics-tables-v1', 'world-graph-v1', 'metadata-comment-v1'],
  );
  const world = registry.migrations.find((m) => m.id === 'world-graph-v1');
  assert.equal(world.needed, 'detect');
  assert.equal(world.version_record_before, true);
  assert.equal(world.complete, null);
  assert.equal(registry.migrations.find((m) => m.id === 'statistics-tables-v1').complete, 'complete.mjs');
  assert.equal(registry.migrations[0].dir, path.join(path.resolve(MIGRATIONS_DIR), 'session-layout-v1'));
});

// ---------------------------------------------------------------- loading and validation

test('the order follows the after lists, not the folder names; ties go to the smaller id', () => {
  const dir = registryDir();
  migration(dir, 'a', { after: '[c]' });
  migration(dir, 'b');
  migration(dir, 'c');
  const registry = loadRegistry(dir);
  assert.deepEqual(registry.errors, []);
  assert.deepEqual(registry.migrations.map((m) => m.id), ['b', 'c', 'a']);
});

test('a cycle in the after lists is refused', () => {
  const dir = registryDir();
  migration(dir, 'a', { after: '[b]' });
  migration(dir, 'b', { after: '[a]' });
  const registry = loadRegistry(dir);
  assert.equal(registry.errors[0].code, 'registry-cycle');
  assert.deepEqual(registry.migrations, []);
});

test('an after id that is not a migration is refused', () => {
  const dir = registryDir();
  migration(dir, 'a', { after: '[missing]' });
  const registry = loadRegistry(dir);
  assert.equal(registry.errors[0].code, 'registry-unknown-after');
});

test('an id that is not the folder name is refused', () => {
  const dir = registryDir();
  const folder = migration(dir, 'a');
  write(path.join(folder, 'migration.yaml'), 'id: b\nafter: []\nintroduced_in: 0.1.0\nneeded: detect\ndeterministic: deterministic.mjs\nguided: null\ncomplete: null\n');
  const registry = loadRegistry(dir);
  assert.equal(registry.errors[0].code, 'registry-invalid');
  assert.match(registry.errors[0].message, /id must be the folder name a/);
});

test('a missing or unknown field is refused', () => {
  const dir = registryDir();
  const folder = migration(dir, 'a');
  write(path.join(folder, 'migration.yaml'), 'id: a\nafter: []\nneeded: detect\ndeterministic: deterministic.mjs\nguided: null\ncomplete: null\n');
  assert.match(loadRegistry(dir).errors[0].message, /missing field introduced_in/);
  write(path.join(folder, 'migration.yaml'), 'id: a\nafter: []\nintroduced_in: 0.1.0\nneeded: detect\ndeterministic: deterministic.mjs\nguided: null\ncomplete: null\ncolour: red\n');
  assert.match(loadRegistry(dir).errors[0].message, /unknown field colour/);
});

test('needed must be detect, or from_version_below with a version', () => {
  const dir = registryDir();
  migration(dir, 'a', { needed: 'sometimes' });
  assert.match(loadRegistry(dir).errors[0].message, /needed must be detect/);
});

test('a guided part needs its complete check, and the other way round', () => {
  const dir = registryDir();
  migration(dir, 'a', { guided: 'guided.md' });
  assert.match(loadRegistry(dir).errors[0].message, /guided and complete must both be set/);
});

test('a file named in migration.yaml must exist', () => {
  const dir = registryDir();
  migration(dir, 'a', { deterministic: 'nowhere.mjs' });
  assert.match(loadRegistry(dir).errors[0].message, /deterministic file nowhere\.mjs does not exist/);
});

test('detect needs a deterministic part, and a migration needs one part at least', () => {
  const dir = registryDir();
  migration(dir, 'a', { deterministic: 'null' });
  assert.match(loadRegistry(dir).errors[0].message, /needed detect requires a deterministic part/);
  const other = registryDir();
  migration(other, 'b', { deterministic: 'null', needed: '{from_version_below: "0.2.0"}', guided: 'null', complete: 'null' });
  assert.match(loadRegistry(other).errors[0].message, /needs a deterministic or a guided part/);
});

test('supported_from must be a version, and only one migration may record the framework version', () => {
  const dir = registryDir('soon');
  assert.equal(loadRegistry(dir).errors[0].code, 'registry-invalid');
  const two = registryDir();
  migration(two, 'a', { version_record_before: 'true' });
  migration(two, 'b', { version_record_before: 'true' });
  assert.match(loadRegistry(two).errors[0].message, /only one migration may set version_record_before/);
});

test('a missing registry file is refused', () => {
  const dir = tmp();
  assert.equal(loadRegistry(dir).errors[0].code, 'registry-invalid');
});

test('compareVersions orders MAJOR.MINOR.PATCH and isSupported uses supported_from', () => {
  assert.equal(compareVersions('0.9.0', '0.10.0'), -1);
  assert.equal(compareVersions('1.0.0', '0.99.99'), 1);
  assert.equal(compareVersions('0.3.1', '0.3.1'), 0);
  assert.throws(() => compareVersions('0.3', '0.3.1'), TypeError);
  const registry = { supported_from: '0.5.0' };
  assert.equal(isSupported(registry, '0.4.9'), false);
  assert.equal(isSupported(registry, '0.5.0'), true);
  assert.equal(isSupported(registry, null), true);
  assert.equal(isSupported({ supported_from: null }, '0.0.1'), true);
});

// ---------------------------------------------------------------- running

test('a migration that is not needed is not applied; a complete one stays complete', async () => {
  globalThis.__log = [];
  const dir = registryDir();
  migration(dir, 'a', {}, { detect: false });
  migration(dir, 'b', {}, { detect: false });
  const registry = loadRegistry(dir);
  const run = await runRegistry(tmp(), { registry, state: new Map([['b', 'complete']]), from: '0.1.0' });
  assert.equal(run.fatal, false);
  assert.deepEqual([...run.statuses], [['a', 'not-needed'], ['b', 'complete']]);
  assert.deepEqual(globalThis.__log, ['detect:a', 'detect:b']);
});

test('a needed migration is applied and its status is kept; a pending state runs it even when detect says no', async () => {
  globalThis.__log = [];
  const dir = registryDir();
  migration(dir, 'a', {}, { detect: true, apply: { status: 'complete', changed: ['x.md'] } });
  migration(dir, 'b', { guided: 'guided.md', complete: 'complete.mjs' }, { detect: true, apply: { status: 'pending', changed: ['y.md'] } });
  migration(dir, 'c', {}, { detect: false, apply: { status: 'complete' } });
  const registry = loadRegistry(dir);
  const run = await runRegistry(tmp(), { registry, state: new Map([['c', 'pending']]), from: '0.1.0' });
  assert.deepEqual([...run.statuses], [['a', 'complete'], ['b', 'pending'], ['c', 'complete']]);
  assert.deepEqual(run.details.a.changed, ['x.md']);
  assert.deepEqual(run.details.b.changed, ['y.md']);
  assert.ok(globalThis.__log.includes('apply:a') && globalThis.__log.includes('apply:b') && globalThis.__log.includes('apply:c'));
});

test('from_version_below runs the migration for an older campaign and not for a current one; an unknown version counts as older', async () => {
  globalThis.__log = [];
  const dir = registryDir();
  migration(dir, 'old', { needed: '{from_version_below: "0.3.0"}' }, { detect: false });
  const registry = loadRegistry(dir);
  const older = await runRegistry(tmp(), { registry, from: '0.2.9' });
  assert.equal(older.statuses.get('old'), 'complete');
  const current = await runRegistry(tmp(), { registry, from: '0.3.0' });
  assert.equal(current.statuses.get('old'), 'not-needed');
  const unknown = await runRegistry(tmp(), { registry, from: null });
  assert.equal(unknown.statuses.get('old'), 'complete');
});

test('a guided migration without a deterministic part is pending when it is needed by version', async () => {
  const dir = registryDir();
  migration(dir, 'guide', { deterministic: 'null', guided: 'guided.md', complete: 'complete.mjs', needed: '{from_version_below: "0.3.0"}' });
  const registry = loadRegistry(dir);
  assert.deepEqual(registry.errors, []);
  const run = await runRegistry(tmp(), { registry, from: '0.1.0' });
  assert.equal(run.statuses.get('guide'), 'pending');
});

test('a failed migration stops the run, returns its errors with their codes, and does not record the version', async () => {
  globalThis.__log = [];
  const dir = registryDir();
  migration(dir, 'a', {}, { apply: { status: 'failed', errors: [{ message: 'broken sheet', file: 'x.md' }] } });
  migration(dir, 'b', { version_record_before: 'true' }, {});
  const registry = loadRegistry(dir);
  let recorded = 0;
  const run = await runRegistry(tmp(), { registry, from: '0.1.0', recordVersion: () => { recorded += 1; } });
  assert.equal(run.fatal, true);
  assert.equal(run.errors[0].code, 'a-failed');
  assert.equal(run.errors[0].file, 'x.md');
  assert.equal(run.statuses.has('b'), false);
  assert.equal(recorded, 0);
  assert.deepEqual(globalThis.__log, ['detect:a', 'apply:a']);
});

test('the framework version is recorded just before the migration that asks for it, and at the end otherwise', async () => {
  const dir = registryDir();
  migration(dir, 'a');
  migration(dir, 'b', { after: '[a]', version_record_before: 'true' });
  migration(dir, 'c', { after: '[b]' });
  const registry = loadRegistry(dir);
  globalThis.__log = [];
  await runRegistry(tmp(), { registry, from: '0.1.0', recordVersion: () => globalThis.__log.push('record') });
  assert.deepEqual(globalThis.__log, ['detect:a', 'apply:a', 'record', 'detect:b', 'apply:b', 'detect:c', 'apply:c']);

  const plain = registryDir();
  migration(plain, 'only');
  globalThis.__log = [];
  await runRegistry(tmp(), { registry: loadRegistry(plain), from: '0.1.0', recordVersion: () => globalThis.__log.push('record') });
  assert.deepEqual(globalThis.__log, ['detect:only', 'apply:only', 'record']);
});

test('a dry run passes dryRun to every apply and never records the version', async () => {
  globalThis.__log = [];
  const dir = registryDir();
  migration(dir, 'a');
  let recorded = 0;
  const run = await runRegistry(tmp(), { registry: loadRegistry(dir), from: '0.1.0', dryRun: true, recordVersion: () => { recorded += 1; } });
  assert.equal(run.statuses.get('a'), 'complete');
  assert.equal(recorded, 0);
  assert.deepEqual(globalThis.__log, ['detect:a', 'apply:a:dry']);
});

test('a pending migration without a guided part fails outside a dry run', async () => {
  const dir = registryDir();
  migration(dir, 'a', {}, { apply: { status: 'pending' } });
  const run = await runRegistry(tmp(), { registry: loadRegistry(dir), from: '0.1.0' });
  assert.equal(run.fatal, true);
  assert.equal(run.errors[0].code, 'migration-incomplete');
  const dry = await runRegistry(tmp(), { registry: loadRegistry(dir), from: '0.1.0', dryRun: true });
  assert.equal(dry.fatal, false);
  assert.equal(dry.statuses.get('a'), 'pending');
});

test('runComplete reports a migration without a guided part, and passes on the result of its complete check', async () => {
  const dir = registryDir();
  migration(dir, 'plain');
  migration(dir, 'guided', { guided: 'guided.md', complete: 'complete.mjs' }, { complete: { status: 'pending', errors: [{ code: 'open', message: 'one item is open' }] } });
  const registry = loadRegistry(dir);
  const plain = registry.migrations.find((m) => m.id === 'plain');
  const guided = registry.migrations.find((m) => m.id === 'guided');
  assert.equal((await runComplete(tmp(), plain)).errors[0].code, 'no-guided-part');
  const result = await runComplete(tmp(), guided);
  assert.equal(result.status, 'pending');
  assert.equal(result.errors[0].code, 'open');
});
