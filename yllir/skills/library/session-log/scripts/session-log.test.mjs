import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, 'session-log.mjs');

let root;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-cli-'));
  fs.writeFileSync(path.join(root, 'campaign.yaml'), 'name: Test\n');
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

/** Runs the CLI and splits its output into the JSON document and the exit code on the last line. */
function run(...args) {
  const child = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
  const lines = child.stdout.split('\n');
  assert.equal(lines.at(-1), '', 'stdout must end with a newline');
  const exitLine = lines.at(-2);
  assert.match(exitLine, /^exit: \d+$/);
  const exitCode = Number(exitLine.slice('exit: '.length));
  assert.equal(exitCode, child.status, 'the exit line must match the process status');
  const json = JSON.parse(lines.slice(0, -2).join('\n'));
  return { code: exitCode, json, stderr: child.stderr };
}

describe('session-log CLI', () => {
  test('open, add, list, source and end give JSON and exit 0', () => {
    const opened = run('open', root, '--title', 'The drowned ferry');
    assert.equal(opened.code, 0);
    assert.equal(opened.json.ok, true);
    assert.equal(opened.json.session.title, 'The drowned ferry');

    const added = run('add', root, '--kind', 'fact', '--text', 'Varn found the boat.', '--subjects', 'varn, boat');
    assert.equal(added.code, 0);
    assert.equal(added.json.entry.id, 'e-0001');
    assert.deepEqual(added.json.entry.subjects, ['varn', 'boat']);

    const listed = run('list', root);
    assert.equal(listed.code, 0);
    assert.equal(listed.json.entries.length, 1);

    const source = run('source', root);
    assert.equal(source.code, 0);
    assert.match(source.json.markdown, /- Varn found the boat\. \[subjects: varn, boat\]/);

    const ended = run('end', root);
    assert.equal(ended.code, 0);
    assert.ok(ended.json.session.endedAt);
    assert.equal(run('status', root).json.session, null);
  });

  test('a domain error gives exit 1 and a code in the JSON', () => {
    run('open', root);
    const bad = run('add', root, '--kind', 'rumour', '--text', 'x');
    assert.equal(bad.code, 1);
    assert.equal(bad.json.ok, false);
    assert.equal(bad.json.error.code, 'invalid-kind');
  });

  test('a repeated open is a domain error, exit 1', () => {
    run('open', root);
    const again = run('open', root);
    assert.equal(again.code, 1);
    assert.equal(again.json.error.code, 'already-open');
  });

  test('usage errors give exit 2 and one JSON document', () => {
    const none = spawnSync(process.execPath, [CLI], { encoding: 'utf8' });
    assert.equal(none.status, 2);
    assert.equal(none.stdout.split('\n').at(-2), 'exit: 2');

    const unknownOp = run('explode', root);
    assert.equal(unknownOp.code, 2);
    assert.equal(unknownOp.json.error.code, 'usage');

    const unknownOption = run('open', root, '--colour', 'red');
    assert.equal(unknownOption.code, 2);

    const missingValue = run('open', root, '--title');
    assert.equal(missingValue.code, 2);

    const missingKind = run('add', root, '--text', 'x');
    assert.equal(missingKind.code, 2);

    const badBoolean = run('update', root, '--id', 'e-0001', '--resolved', 'maybe');
    assert.equal(badBoolean.code, 2);
  });

  test('a path with traversal in --scene is a domain error', () => {
    run('open', root);
    const result = run('add', root, '--kind', 'fact', '--text', 'x', '--scene', '../../etc/passwd');
    assert.equal(result.code, 1);
    assert.equal(result.json.error.code, 'invalid-scene');
  });

  test('update clears scene with an empty value and resolves a thread', () => {
    run('open', root);
    run('add', root, '--kind', 'thread', '--text', 'Who owns the key?', '--scene', 'Plot/A/s1.md');
    const updated = run('update', root, '--id', 'e-0001', '--scene', '', '--resolved', 'true');
    assert.equal(updated.code, 0);
    assert.equal(updated.json.entry.scene, undefined);
    assert.equal(updated.json.entry.resolved, true);
  });

  test('remove and then add never reuses the id', () => {
    run('open', root);
    run('add', root, '--kind', 'fact', '--text', 'One.');
    run('add', root, '--kind', 'fact', '--text', 'Two.');
    assert.equal(run('remove', root, '--id', 'e-0002').code, 0);
    assert.equal(run('add', root, '--kind', 'fact', '--text', 'Three.').json.entry.id, 'e-0003');
  });
});
