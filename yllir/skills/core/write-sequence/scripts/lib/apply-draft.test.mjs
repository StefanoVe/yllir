import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyDraft } from './apply-draft.mjs';
import { stripExitLine } from '../../../../../scripts/lib/cli-exit.mjs';

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

/** Root entries except the campaign state folder that holds the draft folder. */
function visibleEntries(root) {
  return fs.readdirSync(root).filter((name) => name !== '.campaign');
}

/** A campaign folder and a separate draft folder with two good drafts and one empty draft. */
function setup() {
  const root = tmp();
  const drafts = path.join(root, '.campaign', 'state', 'write', 'draft');
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

test('drafts and destinations may not pass through symbolic links', () => {
  const { root, drafts } = setup();
  const external = tmp();
  write(drafts, 'World/Harbor.md', '# Harbor\n');
  fs.symlinkSync(external, path.join(root, 'World'));
  const linkedParent = applyDraft(root, { draftDir: drafts, files: ['World/Harbor.md'] });
  assert.equal(linkedParent.errors[0].code, 'symlink-target');
  assert.equal(fs.existsSync(path.join(external, 'Harbor.md')), false);

  fs.rmSync(path.join(root, 'World'));
  fs.mkdirSync(path.join(root, 'World'), { recursive: true });
  const outsideDraft = path.join(external, 'outside.md');
  write(external, 'outside.md', '# Outside\n');
  fs.symlinkSync(outsideDraft, path.join(drafts, 'World', 'Link.md'));
  const linkedDraft = applyDraft(root, { draftDir: drafts, files: ['World/Link.md'] });
  assert.equal(linkedDraft.errors[0].code, 'symlink-draft');
  assert.equal(fs.existsSync(path.join(root, 'World', 'Link.md')), false);
});

test('missing arguments are refused without touching the campaign', () => {
  const { root, drafts } = setup();
  assert.equal(applyDraft(root, { draftDir: drafts, files: [] }).errors[0].code, 'bad-input');
  assert.equal(applyDraft(root, { draftDir: '', files: ['Mondo/Lago.md'] }).errors[0].code, 'bad-input');
  assert.equal(applyDraft(path.join(root, 'nope'), { draftDir: drafts, files: ['a.md'] }).errors[0].code, 'bad-root');
  assert.deepEqual(visibleEntries(root), []);
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

test('apply-draft --out persists the exact stdout JSON for success and refusal', () => {
  const { root, drafts } = setup();
  const output = path.join(root, '.campaign', 'state', 'write', 'applied.json');
  const ok = spawnSync(process.execPath, [CLI, root, '--draft-dir', drafts, '--files', 'Mondo/Lago.md', '--out', output], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(fs.readFileSync(output, 'utf8'), stripExitLine(ok.stdout));
  const refused = spawnSync(process.execPath, [CLI, root, '--draft-dir', drafts, '--files', 'CLAUDE.md', '--out', output], { encoding: 'utf8' });
  assert.equal(refused.status, 1);
  assert.equal(fs.readFileSync(output, 'utf8'), stripExitLine(refused.stdout));
  assert.deepEqual(JSON.parse(fs.readFileSync(output, 'utf8')).errors.map((e) => e.code), ['protected-file']);
});

test('apply-draft refuses an unusable --out before applying drafts', () => {
  const { root, drafts } = setup();
  const output = path.join(root, 'is-a-directory');
  fs.mkdirSync(output);
  const result = spawnSync(process.execPath, [CLI, root, '--draft-dir', drafts, '--files', 'Mondo/Lago.md', '--out', output], { encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.equal(fs.existsSync(path.join(root, 'Mondo')), false);
});

const PLOT_CAMPAIGN = [
  'name: Test',
  'structure:',
  '  - id: trama',
  '    folder: Trama',
  '    type: plot',
  '  - id: luoghi',
  '    folder: Mondo',
  '    type: places',
  '',
].join('\n');

test('a session draft with two events applies the generated main file', () => {
  const root = tmp();
  const drafts = path.join(root, '.campaign', 'state', 'write', 'draft');
  write(root, 'campaign.yaml', PLOT_CAMPAIGN);
  write(drafts, 'Trama/Il faro/Il faro.md', [
    '---',
    'id: il-faro',
    'depends_on: []',
    'location: []',
    'generated: true',
    '---',
    '',
    'Generated file. Do not edit by hand.',
    '',
  ].join('\n'));
  write(drafts, 'Trama/Il faro/Eventi/Arrivo.md', [
    '---',
    'id: il-faro-arrivo',
    'session: il-faro',
    'depends_on: []',
    'location: []',
    '---',
    '',
    '_La nebbia sale dal molo._',
    '',
  ].join('\n'));
  write(drafts, 'Trama/Il faro/Eventi/Fuga.md', [
    '---',
    'id: il-faro-fuga',
    'session: il-faro',
    'depends_on: [il-faro-arrivo]',
    'location: []',
    '---',
    '',
    '_Le scale scricchiolano._',
    '',
  ].join('\n'));

  const files = ['Trama/Il faro/Il faro.md', 'Trama/Il faro/Eventi/Arrivo.md', 'Trama/Il faro/Eventi/Fuga.md'];
  const result = applyDraft(root, { draftDir: drafts, files });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.written, files);

  const main = fs.readFileSync(path.join(root, 'Trama', 'Il faro', 'Il faro.md'), 'utf8');
  assert.match(main, /^id: il-faro$/m);
  assert.match(main, /^generated: true$/m);
  assert.match(main, /```mermaid\nflowchart TD\n  e1\["Arrivo"\]\n  e2\["Fuga"\]\n  e1 --> e2\n```/);
  assert.match(main, /\[Arrivo\]\(Eventi\/Arrivo\.md\)/);
  assert.match(main, /\[Fuga\]\(Eventi\/Fuga\.md\)/);
  assert.doesNotMatch(main, /Generated file\. Do not edit by hand\.\n\n\n/);
});

test('a campaign with no plot documents in the written files behaves as before', () => {
  const root = tmp();
  const drafts = path.join(root, '.campaign', 'state', 'write', 'draft');
  write(root, 'campaign.yaml', PLOT_CAMPAIGN);
  write(drafts, 'Mondo/Lago.md', '# Lago grigio\n');
  const result = applyDraft(root, { draftDir: drafts, files: ['Mondo/Lago.md'] });
  assert.deepEqual(result, { written: ['Mondo/Lago.md'], errors: [] });
  assert.deepEqual(visibleEntries(root).sort(), ['Mondo', 'campaign.yaml']);
});
