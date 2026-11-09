import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildReport, statusValue } from './ingest-report.mjs';
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

const DEFAULT_TRANSCRIPTION = [`# Transcription ${ID}`, '', '[p1:l1] Teodo arrives at the gate.'];
const DEFAULT_CLAIMS = ['- C001 | fact | verified | p1:l1 | Teodo arrives at the gate. | '];

function withCampaign(fn, campaignYaml = CAMPAIGN) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-ingest-report-'));
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

/** Writes an acquisition folder with the given id, card, body lines and original. */
function acquisition(root, { id = ID, sha = SHA, transcription = DEFAULT_TRANSCRIPTION, claims = DEFAULT_CLAIMS, questions = [], review = [], files = {} } = {}) {
  const dir = path.join(root, 'Fonti', id);
  write(
    path.join(dir, 'card.md'),
    [
      '---',
      `id: ${id}`,
      'original: original.jpg',
      'original_name: photo.jpg',
      `sha256: ${sha}`,
      'acquired: 2026-11-09',
      'provenance: "Quaderno del master"',
      'kind: other',
      'pages: 1',
      'status: transcribed',
      '---',
      '',
      `# Acquisition ${id}`,
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
    ].join('\n'),
  );
  write(path.join(dir, 'original.jpg'), ORIGINAL);
  write(path.join(dir, 'transcription.md'), `${transcription.join('\n')}\n`);
  for (const [rel, content] of Object.entries(files)) write(path.join(root, rel), content);
}

function report(root, over = {}) {
  return buildReport({ campaignRoot: root, ids: [ID], duplicates: 0, ...over });
}

test('DONE: every claim verified, no open question, write not run and nothing integrated', () => {
  withCampaign((root) => {
    acquisition(root);
    const result = report(root, { duplicates: 2 });
    assert.equal(result.status, 'DONE');
    assert.equal(
      result.text,
      [
        'INGEST REPORT',
        'status: DONE',
        `sources: 1 (${ID})`,
        'duplicates skipped: 2',
        'claims: 1 (integrated 0, verified 1, conflict 0, open 0, excluded 0)',
        'unreadable parts: 0 (none)',
        'check: 0 errors',
        'write: not run',
        'audit: not run',
        'open questions for the master:',
        '- none',
        'continue with: the step of the invoking skill that called document-ingest',
        '',
      ].join('\n'),
    );
  });
});

