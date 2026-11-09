import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stripExitLine } from './cli-exit.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MODULE = pathToFileURL(path.join(HERE, 'cli-exit.mjs')).href;

/** Runs a tiny ES module that imports cli-exit and executes `body`. */
function runSnippet(body) {
  const code = `import { exitWith, runCli, stripExitLine } from ${JSON.stringify(MODULE)};\n${body}`;
  return spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

describe('cli-exit', () => {
  test('exitWith prints the code as the last line and sets the status', () => {
    const run = runSnippet('exitWith(1);');
    assert.equal(run.stdout, 'exit: 1\n');
    assert.equal(run.status, 1);
  });

  test('the exit line comes after JSON output on its own line', () => {
    const run = runSnippet(
      'process.stdout.write(JSON.stringify({ ok: false, errors: [1] }, null, 2) + "\\n");\nexitWith(1);',
    );
    assert.equal(run.stdout, '{\n  "ok": false,\n  "errors": [\n    1\n  ]\n}\nexit: 1\n');
    assert.equal(run.status, 1);
    assert.deepEqual(JSON.parse(stripExitLine(run.stdout)), { ok: false, errors: [1] });
  });

  test('large output is not truncated by the exit', () => {
    const run = runSnippet(
      'process.stdout.write("x".repeat(2 * 1024 * 1024) + "\\n");\nexitWith(0);',
    );
    assert.equal(run.stdout.length, 2 * 1024 * 1024 + 1 + 'exit: 0\n'.length);
    assert.equal(run.stdout.slice(-'exit: 0\n'.length), 'exit: 0\n');
    assert.equal(run.status, 0);
  });

  test('runCli reports an uncaught error on stderr and exits with 2', () => {
    const run = runSnippet('runCli(() => { throw new Error("boom"); });');
    assert.equal(run.stderr, 'boom\n');
    assert.equal(run.stdout, 'exit: 2\n');
    assert.equal(run.status, 2);
  });

  test('runCli leaves a normal return to the code it set', () => {
    const run = runSnippet('runCli(() => exitWith(0));');
    assert.equal(run.stdout, 'exit: 0\n');
    assert.equal(run.status, 0);
  });

  test('stripExitLine removes only the trailing exit line', () => {
    assert.equal(stripExitLine('a\nexit: 0\n'), 'a\n');
    assert.equal(stripExitLine('exit: 3\n'), '');
    assert.equal(stripExitLine('a\n'), 'a\n');
  });
});
