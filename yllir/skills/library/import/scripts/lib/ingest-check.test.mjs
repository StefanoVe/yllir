import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkAcquisition } from './ingest-check.mjs';
import { sha256Buffer } from './ingest-inventory.mjs';

const CAMPAIGN = [
  'name: Test',
  'structure:',
  '  - id: fonti',
  '    folder: Fonti',
  '    type: sources',
  '  - id: trama',
  '    folder: Trama',
  '    type: plot',
  '',
].join('\n');

const ORIGINAL = 'photo bytes';
const SHA = sha256Buffer(Buffer.from(ORIGINAL));
const ID = `src-${SHA.slice(0, 8)}`;

const DEFAULT_TRANSCRIPTION = [
  `# Transcription ${ID}`,
  '',
  '[p1:l1] Teodo arrives at the gate.',
  '[p1:l2] The gate is closed.',
];
const DEFAULT_CLAIMS = ['- C001 | fact | verified | p1:l1 | Teodo arrives at the gate. | '];

/** Runs `fn` on a temporary campaign root; the folder is removed afterwards. */
function withCampaign(fn, campaignYaml = CAMPAIGN) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-ingest-check-'));
  try {
    fs.writeFileSync(path.join(root, 'campaign.yaml'), campaignYaml);
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

/**
 * Writes a valid acquisition folder, then applies the overrides.
 * card: frontmatter values (undefined removes a field); the other options replace
 * the default body lines.
 */
function acquisition(root, options = {}) {
  const {
    card = {},
    transcription = DEFAULT_TRANSCRIPTION,
    claims = DEFAULT_CLAIMS,
    questions = [],
    review = [],
    files = {},
  } = options;
  const dir = path.join(root, 'Fonti', ID);
  const fields = {
    id: ID,
    original: 'original.jpg',
    original_name: 'photo.jpg',
    sha256: SHA,
    acquired: '2026-11-09',
    provenance: '"Quaderno del master"',
    kind: 'other',
    pages: '1',
    status: 'transcribed',
    ...card,
  };
  const frontmatter = Object.entries(fields)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}: ${value}`);
  const body = [
    `# Acquisition ${ID}`,
    '',
    '## Claims',
    ...claims,
    '',
    '## Open questions',
    ...questions,
    '',
    '## Review',
    ...review,
    '',
  ];
  write(path.join(dir, 'card.md'), ['---', ...frontmatter, '---', '', ...body].join('\n'));
  write(path.join(dir, 'original.jpg'), ORIGINAL);
  write(path.join(dir, 'transcription.md'), `${transcription.join('\n')}\n`);
  for (const [rel, content] of Object.entries(files)) write(path.join(root, rel), content);
  return dir;
}

function check(root, final = false) {
  return checkAcquisition({ campaignRoot: root, id: ID, final });
}

test('normal case: a valid acquisition has no errors and no warnings', () => {
  withCampaign((root) => {
    acquisition(root, { files: { 'Trama/scena.md': '# Scena\n' } });
    const result = check(root);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.warnings, []);
    assert.deepEqual(result.claims, { total: 1, open: 0, verified: 1, conflict: 0, integrated: 0, excluded: 0 });
    assert.deepEqual(result.open_questions, []);
    assert.deepEqual(result.unreadable, []);
  });
});

test('normal case: an integrated claim with an existing target is accepted', () => {
  withCampaign((root) => {
    acquisition(root, {
      claims: ['- C001 | fact | integrated | p1:l1 | Teodo arrives at the gate. | Trama/scena.md'],
      files: { 'Trama/scena.md': '# Scena\n' },
    });
    const result = check(root);
    assert.deepEqual(result.errors, []);
    assert.equal(result.claims.integrated, 1);
  });
});

test('missing field: sha256 is absent from the card', () => {
  withCampaign((root) => {
    acquisition(root, { card: { sha256: undefined } });
    assert.ok(check(root).errors.includes('missing field sha256'));
  });
});

test('unknown field in the card is an error', () => {
  withCampaign((root) => {
    acquisition(root, { card: { colour: 'red' } });
    assert.ok(check(root).errors.includes('unknown field colour'));
  });
});

