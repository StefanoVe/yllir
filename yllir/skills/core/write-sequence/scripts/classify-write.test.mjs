import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('./classify-write.mjs', import.meta.url));

const CAMPAIGN = [
  'name: Test',
  'language:',
  '  main: it',
  'structure:',
  '  - id: personaggi',
  '    folder: Personaggi',
  '    type: subjects',
  '  - id: luoghi',
  '    folder: Luoghi',
  '    type: places',
  '  - id: trama',
  '    folder: Trama',
  '    type: plot',
  '',
].join('\n');

const LIRA_SHEET = [
  '---',
  'id: lira-quen',
  'template: npc',
  'location: []',
  '---',
  '',
  '# Lira Quen',
  '',
  '## Ruolo',
  'Mercante di sale.',
  '## Aspetto',
  'Capelli grigi.',
  '',
].join('\n');

function writeTree(base, files) {
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(base, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
}

/** Runs `fn` with a campaign (with a new Lira Quen draft) and a draft folder in a temp root. */
function withWorkspace(fn) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-classify-cli-'));
  try {
    const campaign = path.join(tmp, 'campaign');
    const drafts = path.join(tmp, 'drafts');
    writeTree(campaign, {
      'campaign.yaml': CAMPAIGN,
      'Luoghi/Porto.md': '---\nid: porto-nero\ntemplate: place\nlocation: []\n---\n\n# Porto Nero\n\nUn porto.\n',
    });
    writeTree(drafts, { 'Personaggi/Lira Quen.md': LIRA_SHEET });
    return fn({ tmp, campaign, drafts, out: path.join(tmp, 'out', 'result.json') });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function runCli(args) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
}

function stdoutLines(result) {
  return result.stdout.split('\n').filter((line) => line !== '');
}

test('prints the level first and exit 0 last, and writes the JSON result', () => {
  withWorkspace(({ campaign, drafts, out }) => {
    const result = runCli([campaign, '--files', 'Personaggi/Lira Quen.md', '--draft-dir', drafts, '--out', out]);
    assert.equal(result.status, 0, result.stderr);

    const lines = stdoutLines(result);
    assert.equal(lines[0], 'level: low');
    assert.match(lines[1], /^decided by: /);
    assert.ok(lines.some((line) => line.startsWith('measure size 10 low')));
    assert.ok(lines.some((line) => line === 'measures: 7'));
    assert.equal(lines[lines.length - 1], 'exit: 0');

    const json = JSON.parse(fs.readFileSync(out, 'utf8'));
    assert.equal(json.level, 'low');
    assert.ok(Array.isArray(json.decidedBy));
    assert.ok(Array.isArray(json.measures));
    assert.ok(Array.isArray(json.reach));
  });
});

test('a high level still exits 0 and lists reach files', () => {
  withWorkspace(({ campaign, drafts, out }) => {
    // An existing document that mentions the new sheet is a reach file.
    writeTree(campaign, { 'Luoghi/Taverna.md': '# Taverna\n\nLira Quen beve qui.\n' });
    // A plot draft in the Trama folder makes the change high by content.
    writeTree(drafts, { 'Trama/Il Patto.md': '# Il Patto\n\nLira Quen firma il patto.\n' });
    const result = runCli([
      campaign,
      '--files',
      'Personaggi/Lira Quen.md,Trama/Il Patto.md',
      '--draft-dir',
      drafts,
      '--subjects',
      'lira-quen',
      '--out',
      out,
    ]);
    assert.equal(result.status, 0, result.stderr);
    const lines = stdoutLines(result);
    assert.equal(lines[0], 'level: high');
    assert.ok(lines.includes('measure content subjects,plot high'));
    assert.ok(lines.includes('measure breadth 2+1 medium'));
    assert.ok(lines.includes('reach Luoghi/Taverna.md'));
    assert.equal(lines[lines.length - 1], 'exit: 0');
  });
});

test('a missing draft prints a high draft measure and exits 0', () => {
  withWorkspace(({ campaign, drafts, out }) => {
    const result = runCli([campaign, '--files', 'Personaggi/Nessuno.md', '--draft-dir', drafts, '--out', out]);
    assert.equal(result.status, 0, result.stderr);
    const lines = stdoutLines(result);
    assert.equal(lines[0], 'level: high');
    assert.ok(lines.includes('measure draft missing: Personaggi/Nessuno.md high'));
    assert.equal(lines[lines.length - 1], 'exit: 0');
  });
});

test('a missing --out is a usage error: exit 2 and exit line printed', () => {
  withWorkspace(({ campaign, drafts }) => {
    const result = runCli([campaign, '--files', 'Personaggi/Lira Quen.md', '--draft-dir', drafts]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /usage:/);
    assert.equal(stdoutLines(result).at(-1), 'exit: 2');
  });
});

test('an unknown option is a usage error: exit 2', () => {
  withWorkspace(({ campaign, drafts, out }) => {
    const result = runCli([
      campaign,
      '--files',
      'Personaggi/Lira Quen.md',
      '--draft-dir',
      drafts,
      '--out',
      out,
      '--bogus',
      'x',
    ]);
    assert.equal(result.status, 2);
    assert.equal(stdoutLines(result).at(-1), 'exit: 2');
    assert.equal(fs.existsSync(out), false);
  });
});

test('a repeated option or a missing value is a usage error: exit 2', () => {
  withWorkspace(({ campaign, drafts, out }) => {
    const repeated = runCli([
      campaign, '--files', 'a.md', '--files', 'b.md', '--draft-dir', drafts, '--out', out,
    ]);
    assert.equal(repeated.status, 2);

    const missingValue = runCli([campaign, '--files', 'a.md', '--draft-dir', drafts, '--out']);
    assert.equal(missingValue.status, 2);
    assert.equal(stdoutLines(missingValue).at(-1), 'exit: 2');
  });
});
