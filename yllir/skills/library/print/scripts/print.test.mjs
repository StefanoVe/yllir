import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs, validateOptions, parseCopies } from './print.mjs';
import { objectSheet, makeCampaign, removeCampaign } from './lib/fixtures.mjs';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), 'print.mjs');

/** Runs the CLI and returns its exit code and parsed JSON (the `exit:` line is checked). */
function run(args, env = {}) {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
    return { code: 0, ...parse(stdout) };
  } catch (err) {
    return { code: err.status, ...parse(err.stdout.toString()) };
  }
}

function parse(stdout) {
  const lines = stdout.trimEnd().split('\n');
  const last = lines.pop();
  const match = /^exit: (\d+)$/.exec(last);
  assert.ok(match, `the last line is the exit line: ${last}`);
  let json = null;
  try {
    json = JSON.parse(lines.join('\n'));
  } catch {
    json = null;
  }
  return { exit: Number(match[1]), json };
}

test('argument parsing and option validation', () => {
  assert.equal(parseArgs([]).error, 'unknown command');
  assert.match(parseArgs(['list']).error, /campaign folder/);
  assert.match(parseArgs(['list', '/x', '--bogus']).error, /unknown option/);
  assert.match(parseArgs(['sheets', '/x', '--format']).error, /needs a value/);
  const parsed = parseArgs(['render-card', '/x', '--id', 'a', '--overwrite']);
  assert.equal(parsed.options['--overwrite'], true);
  assert.match(validateOptions('state', { '--id': 'a', '--state': 'done' }), /--state/);
  assert.match(validateOptions('state', { '--id': 'A B', '--state': 'printed' }), /valid id/);
  assert.match(validateOptions('sheets', { '--format': 'letter' }), /--format/);
  assert.match(validateOptions('sheets', { '--cmyk': 'yes' }), /--cmyk/);
  assert.match(validateOptions('sheets', { '--ids': 'ok,Bad Id' }), /--ids/);
  assert.equal(validateOptions('sheets', { '--ids': 'a,b', '--format': 'a4', '--cmyk': 'true' }), null);
  assert.deepEqual(parseCopies('a=2,b-c=3').copies, { a: 2, 'b-c': 3 });
  assert.match(parseCopies('a=0').error, /between 1 and 50/);
  assert.match(parseCopies('a').error, /id=n/);
});

test('exit codes: 2 for usage, 1 for refusals, 0 for work done', () => {
  assert.equal(run([]).exit, 2);
  assert.equal(run(['bogus', '/x']).exit, 2);
  assert.equal(run(['state', '/x', '--id', 'a']).exit, 2, 'state needs a valid --state');
  const root = makeCampaign({
    sheets: {
      'Oggetti/Lanterna.md': objectSheet({ id: 'lanterna', title: 'Lanterna', shortText: 'Breve.' }),
      'Oggetti/Vuota.md': objectSheet({ id: 'vuota', title: 'Vuota' }),
    },
  });
  try {
    assert.equal(run(['sheets', root, '--copies', 'lanterna=0']).exit, 2);
    assert.equal(run(['sheets', root, '--format', 'letter']).exit, 2);
    assert.equal(run(['state', root, '--id', 'nessuno', '--state', 'to-print']).exit, 1);
    assert.equal(run(['render-card', root, '--id', 'vuota', '--renderer', 'node']).exit, 1, 'a card without public text is refused');
    const list = run(['list', root]);
    assert.equal(list.exit, 0);
    assert.equal(list.json.cards.length, 2);
    const sheets = run(['sheets', root, '--ids', 'lanterna', '--format', 'a4', '--cmyk', 'false'], { YLLIR_NOW: '2026-11-12T10:00:00Z' });
    assert.equal(sheets.exit, 0);
    assert.equal(sheets.json.pages, 2);
    assert.match(sheets.json.file, /^\.campaign\/cache\/print\/sheets-20261112T100000Z\.pdf$/);
    assert.equal(run(['sheets', root, '--ids', 'vuota']).exit, 1);
    assert.equal(run(['sheets', root], { YLLIR_NOW: 'no' }).exit, 2);
  } finally {
    removeCampaign(root);
  }
});
