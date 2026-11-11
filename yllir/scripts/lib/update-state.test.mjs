import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatUpdateState, parseUpdateState, pendingMigrations } from './update-state.mjs';

test('the current form is read: fields, and migrations in the order written', () => {
  const state = parseUpdateState([
    'status: in_progress',
    'from_version: "0.0.1"',
    'to_version: "0.34.0"',
    'restore_point: "abc1234"',
    'started_on: 2026-11-11',
    'migrations:',
    '  - id: "session-layout-v1"',
    '    status: complete',
    '  - id: "statistics-tables-v1"',
    '    status: pending',
    '',
  ].join('\n'));
  assert.equal(state.status, 'in_progress');
  assert.equal(state.from_version, '0.0.1');
  assert.equal(state.started_on, '2026-11-11');
  assert.deepEqual([...state.migrations], [['session-layout-v1', 'complete'], ['statistics-tables-v1', 'pending']]);
  assert.deepEqual(pendingMigrations(state), ['statistics-tables-v1']);
});

test('the older form is translated: sheet, geography and world keys become migrations', () => {
  const state = parseUpdateState([
    'status: completed',
    'from_version: "0.0.1"',
    'sheet_migration_id: "statistics-tables-v1"',
    'sheet_migration: pending',
    'geography_migration_id: "category-first-geography-v1"',
    'geography_migration: complete',
    'world_migration_id: "world-graph-v1"',
    'world_migration: pending',
    '',
  ].join('\n'));
  assert.equal(state.status, 'completed');
  assert.deepEqual([...state.migrations], [
    ['category-first-geography-v1', 'complete'],
    ['statistics-tables-v1', 'pending'],
    ['world-graph-v1', 'pending'],
  ]);
  assert.deepEqual(pendingMigrations(state), ['statistics-tables-v1', 'world-graph-v1']);
});

test('when both forms are present, the current list wins for the same id', () => {
  const state = parseUpdateState('sheet_migration: pending\nmigrations:\n  - id: "statistics-tables-v1"\n    status: complete\n');
  assert.deepEqual([...state.migrations], [['statistics-tables-v1', 'complete']]);
});

test('an unreadable file, or a migration entry that is not valid, gives null', () => {
  assert.equal(parseUpdateState('status: [broken\n'), null);
  assert.equal(parseUpdateState('migrations:\n  - id: "a"\n    status: maybe\n'), null);
  assert.equal(parseUpdateState('migrations: pending\n'), null);
});

test('a file with no migrations has none pending', () => {
  const state = parseUpdateState('status: completed\n');
  assert.equal(state.migrations.size, 0);
  assert.deepEqual(pendingMigrations(state), []);
});

test('formatUpdateState writes the fields in order and the migrations as a list; it reads back the same', () => {
  const text = formatUpdateState(
    { status: 'completed', from_version: '0.0.1', to_version: '0.34.0', restore_point: 'abc1234', started_on: '2026-11-11', completed_on: '2026-11-11' },
    [['session-layout-v1', 'complete'], ['statistics-tables-v1', 'pending']],
  );
  assert.equal(
    text,
    [
      'status: completed',
      'from_version: "0.0.1"',
      'to_version: "0.34.0"',
      'restore_point: "abc1234"',
      'started_on: 2026-11-11',
      'completed_on: 2026-11-11',
      'migrations:',
      '  - id: "session-layout-v1"',
      '    status: complete',
      '  - id: "statistics-tables-v1"',
      '    status: pending',
      '',
    ].join('\n'),
  );
  assert.deepEqual([...parseUpdateState(text).migrations], [['session-layout-v1', 'complete'], ['statistics-tables-v1', 'pending']]);
});

test('an empty migration list is written as an empty flow list and reads back empty', () => {
  const text = formatUpdateState({ status: 'in_progress' }, []);
  assert.equal(text, 'status: in_progress\nmigrations: []\n');
  assert.equal(parseUpdateState(text).migrations.size, 0);
});

test('formatUpdateState refuses an unknown status and a value that cannot be quoted', () => {
  assert.throws(() => formatUpdateState({}, [['a', 'failed']]), TypeError);
  assert.throws(() => formatUpdateState({ from_version: 'a "b"' }, []), TypeError);
});
