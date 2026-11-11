import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { turnCheck } from './turn-check.mjs';

// Git identity and config must come from the test only.
process.env.GIT_CONFIG_GLOBAL = '/dev/null';
process.env.GIT_CONFIG_NOSYSTEM = '1';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(here, '../user-prompt.mjs');
const HEADER = 'YLLIR TURN CHECK (for the assistant, not for the master)';
const NEXT = 'next: invoke the skill yllir:yllir before answering the master.';

const tempDirs = [];
after(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-turn-'));
  tempDirs.push(dir);
  return dir;
}

/** A campaign.yaml with the structure the linker needs (a subjects folder and a plot folder). */
const CAMPAIGN_YAML = [
  'name: Test',
  'structure:',
  '  - id: people',
  '    folder: People',
  '    type: subjects',
  '  - id: plot',
  '    folder: Trama',
  '    type: plot',
  '',
].join('\n');

/** Campaign folder with campaign.yaml. The linker needs the structure to plan the links. */
function campaign() {
  const root = tempDir();
  fs.writeFileSync(path.join(root, 'campaign.yaml'), CAMPAIGN_YAML);
  return root;
}

/** Replaces the body of one `##` section of a handoff file. */
function setSection(file, name, body) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const start = lines.indexOf(`## ${name}`);
  assert.notEqual(start, -1, `section ${name} exists`);
  let end = lines.findIndex((line, i) => i > start && line.startsWith('## '));
  if (end === -1) end = lines.length;
  lines.splice(start + 1, end - start - 1, '', body, '');
  fs.writeFileSync(file, lines.join('\n'));
}

/** The campaign root line for a root that exists (real path) or not (resolved path). */
function rootLine(root) {
  const real = fs.existsSync(root) ? fs.realpathSync(root) : path.resolve(root);
  return `campaign root: ${real}`;
}

function listFiles(dir) {
  const out = [];
  const walk = (current, rel) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const relPath = rel === '' ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(path.join(current, entry.name), relPath);
      } else {
        out.push(`${relPath}:${fs.readFileSync(path.join(current, entry.name), 'utf8')}`);
      }
    }
  };
  walk(dir, '');
  return out.sort();
}

describe('turnCheck', () => {
  test('a folder without campaign.yaml has no work note', () => {
    const root = tempDir();
    assert.equal(
      turnCheck(root),
      [HEADER, rootLine(root), 'work note: none', NEXT].join('\n'),
    );
  });

  test('a nonexistent root does not throw', () => {
    const root = path.join(tempDir(), 'missing');
    assert.equal(
      turnCheck(root),
      [HEADER, rootLine(root), 'work note: none', NEXT].join('\n'),
    );
  });

  test('a campaign with no work note says none', () => {
    const root = campaign();
    assert.equal(
      turnCheck(root),
      [HEADER, rootLine(root), 'work note: none', 'unlinked mentions: none', NEXT].join('\n'),
    );
  });

  test('the note line of the work note is shown, and no other line of it', () => {
    const root = campaign();
    writeNote(root, '# Work in progress\nupdated: 2026-11-10T10:00:00.000Z\nlast saved: none\nfiles: Trama/A.md\nnote: Rivedere Teodo Marr.\n');
    assert.equal(
      turnCheck(root),
      [HEADER, rootLine(root), 'work note: Rivedere Teodo Marr.', 'unlinked mentions: none', NEXT].join('\n'),
    );
  });

  test('a work note with an empty note line says none', () => {
    const root = campaign();
    writeNote(root, '# Work in progress\nnote: none\n');
    assert.equal(
      turnCheck(root),
      [HEADER, rootLine(root), 'work note: none', 'unlinked mentions: none', NEXT].join('\n'),
    );
  });
});

/** Writes the engine's work note of a campaign folder. */
function writeNote(root, text) {
  fs.mkdirSync(path.join(root, '.campaign', 'state'), { recursive: true });
  fs.writeFileSync(path.join(root, '.campaign', 'state', 'work-note.md'), text);
}

/** Campaign folder with a subjects folder and a plot folder, for mention tests. */
function structuredCampaign() {
  const root = campaign();
  fs.mkdirSync(path.join(root, 'People'));
  fs.mkdirSync(path.join(root, 'Trama'));
  fs.writeFileSync(
    path.join(root, 'People', 'Teodo Marr.md'),
    '---\nid: teodo-marr\n---\n\n# Teodo Marr\n\nUn testo.\n',
  );
  return root;
}

