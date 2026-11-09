import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findSubject } from './find-subject.mjs';

const CAMPAIGN = [
  'name: Test',
  'language:',
  '  main: it',
  'structure:',
  '  - id: personaggi',
  '    folder: Personaggi',
  '    type: subjects',
  '',
].join('\n');

function sheet(id, title, aliases = null) {
  const fm = [`id: ${id}`, 'template: npc', 'location: []'];
  if (aliases !== null) fm.push(`aliases: [${aliases.map((a) => `"${a}"`).join(', ')}]`);
  return `---\n${fm.join('\n')}\n---\n\n# ${title}\n\n## Ruolo\n\nTesto.\n`;
}

/** Writes a temporary campaign, runs `fn` on it and removes it afterwards. */
function withCampaign(files, fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-'));
  try {
    const all = { 'campaign.yaml': CAMPAIGN, ...files };
    for (const [rel, content] of Object.entries(all)) {
      const full = path.join(root, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content);
    }
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('exact match on a title', () => {
  withCampaign(
    { 'Personaggi/Oria Valdes.md': sheet('oria-valdes', 'Oria Valdes') },
    (root) => {
      assert.deepEqual(findSubject(root, 'Oria Valdes').matches, [
        {
          id: 'oria-valdes',
          sheet: 'Personaggi/Oria Valdes.md',
          form: 'Oria Valdes',
          kind: 'title',
          match: 'exact',
        },
      ]);
    },
  );
});

test('exact match on an alias', () => {
  withCampaign(
    { 'Personaggi/Oria Valdes.md': sheet('oria-valdes', 'Oria Valdes', ['La Fabbra']) },
    (root) => {
      const { matches } = findSubject(root, 'la fabbra');
      assert.equal(matches.length, 1);
      assert.equal(matches[0].id, 'oria-valdes');
      assert.equal(matches[0].kind, 'alias');
      assert.equal(matches[0].form, 'La Fabbra');
      assert.equal(matches[0].match, 'exact');
    },
  );
});

test('partial match: a word of the title against two subjects', () => {
  withCampaign(
    {
      'Personaggi/Oria Valdes.md': sheet('oria-valdes', 'Oria Valdes'),
      'Personaggi/Oria Brunel.md': sheet('oria-brunel', 'Oria Brunel'),
    },
    (root) => {
      const { matches } = findSubject(root, 'Oria');
      assert.deepEqual(
        matches.map((m) => [m.id, m.match]),
        [
          ['oria-brunel', 'partial'],
          ['oria-valdes', 'partial'],
        ],
      );
    },
  );
});

test('no match gives an empty list', () => {
  withCampaign(
    { 'Personaggi/Oria Valdes.md': sheet('oria-valdes', 'Oria Valdes') },
    (root) => {
      assert.deepEqual(findSubject(root, 'Teodo Marr').matches, []);
      assert.deepEqual(findSubject(root, '   ').matches, []);
      assert.deepEqual(findSubject(root, '').matches, []);
    },
  );
});

test('accents, case and extra spaces are ignored', () => {
  withCampaign(
    { 'Personaggi/Àlvar Ferro.md': sheet('alvar-ferro', 'Àlvar Ferro') },
    (root) => {
      const { matches } = findSubject(root, '  ALVAR   ferro ');
      assert.equal(matches.length, 1);
      assert.equal(matches[0].id, 'alvar-ferro');
      assert.equal(matches[0].match, 'exact');
    },
  );
});

test('one entry per subject, keeping the exact title over a partial alias', () => {
  withCampaign(
    { 'Personaggi/Oria Valdes.md': sheet('oria-valdes', 'Oria Valdes', ['Oria']) },
    (root) => {
      const { matches } = findSubject(root, 'Oria');
      assert.equal(matches.length, 1);
      assert.equal(matches[0].match, 'exact');
      assert.equal(matches[0].kind, 'alias');
    },
  );
});
