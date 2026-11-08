import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyDraft } from './apply-draft.mjs';
import { stripExitLine } from './cli-exit.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(here, '..', 'apply-draft.mjs');

const created = [];
after(() => {
  for (const dir of created) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-draft-'));
  created.push(dir);
  return dir;
}

function write(dir, file, content) {
  const full = path.join(dir, file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

/** A campaign folder and a separate draft folder with two good drafts and one empty draft. */
function setup() {
  const root = tmp();
  const drafts = tmp();
  write(drafts, 'Trama/Capitolo 1.md', Buffer.from('# Capitolo 1\r\n\r\nLa cenere «cade» piano.\n'));
  write(drafts, 'Mondo/Lago.md', '# Lago grigio\n');
  write(drafts, 'vuoto.md', '');
  return { root, drafts };
}

test('copies each draft byte for byte and creates the parent folders', () => {
  const { root, drafts } = setup();
  const result = applyDraft(root, { draftDir: drafts, files: ['Trama/Capitolo 1.md', 'Mondo/Lago.md'] });
  assert.deepEqual(result, { written: ['Trama/Capitolo 1.md', 'Mondo/Lago.md'], errors: [] });
  assert.ok(Buffer.compare(
    fs.readFileSync(path.join(root, 'Trama', 'Capitolo 1.md')),
    fs.readFileSync(path.join(drafts, 'Trama', 'Capitolo 1.md')),
  ) === 0);
  assert.equal(fs.readFileSync(path.join(root, 'Mondo', 'Lago.md'), 'utf8'), '# Lago grigio\n');
});

test('a relative draft folder is resolved against the campaign folder', () => {
  const root = tmp();
  write(root, 'bozze/Mondo/Lago.md', '# Lago\n');
  const result = applyDraft(root, { draftDir: 'bozze', files: ['Mondo/Lago.md'] });
  assert.deepEqual(result, { written: ['Mondo/Lago.md'], errors: [] });
  assert.equal(fs.readFileSync(path.join(root, 'Mondo', 'Lago.md'), 'utf8'), '# Lago\n');
});

test('each refusal writes nothing, even when the other files are good', () => {
  const cases = [
    ['/etc/passwd.md', 'bad-path'],
    ['../fuori.md', 'bad-path'],
    ['Trama/../../fuori.md', 'bad-path'],
    ['Trama\\x.md', 'bad-path'],
    ['Trama//x.md', 'bad-path'],
    ['.campaign/x.md', 'protected-path'],
    ['Trama/.git/x.md', 'protected-path'],
    ['.git/config.md', 'protected-path'],
    ['CLAUDE.md', 'protected-file'],
    ['AGENTS.md', 'protected-file'],
    ['Trama/AGENTS.md', 'protected-file'],
    ['campaign.yaml', 'protected-file'],
    ['Trama/notes.txt', 'bad-extension'],
    ['Trama/notes.MD', 'bad-extension'],
    ['assente.md', 'missing-draft'],
    ['vuoto.md', 'empty-draft'],
  ];
  for (const [bad, code] of cases) {
    const { root, drafts } = setup();
    const result = applyDraft(root, { draftDir: drafts, files: ['Mondo/Lago.md', bad] });
    assert.deepEqual(result.written, [], bad);
    assert.equal(result.errors.length, 1, bad);
    assert.equal(result.errors[0].code, code, bad);
    assert.equal(fs.existsSync(path.join(root, 'Mondo')), false, `nothing written for ${bad}`);
  }
});

test('a campaign folder that is in the way of a file is refused', () => {
  const { root, drafts } = setup();
  fs.mkdirSync(path.join(root, 'Mondo', 'Lago.md'), { recursive: true });
  write(drafts, 'Mondo/Lago.md', '# Lago\n');
  const result = applyDraft(root, { draftDir: drafts, files: ['Trama/Capitolo 1.md', 'Mondo/Lago.md'] });
  assert.equal(result.errors[0].code, 'bad-target');
  assert.equal(fs.existsSync(path.join(root, 'Trama')), false);
});

test('missing arguments are refused without touching the campaign', () => {
  const { root, drafts } = setup();
  assert.equal(applyDraft(root, { draftDir: drafts, files: [] }).errors[0].code, 'bad-input');
  assert.equal(applyDraft(root, { draftDir: '', files: ['Mondo/Lago.md'] }).errors[0].code, 'bad-input');
  assert.equal(applyDraft(path.join(root, 'nope'), { draftDir: drafts, files: ['a.md'] }).errors[0].code, 'bad-root');
  assert.deepEqual(fs.readdirSync(root), []);
});

test('apply-draft CLI prints JSON and uses exit codes 0, 1 and 2', () => {
  const { root, drafts } = setup();
  const ok = spawnSync(
    process.execPath,
    [CLI, root, '--draft-dir', drafts, '--files', 'Trama/Capitolo 1.md, Mondo/Lago.md'],
    { encoding: 'utf8' },
  );
  assert.equal(ok.status, 0, ok.stderr);
  assert.deepEqual(JSON.parse(stripExitLine(ok.stdout)), { written: ['Trama/Capitolo 1.md', 'Mondo/Lago.md'], errors: [] });

  const refused = spawnSync(process.execPath, [CLI, root, '--draft-dir', drafts, '--files', 'CLAUDE.md'], {
    encoding: 'utf8',
  });
  assert.equal(refused.status, 1);
  assert.equal(JSON.parse(stripExitLine(refused.stdout)).errors[0].code, 'protected-file');

  const usage = spawnSync(process.execPath, [CLI, root, '--draft-dir', drafts], { encoding: 'utf8' });
  assert.equal(usage.status, 2);
  assert.match(usage.stderr, /usage: node apply-draft\.mjs/);
});