test('DONE: integrated claims with a write report of status DONE', () => {
  withCampaign((root) => {
    acquisition(root, {
      claims: ['- C001 | fact | integrated | p1:l1 | Teodo arrives at the gate. | Trama/scena.md'],
      files: { 'Trama/scena.md': '# Scena\n' },
    });
    const result = report(root, { writeText: 'INGEST WRITE\nstatus: DONE\n', auditText: 'status: DONE\n' });
    assert.equal(result.status, 'DONE');
    assert.match(result.text, /^write: DONE$/m);
    assert.match(result.text, /^audit: DONE$/m);
    assert.match(result.text, /^claims: 1 \(integrated 1, /m);
  });
});

test('NEEDS_ATTENTION: integrated claims but the write was not run', () => {
  withCampaign((root) => {
    acquisition(root, {
      claims: ['- C001 | fact | integrated | p1:l1 | Teodo arrives at the gate. | Trama/scena.md'],
      files: { 'Trama/scena.md': '# Scena\n' },
    });
    assert.equal(report(root).status, 'NEEDS_ATTENTION');
  });
});

test('NEEDS_ATTENTION: the write report is not DONE', () => {
  withCampaign((root) => {
    acquisition(root, {
      claims: ['- C001 | fact | integrated | p1:l1 | Teodo arrives at the gate. | Trama/scena.md'],
      files: { 'Trama/scena.md': '# Scena\n' },
    });
    const result = report(root, { writeText: 'status: NEEDS_ATTENTION\n' });
    assert.equal(result.status, 'NEEDS_ATTENTION');
    assert.match(result.text, /^write: NEEDS_ATTENTION$/m);
  });
});

test('NEEDS_ATTENTION: an open claim', () => {
  withCampaign((root) => {
    acquisition(root, { claims: ['- C001 | fact | open | p1:l1 | Teodo arrives at the gate. | '] });
    const result = report(root);
    assert.equal(result.status, 'NEEDS_ATTENTION');
    assert.match(result.text, /^claims: 1 \(integrated 0, verified 0, conflict 0, open 1, excluded 0\)$/m);
  });
});

test('NEEDS_ATTENTION: an open question is listed for the master', () => {
  withCampaign((root) => {
    acquisition(root, {
      transcription: [`# Transcription ${ID}`, '', '[p1:l1] Teodo arrives at the gate.', '[p1:l2] [?: Oria] walks in.'],
      claims: DEFAULT_CLAIMS,
      questions: ['- Q001 | open | p1:l2 | Is this Oria? | '],
    });
    const result = report(root);
    assert.equal(result.status, 'NEEDS_ATTENTION');
    assert.match(result.text, new RegExp(`^- ${ID} Q001 p1:l2 Is this Oria\\?$`, 'm'));
    assert.doesNotMatch(result.text, /^- none$/m);
  });
});

test('NEEDS_ATTENTION: a conflict is listed for the master', () => {
  withCampaign((root) => {
    acquisition(root, { claims: ['- C001 | secret | conflict | p1:l1 | Teodo is the thief. | '] });
    const result = report(root);
    assert.equal(result.status, 'NEEDS_ATTENTION');
    assert.match(result.text, new RegExp(`^- ${ID} C001 p1:l1 conflict: Teodo is the thief\\.$`, 'm'));
  });
});

test('unreadable parts are listed with their id and locator', () => {
  withCampaign((root) => {
    acquisition(root, {
      transcription: [`# Transcription ${ID}`, '', '[p1:l1] [illegible] arrives.'],
      claims: DEFAULT_CLAIMS,
      questions: ['- Q001 | open | p1:l1 | What word? | '],
    });
    const result = report(root);
    assert.match(result.text, new RegExp(`^unreadable parts: 1 \\(${ID} p1:l1\\)$`, 'm'));
  });
});

test('FAILED: a check has errors', () => {
  withCampaign((root) => {
    acquisition(root, { sha: '0'.repeat(64) });
    const result = report(root);
    assert.equal(result.status, 'FAILED');
    assert.match(result.text, /^check: 1 errors$/m);
  });
});

test('FAILED: a status reason is given, and it is written after the status line', () => {
  withCampaign((root) => {
    acquisition(root);
    const result = report(root, { statusReason: 'the master stopped the run' });
    assert.equal(result.status, 'FAILED');
    assert.equal(
      result.text.split('\n').slice(0, 3).join('\n'),
      ['INGEST REPORT', 'status: FAILED', 'reason: the master stopped the run'].join('\n'),
    );
  });
});

test('FAILED: an id with no acquisition folder is recorded as an error', () => {
  withCampaign((root) => {
    acquisition(root);
    const result = report(root, { ids: ['src-00000000'] });
    assert.equal(result.status, 'FAILED');
    assert.match(result.text, /^sources: 1 \(src-00000000\)$/m);
    assert.match(result.text, /^check: 1 errors$/m);
  });
});

test('no ids: sources none, and a custom continue-with text', () => {
  withCampaign((root) => {
    const result = report(root, { ids: [], continueWith: 'the linker step' });
    assert.match(result.text, /^sources: 0 \(none\)$/m);
    assert.match(result.text, /^continue with: the linker step$/m);
    assert.equal(result.status, 'DONE');
  });
});

test('statusValue reads the status line, or unknown when there is none', () => {
  assert.equal(statusValue('x\nstatus: DONE\n'), 'DONE');
  assert.equal(statusValue('no status here'), 'unknown');
});

const LINKS = JSON.stringify({
  links: [
    { input: '/campaign/inbox/scena.md', path: 'Trama/scena.md', external: false },
    { input: '/archivio/cronaca.md', path: 'Trama/cronaca.md', external: true },
  ],
  refused: [{ input: '/archivio/bozza.md', reason: 'no valid front matter' }],
});

test('without links, the report has no link lines', () => {
  withCampaign((root) => {
    acquisition(root);
    const result = report(root, { linksText: null });
    assert.doesNotMatch(result.text, /linked:/);
    assert.doesNotMatch(result.text, /link warnings:/);
    assert.equal(result.text, report(root).text);
  });
});

test('links: the linked line follows duplicates, and external links get a warning before continue with', () => {
  withCampaign((root) => {
    acquisition(root);
    const result = report(root, { duplicates: 1, linksText: LINKS });
    assert.equal(result.status, 'DONE');
    assert.equal(
      result.text,
      [
        'INGEST REPORT',
        'status: DONE',
        `sources: 1 (${ID})`,
        'duplicates skipped: 1',
        'linked: 2 (external 1)',
        'claims: 1 (integrated 0, verified 1, conflict 0, open 0, excluded 0)',
        'unreadable parts: 0 (none)',
        'check: 0 errors',
        'write: not run',
        'audit: not run',
        'open questions for the master:',
        '- none',
        'link warnings:',
        '- warning: no git backup for external link Trama/cronaca.md',
        'continue with: the step of the invoking skill that called document-ingest',
        '',
      ].join('\n'),
    );
  });
});

test('links without external ones: linked line only, no warnings', () => {
  withCampaign((root) => {
    acquisition(root);
    const links = JSON.stringify({ links: [{ input: 'x.md', path: 'Trama/x.md', external: false }], refused: [] });
    const result = report(root, { linksText: links });
    assert.match(result.text, /^linked: 1 \(external 0\)$/m);
    assert.doesNotMatch(result.text, /link warnings:/);
  });
});

test('links with no link at all: linked 0 (external 0), no warnings', () => {
  withCampaign((root) => {
    acquisition(root);
    const result = report(root, { linksText: JSON.stringify({ links: [], refused: [] }) });
    assert.match(result.text, /^linked: 0 \(external 0\)$/m);
    assert.doesNotMatch(result.text, /link warnings:/);
  });
});

test('links that are not valid links text are an error', () => {
  withCampaign((root) => {
    acquisition(root);
    assert.throws(() => report(root, { linksText: 'not json' }), /not valid JSON/);
    assert.throws(() => report(root, { linksText: '{"refused":[]}' }), /no links list/);
    assert.throws(() => report(root, { linksText: '{"links":[{"external":true}]}' }), /without a path/);
  });
});
