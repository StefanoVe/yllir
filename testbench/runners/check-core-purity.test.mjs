// Tests for check-core-purity.mjs on synthetic repositories built in temp dirs.
// Run: node --test testbench/runners/check-core-purity.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { checkPurity, loadConfig, scanText } from './check-core-purity.mjs';

const SCRIPT = path.join(import.meta.dirname, 'check-core-purity.mjs');

/** Writes a file (creating folders) under root. */
function write(root, rel, text) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
}

/** A fresh synthetic repo with a skill, a system module and a config file. */
function makeRepo(t, { configText = null, files = {} } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'core-purity-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  write(root, 'yllir/skills/x/SKILL.md', 'Use the D&D rules\nthe word dnding is not a hit\n');
  write(root, 'yllir/modules/systems/foo/a.md', 'D&D lives here\n');
  for (const [rel, text] of Object.entries(files)) write(root, rel, text);
  const config = path.join(root, 'core-purity.yaml');
  fs.writeFileSync(config, configText ?? defaultConfig());
  return { root, config };
}

function defaultConfig(allow = '') {
  const allowBlock = allow === '' ? 'allow: []' : `allow:\n${allow}`;
  return [
    'scan:',
    '  - yllir',
    'exclude:',
    '  - yllir/modules',
    'terms:',
    '  - D&D',
    '  - dnd',
    '  - 5e',
    allowBlock,
    '',
  ].join('\n');
}

test('D&D in a skill is a hit at the right line, "dnding" is not', (t) => {
  const { root, config } = makeRepo(t);
  const result = checkPurity({ root, config: loadConfig(config) });
  assert.equal(result.hits.length, 1);
  assert.equal(result.hits[0].file, 'yllir/skills/x/SKILL.md');
  assert.equal(result.hits[0].line, 1);
  assert.equal(result.hits[0].term, 'D&D');
  assert.equal(result.hits[0].excerpt, 'Use the D&D rules');
  assert.deepEqual(result.allowed, []);
});

test('scanText matches case-insensitively and respects word boundaries', () => {
  assert.deepEqual(scanText('the word dnding', ['dnd']), []);
  const found = scanText('a DND game\nplay dnd now', ['dnd']);
  assert.deepEqual(found.map((hit) => [hit.line, hit.column, hit.term]), [
    [1, 3, 'dnd'],
    [2, 6, 'dnd'],
  ]);
});

test('a term repeated on one line is reported once, at its first column', () => {
  const found = scanText('D&D and then D&D again\nno match here', ['D&D']);
  assert.deepEqual(found.map((hit) => [hit.line, hit.column, hit.term]), [[1, 1, 'D&D']]);
});

test('5e matches in "use 5e rules" and not in "a5e" or "5eth"', () => {
  assert.equal(scanText('use 5e rules', ['5e']).length, 1);
  assert.equal(scanText('a5e', ['5e']).length, 0);
  assert.equal(scanText('5eth edition', ['5e']).length, 0);
});

test('a term glued to a hyphen or underscore is not a word match', () => {
  assert.equal(scanText('dnd-2024', ['dnd']).length, 0);
  assert.equal(scanText('my_dnd_note', ['dnd']).length, 0);
});

test('a module folder excluded by the config is not scanned', (t) => {
  const { root, config } = makeRepo(t);
  const result = checkPurity({ root, config: loadConfig(config) });
  assert.equal(result.hits.some((hit) => hit.file.startsWith('yllir/modules/')), false);
  assert.equal(result.hits.length, 1);
});

test('a file-exact allow entry moves the hit to allowed with its reason', (t) => {
  const allow = [
    '  - file: yllir/skills/x/SKILL.md',
    '    term: D&D',
    '    reason: test fixture for the allow list',
  ].join('\n');
  const { root, config } = makeRepo(t, { configText: defaultConfig(allow) });
  const result = checkPurity({ root, config: loadConfig(config) });
  assert.equal(result.hits.length, 0);
  assert.equal(result.allowed.length, 1);
  assert.equal(result.allowed[0].reason, 'test fixture for the allow list');
  assert.deepEqual(result.unusedAllow, []);
});

test('a prefix allow entry (file ends with /) covers every file under it', (t) => {
  const allow = [
    '  - file: yllir/skills/',
    '    term: D&D',
    '    reason: whole skills folder is a fixture',
  ].join('\n');
  const { root, config } = makeRepo(t, {
    configText: defaultConfig(allow),
    files: { 'yllir/skills/x/other.mjs': '// D&D again\n' },
  });
  const result = checkPurity({ root, config: loadConfig(config) });
  assert.equal(result.hits.length, 0);
  assert.equal(result.allowed.length, 2);
});

test('term "*" allows every term in the file', (t) => {
  const allow = ['  - file: yllir/skills/x/SKILL.md', '    term: "*"', '    reason: every term here is a fixture'].join('\n');
  const { root, config } = makeRepo(t, {
    configText: defaultConfig(allow),
    files: { 'yllir/skills/x/SKILL.md': 'Use the D&D rules and dnd\n' },
  });
  const result = checkPurity({ root, config: loadConfig(config) });
  assert.equal(result.hits.length, 0);
  assert.equal(result.allowed.length, 2);
});

test('an allow entry that matches nothing is reported as unused', (t) => {
  const allow = [
    '  - file: yllir/skills/x/SKILL.md',
    '    term: Pathfinder',
    '    reason: no such text in this repo',
  ].join('\n');
  const { root, config } = makeRepo(t, { configText: defaultConfig(allow) });
  const result = checkPurity({ root, config: loadConfig(config) });
  assert.equal(result.hits.length, 1);
  assert.deepEqual(result.unusedAllow, [
    { file: 'yllir/skills/x/SKILL.md', term: 'Pathfinder', reason: 'no such text in this repo' },
  ]);
});

test('loadConfig rejects an allow entry without a reason', (t) => {
  const bad = [
    'scan:', '  - yllir', 'terms:', '  - D&D', 'allow:',
    '  - file: yllir/skills/x/SKILL.md', '    term: D&D',
    '',
  ].join('\n');
  const { config } = makeRepo(t, { configText: bad });
  assert.throws(() => loadConfig(config), /needs a non-empty reason/);
});

test('CLI exits 1 on a hit and 0 when every hit is allowed', (t) => {
  const { root, config } = makeRepo(t);
  let status = 0;
  let stdout = '';
  try {
    stdout = execFileSync(process.execPath, [SCRIPT, '--config', config, '--root', root], { encoding: 'utf8' });
  } catch (err) {
    status = err.status;
    stdout = err.stdout;
  }
  assert.equal(status, 1);
  assert.match(stdout, /^yllir\/skills\/x\/SKILL\.md:1  D&D  Use the D&D rules$/m);
  assert.match(stdout, /^purity: 1 hits, 0 allowed, 0 unused allow entries$/m);

  const allow = ['  - file: yllir/skills/', '    term: "*"', '    reason: fixture folder'].join('\n');
  fs.writeFileSync(config, defaultConfig(allow));
  const ok = execFileSync(process.execPath, [SCRIPT, '--config', config, '--root', root], { encoding: 'utf8' });
  assert.match(ok, /^purity: 0 hits, 1 allowed, 0 unused allow entries$/m);
});

test('CLI exits 2 when the config cannot be read', (t) => {
  const { root } = makeRepo(t);
  let status = 0;
  try {
    execFileSync(process.execPath, [SCRIPT, '--config', path.join(root, 'missing.yaml'), '--root', root], {
      encoding: 'utf8',
      stdio: 'pipe',
    });
  } catch (err) {
    status = err.status;
  }
  assert.equal(status, 2);
});
