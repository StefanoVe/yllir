import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { turnCheck } from './turn-check.mjs';
import { closeTopic, newTopic } from './topics.mjs';

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

/**
 * Campaign folder with campaign.yaml. The turn check only needs its presence for the
 * topics; the linker needs the structure to plan the links.
 */
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
  test('a folder without campaign.yaml has no active topic', () => {
    const root = tempDir();
    assert.equal(
      turnCheck(root),
      [HEADER, rootLine(root), 'active topic: none', NEXT].join('\n'),
    );
  });

  test('a nonexistent root does not throw', () => {
    const root = path.join(tempDir(), 'missing');
    assert.equal(
      turnCheck(root),
      [HEADER, rootLine(root), 'active topic: none', NEXT].join('\n'),
    );
  });

  test('a campaign with no topics has no active topic', () => {
    const root = campaign();
    assert.equal(
      turnCheck(root),
      [HEADER, rootLine(root), 'active topic: none', 'unlinked mentions: none', NEXT].join('\n'),
    );
  });

  test('an active topic shows its next step, its pending question and the other open topics', () => {
    const root = campaign();
    const first = newTopic(root, { process: 'ricerca', goal: 'Il mercato delle ceneri', now: new Date('2026-11-01T10:00:00Z') });
    const closed = newTopic(root, { process: 'ricerca', goal: 'Le vecchie mappe', now: new Date('2026-11-02T10:00:00Z') });
    const active = newTopic(root, { process: 'scena', goal: 'Il porto di Morvalle', now: new Date('2026-11-03T10:00:00Z') });
    closeTopic(root, { id: closed.id, now: new Date('2026-11-02T12:00:00Z') });
    const activeFile = path.join(root, '.campaign/state/topics', `${active.id}.md`);
    setSection(activeFile, 'Next step', 'Scrivere la scena del porto.\nPoi rileggere il tono.');
    setSection(activeFile, 'Questions for the master', 'Il molo è di legno o di pietra?\nSecondo quesito.');

    assert.equal(
      turnCheck(root),
      [
        HEADER,
        rootLine(root),
        `active topic: ${active.id} — Il porto di Morvalle — next step: Scrivere la scena del porto.`,
        'pending questions: Il molo è di legno o di pietra?',
        `other open topics: ${first.id} — Il mercato delle ceneri`,
        'unlinked mentions: none',
        NEXT,
      ].join('\n'),
    );
  });

  test('empty sections read as none', () => {
    const root = campaign();
    newTopic(root, { process: 'scena', goal: 'Il porto di Morvalle', now: new Date('2026-11-03T10:00:00Z') });
    assert.equal(
      turnCheck(root),
      [
        HEADER,
        rootLine(root),
        expectedActive(root, 'Il porto di Morvalle', 'none'),
        'pending questions: none',
        'unlinked mentions: none',
        NEXT,
      ].join('\n'),
    );
  });

  test('other open topics are capped at five, most recent first', () => {
    const root = campaign();
    const made = [];
    for (let day = 1; day <= 7; day++) {
      const id = newTopic(root, {
        process: 'ricerca',
        goal: `Argomento ${day}`,
        now: new Date(`2026-11-0${day}T10:00:00Z`),
      });
      made.push(id);
    }
    // Day 7 is the active topic; days 6 to 2 are paused; day 1 is the sixth other one.
    const text = turnCheck(root);
    const others = text.split('\n').find((line) => line.startsWith('other open topics: '));
    const shown = others.slice('other open topics: '.length).split('; ');
    assert.equal(shown.length, 5);
    assert.deepEqual(
      shown,
      [6, 5, 4, 3, 2].map((day) => `${made[day - 1].id} — Argomento ${day}`),
    );
    assert.ok(!text.includes(made[0].id));
  });

  test('a broken handoff gives the header and the next line only', () => {
    const root = campaign();
    newTopic(root, { process: 'scena', goal: 'Il porto di Morvalle', now: new Date('2026-11-03T10:00:00Z') });
    fs.writeFileSync(path.join(root, '.campaign/state/topics', 'rotto.md'), 'niente frontmatter\n');
    assert.equal(turnCheck(root), [HEADER, rootLine(root), NEXT].join('\n'));
  });
});

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
      [HEADER, rootLine(root), 'active topic: none', 'unlinked mentions: 1 files: Trama/A.md', NEXT].join('\n'),
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
    assert.equal(output, `${[HEADER, rootLine(root), 'active topic: none', NEXT].join('\n')}\n`);
  });

  test('prints the active topic of a campaign and writes only the feedback log', () => {
    const root = campaign();
    newTopic(root, { process: 'scena', goal: 'Il porto di Morvalle', now: new Date('2026-11-03T10:00:00Z') });
    const before = listFiles(root);
    const output = execFileSync(process.execPath, [CLI, root], { encoding: 'utf8' });
    assert.match(output, /^active topic: \S+ — Il porto di Morvalle — next step: none$/m);
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

/** The expected active-topic line for the only topic of a campaign. */
function expectedActive(root, goal, nextStep) {
  const dir = path.join(root, '.campaign/state/topics');
  const id = fs.readdirSync(dir).find((name) => name.endsWith('.md') && name !== 'index.md').slice(0, -3);
  return `active topic: ${id} — ${goal} — next step: ${nextStep}`;
}