test('bad id: the card id is not src-XXXXXXXX', () => {
  withCampaign((root) => {
    acquisition(root, { card: { id: 'src-XYZ' } });
    const errors = check(root).errors;
    assert.ok(errors.includes('bad id: src-XYZ'));
    assert.ok(!errors.some((error) => error.startsWith('id ')));
  });
});

test('id mismatch: a valid card id that is not the folder name', () => {
  withCampaign((root) => {
    acquisition(root, { card: { id: 'src-00000000' } });
    assert.ok(check(root).errors.includes(`id src-00000000 does not match folder ${ID}`));
  });
});

test('wrong sha256: the recorded hash is not the one of the original', () => {
  withCampaign((root) => {
    acquisition(root, { card: { sha256: '0'.repeat(64) } });
    assert.ok(check(root).errors.includes('sha256 does not match original'));
  });
});

test('line without locator in the transcription', () => {
  withCampaign((root) => {
    acquisition(root, {
      transcription: [`# Transcription ${ID}`, '', '[p1:l1] Teodo arrives at the gate.', 'Lone line'],
    });
    assert.ok(check(root).errors.includes('line 4 has no locator'));
  });
});

test('doubt without question: an illegible or uncertain marker needs a question at its locator', () => {
  withCampaign((root) => {
    acquisition(root, {
      transcription: [
        `# Transcription ${ID}`,
        '',
        '[p1:l1] Teodo arrives at the gate.',
        '[p1:l2] [?: Oria] walks in.',
      ],
    });
    assert.ok(check(root).errors.includes('doubt at p1:l2 has no question'));
  });
});

test('doubt with a question at the same locator is accepted, and listed as unreadable', () => {
  withCampaign((root) => {
    acquisition(root, {
      transcription: [
        `# Transcription ${ID}`,
        '',
        '[p1:l1] Teodo arrives at the gate.',
        '[p1:l2] [illegible] is closed.',
      ],
      questions: ['- Q001 | open | p1:l2 | What word is written? | '],
    });
    const result = check(root);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.unreadable, ['p1:l2']);
    assert.deepEqual(result.open_questions, [{ id: 'Q001', locator: 'p1:l2', question: 'What word is written?' }]);
  });
});

test('claim format: a claim line with the wrong number of fields', () => {
  withCampaign((root) => {
    acquisition(root, { claims: ['- C001 | fact | verified | p1:l1 | Teodo arrives at the gate.'] });
    assert.ok(check(root).errors.some((error) => error.startsWith('claim format')));
  });
});

test('claim format: a claim class that does not exist', () => {
  withCampaign((root) => {
    acquisition(root, { claims: ['- C001 | rumour | verified | p1:l1 | Teodo arrives at the gate. | '] });
    assert.ok(check(root).errors.some((error) => error.startsWith('claim format') && error.includes('bad class')));
  });
});

test('integrated without target', () => {
  withCampaign((root) => {
    acquisition(root, { claims: ['- C001 | fact | integrated | p1:l1 | Teodo arrives at the gate. | '] });
    assert.ok(check(root).errors.includes('integrated without target: C001'));
  });
});

test('integrated target missing: the target file does not exist', () => {
  withCampaign((root) => {
    acquisition(root, { claims: ['- C001 | fact | integrated | p1:l1 | Teodo arrives at the gate. | Trama/missing.md'] });
    assert.ok(check(root).errors.includes('integrated target missing: C001 Trama/missing.md'));
  });
});

test('a target on a claim that is not integrated is an error', () => {
  withCampaign((root) => {
    acquisition(root, {
      claims: ['- C001 | fact | verified | p1:l1 | Teodo arrives at the gate. | Trama/scena.md'],
      files: { 'Trama/scena.md': '# Scena\n' },
    });
    assert.ok(check(root).errors.includes('target on a non-integrated claim: C001'));
  });
});

test('duplicate claim id and unknown locator', () => {
  withCampaign((root) => {
    acquisition(root, {
      claims: [
        '- C001 | fact | verified | p1:l1 | Teodo arrives at the gate. | ',
        '- C001 | fact | verified | p9:l9 | Teodo arrives. | ',
      ],
    });
    const errors = check(root).errors;
    assert.ok(errors.includes('duplicate claim id C001'));
    assert.ok(errors.includes('unknown locator p9:l9 in C001'));
  });
});