/** The unlinked-mentions line of a check text, or undefined when there is none. */
function unlinkedOf(text) {
  return text.split('\n').find((line) => line.startsWith('unlinked mentions: '));
}

describe('unlinked mentions line', () => {
  test('none when no file has an unlinked mention', () => {
    const root = structuredCampaign();
    fs.writeFileSync(path.join(root, 'Trama', 'A.md'), '# A\n\nVedi [Teodo Marr](../People/Teodo%20Marr.md).\n');
    assert.equal(unlinkedOf(turnCheck(root)), 'unlinked mentions: none');
  });

  test('one file with a bare mention is listed, just before the next line', () => {
    const root = structuredCampaign();
    fs.writeFileSync(path.join(root, 'Trama', 'A.md'), '# A\n\nC\'è Teodo Marr qui.\n');
    assert.equal(
      turnCheck(root),
      [HEADER, rootLine(root), 'work note: none', 'unlinked mentions: 1 files: Trama/A.md', NEXT].join('\n'),
    );
  });

  test('more than five files: five listed, then the count of the rest', () => {
    const root = structuredCampaign();
    for (const name of ['F1', 'F2', 'F3', 'F4', 'F5', 'F6']) {
      fs.writeFileSync(path.join(root, 'Trama', `${name}.md`), '# X\n\nC\'è Teodo Marr qui.\n');
    }
    assert.equal(
      unlinkedOf(turnCheck(root)),
      'unlinked mentions: 6 files: Trama/F1.md, Trama/F2.md, Trama/F3.md, Trama/F4.md, Trama/F5.md, and 1 more',
    );
  });

  test('a campaign whose structure cannot be read says unknown, and nothing throws', () => {
    const root = tempDir();
    fs.writeFileSync(path.join(root, 'campaign.yaml'), 'schema: 1\n');
    assert.equal(unlinkedOf(turnCheck(root)), 'unlinked mentions: unknown');
  });

  test('a folder without campaign.yaml has no unlinked mentions line', () => {
    const root = structuredCampaign();
    fs.rmSync(path.join(root, 'campaign.yaml'));
    fs.writeFileSync(path.join(root, 'Trama', 'A.md'), '# A\n\nC\'è Teodo Marr qui.\n');
    assert.equal(unlinkedOf(turnCheck(root)), undefined);
  });
});

describe('user-prompt CLI', () => {
  test('exits 0 and prints the check for a nonexistent root', () => {
    const root = path.join(tempDir(), 'missing');
    const output = execFileSync(process.execPath, [CLI, root], { encoding: 'utf8' });
    assert.equal(output, `${[HEADER, rootLine(root), 'work note: none', NEXT].join('\n')}\n`);
  });

  test('prints the work note and writes nothing while feedback is off', () => {
    const root = campaign();
    writeNote(root, 'note: Il porto di Morvalle.\n');
    const before = listFiles(root);
    const output = execFileSync(process.execPath, [CLI, root], { encoding: 'utf8', env: { ...process.env, YLLIR_FEEDBACK: '' } });
    assert.match(output, /^work note: Il porto di Morvalle\.$/m);
    assert.deepEqual(listFiles(root), before);
  });

  test('records one turn in the feedback log when feedback is on', () => {
    const root = campaign();
    const before = listFiles(root);
    execFileSync(process.execPath, [CLI, root], { encoding: 'utf8', env: { ...process.env, YLLIR_FEEDBACK: '1' } });
    const after = listFiles(root);
    // listFiles entries are "<relative path>:<content>", so the path is the part before the first colon.
    const added = after.filter((entry) => !before.includes(entry)).map((entry) => entry.slice(0, entry.indexOf(':')));
    assert.deepEqual(added, ['.campaign/state/feedback/events.jsonl']);
    assert.ok(before.every((entry) => after.includes(entry)));
  });

  test('does not create a feedback log outside a campaign', () => {
    const root = tempDir();
    execFileSync(process.execPath, [CLI, root], { encoding: 'utf8' });
    assert.deepEqual(listFiles(root), []);
  });
});