test('answered question without review: no R line refers to it', () => {
  withCampaign((root) => {
    acquisition(root, { questions: ['- Q001 | answered | p1:l2 | Who holds the gate? | The porter'] });
    assert.ok(check(root).errors.includes('question Q001 answered without review'));
  });
});

test('answered question with a review line is accepted', () => {
  withCampaign((root) => {
    acquisition(root, {
      questions: ['- Q001 | answered | p1:l2 | Who holds the gate? | The porter'],
      review: ['- R001 | Q001 | p1:l2 | confirmed'],
    });
    assert.deepEqual(check(root).errors, []);
  });
});

test('R refers to a missing id', () => {
  withCampaign((root) => {
    acquisition(root, { review: ['- R001 | C009 | p1:l1 | confirmed'] });
    assert.ok(check(root).errors.includes('review refers to missing id C009 (R001)'));
  });
});

test('--final: an open claim is an error, without --final it is not', () => {
  withCampaign((root) => {
    acquisition(root, { claims: ['- C001 | fact | open | p1:l1 | Teodo arrives at the gate. | '] });
    assert.deepEqual(check(root).errors, []);
    assert.ok(check(root, true).errors.includes('open claim C001 (--final)'));
  });
});

test('--final: an open question is an error, without --final it is listed only', () => {
  withCampaign((root) => {
    acquisition(root, { questions: ['- Q001 | open | p1:l2 | Who holds the gate? | '] });
    const relaxed = check(root);
    assert.deepEqual(relaxed.errors, []);
    assert.equal(relaxed.open_questions.length, 1);
    assert.ok(check(root, true).errors.includes('open question Q001 (--final)'));
  });
});

test('uncovered: a number and a capitalized word that no claim contains are warned', () => {
  withCampaign((root) => {
    acquisition(root, {
      transcription: [`# Transcription ${ID}`, '', '[p1:l1] Teodo meets Marta at 3 gates.'],
      claims: ['- C001 | fact | verified | p1:l1 | Teodo meets someone. | '],
    });
    const result = check(root);
    assert.deepEqual(result.errors, []);
    assert.ok(result.warnings.includes('uncovered: p1:l1 Marta'));
    assert.ok(result.warnings.includes('uncovered: p1:l1 3'));
    assert.ok(!result.warnings.some((warning) => warning.includes('Teodo')));
  });
});

test('uncovered: a claim that contains the number and the name clears the warning', () => {
  withCampaign((root) => {
    acquisition(root, {
      transcription: [`# Transcription ${ID}`, '', '[p1:l1] Teodo meets Marta at 3 gates.'],
      claims: ['- C001 | fact | verified | p1:l1 | Teodo meets Marta at 3 gates. | '],
    });
    assert.deepEqual(check(root).warnings, []);
  });
});

test('pages of the card differing from the transcription is a warning', () => {
  withCampaign((root) => {
    acquisition(root, { card: { pages: '3' } });
    assert.ok(check(root).warnings.includes('pages is 3 but the transcription has 1 pages'));
  });
});

test('field values: bad kind, bad status and bad date are errors', () => {
  withCampaign((root) => {
    acquisition(root, { card: { kind: 'map', status: 'done', acquired: '2026-02-30' } });
    const errors = check(root).errors;
    assert.ok(errors.includes('bad kind: map'));
    assert.ok(errors.includes('bad status: done'));
    assert.ok(errors.includes('bad date acquired: 2026-02-30'));
  });
});

test('no category of type sources is an error', () => {
  const noSources = 'name: Test\nstructure:\n  - id: trama\n    folder: Trama\n    type: plot\n';
  withCampaign((root) => {
    acquisition(root);
    assert.deepEqual(check(root).errors, ['no category of type sources']);
  }, noSources);
});

test('a missing acquisition folder throws', () => {
  withCampaign((root) => {
    assert.throws(() => check(root), /no acquisition folder for src-/);
  });
});

test('a malformed id throws', () => {
  withCampaign((root) => {
    assert.throws(() => checkAcquisition({ campaignRoot: root, id: 'src-ZZ', final: false }), /bad id: src-ZZ/);
  });
});
