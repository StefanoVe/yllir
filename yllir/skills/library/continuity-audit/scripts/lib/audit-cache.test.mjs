import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fillFromCache, storeToCache } from './audit-cache.mjs';
import { validateFacts } from './audit-facts.mjs';
import { loadVocabulary } from './audit-vocabulary.mjs';

const CLI = fileURLToPath(new URL('../audit-cache.mjs', import.meta.url));
const DEFAULT_VOCAB = fileURLToPath(new URL('../../audit-vocabulary.yaml', import.meta.url));

const CAMPAIGN = [
  'name: Test',
  'structure:',
  '  - id: people',
  '    folder: People',
  '    type: subjects',
  '  - id: places',
  '    folder: Places',
  '    type: places',
  '  - id: plot',
  '    folder: Plot',
  '    type: plot',
  '  - id: notes',
  '    folder: Notes',
  '    type: notes',
  '',
].join('\n');

const ORIA = '---\nid: oria-valdes\nlocation: [morvalle]\n---\n\n# Oria Valdes\n\nUna guida.\n';
const BASE_FILES = {
  'campaign.yaml': CAMPAIGN,
  'People/Oria Valdes.md': ORIA,
  'Places/Morvalle.md': '---\nid: morvalle\n---\n\n# Morvalle\n\nUn borgo.\n',
  'Plot/Trama.md': '# Trama\n\n## Atto primo\n\nOria Valdes trova la lanterna nel pozzo.\n',
  'Plot/Pozzo.md': '# Pozzo\n\n## Voce\n\nLa voce dell’Ascia parla piano.\n',
};

const TRAMA = 'Plot/Trama.md';
const POZZO = 'Plot/Pozzo.md';

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function vocabSha() {
  return sha256(fs.readFileSync(DEFAULT_VOCAB)).slice(0, 16);
}

/** Writes the files of a temporary campaign and returns its root. */
function makeCampaign(files = BASE_FILES) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-cache-root-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return root;
}

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** Writes a cache entry for the current bytes of a document, as storeToCache does. */
function writeEntry(cacheDir, docBytes, facts, vocab = vocabSha()) {
  fs.mkdirSync(cacheDir, { recursive: true });
  const docSha = sha256(docBytes);
  const entry = { doc_sha256: docSha, vocab_sha16: vocab, facts };
  fs.writeFileSync(path.join(cacheDir, `${docSha}-${vocab}.json`), `${JSON.stringify(entry, null, 2)}\n`);
}

const FACT = {
  subject: 'oria-valdes',
  attribute: 'status.alive',
  value: 'yes',
  source_type: 'source-claim',
  quote: 'Oria Valdes trova la lanterna',
  line: 5,
};

function withDirs(fn) {
  const root = makeCampaign();
  const cacheDir = tempDir('yllir-cache-c-');
  const factsDir = tempDir('yllir-cache-f-');
  try {
    fn({ root, cacheDir, factsDir });
  } finally {
    for (const dir of [root, cacheDir, factsDir]) fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('fill: a cached document is a hit and its facts file is written with read true', () => {
  withDirs(({ root, cacheDir, factsDir }) => {
    writeEntry(cacheDir, fs.readFileSync(path.join(root, TRAMA)), [FACT]);
    const result = fillFromCache(root, {
      scope: { files: [{ fid: 'D001', document: TRAMA }] },
      factsDir,
      cacheDir,
    });
    assert.deepEqual(result, { hits: ['D001'], misses: [], present: [] });
    const written = JSON.parse(fs.readFileSync(path.join(factsDir, 'D001.json'), 'utf8'));
    assert.deepEqual(written, { fid: 'D001', document: TRAMA, read: true, facts: [FACT] });
  });
});

test('fill: a document with no cache entry is a miss and nothing is written', () => {
  withDirs(({ root, cacheDir, factsDir }) => {
    const result = fillFromCache(root, {
      scope: { files: [{ fid: 'D001', document: TRAMA }] },
      factsDir,
      cacheDir,
    });
    assert.deepEqual(result, { hits: [], misses: ['D001'], present: [] });
    assert.equal(fs.existsSync(path.join(factsDir, 'D001.json')), false);
  });
});

test('fill: one changed byte of the document is a miss', () => {
  withDirs(({ root, cacheDir, factsDir }) => {
    writeEntry(cacheDir, fs.readFileSync(path.join(root, TRAMA)), [FACT]);
    const full = path.join(root, TRAMA);
    fs.writeFileSync(full, fs.readFileSync(full, 'utf8').replace('lanterna', 'lanternb'));
    const result = fillFromCache(root, {
      scope: { files: [{ fid: 'D001', document: TRAMA }] },
      factsDir,
      cacheDir,
    });
    assert.deepEqual(result.misses, ['D001']);
  });
});

test('fill: a different vocabulary is a miss', () => {
  withDirs(({ root, cacheDir, factsDir }) => {
    const oldVocab = '0000000000000000';
    writeEntry(cacheDir, fs.readFileSync(path.join(root, TRAMA)), [FACT], oldVocab);
    const result = fillFromCache(root, {
      scope: { files: [{ fid: 'D001', document: TRAMA }] },
      factsDir,
      cacheDir,
    });
    assert.deepEqual(result.misses, ['D001']);

    const altVocab = path.join(factsDir, 'alt-vocab.yaml');
    fs.writeFileSync(altVocab, `${fs.readFileSync(DEFAULT_VOCAB, 'utf8')}\n# changed\n`);
    writeEntry(cacheDir, fs.readFileSync(path.join(root, TRAMA)), [FACT]);
    const withAlt = fillFromCache(root, {
      scope: { files: [{ fid: 'D001', document: TRAMA }] },
      factsDir,
      cacheDir,
      vocabPath: altVocab,
    });
    assert.deepEqual(withAlt.misses, ['D001']);
  });
});

test('fill: an existing facts file is left untouched and counted as present', () => {
  withDirs(({ root, cacheDir, factsDir }) => {
    writeEntry(cacheDir, fs.readFileSync(path.join(root, TRAMA)), [FACT]);
    const existing = '{"fid":"D001","document":"Plot/Trama.md","read":false,"facts":[]}\n';
    fs.writeFileSync(path.join(factsDir, 'D001.json'), existing);
    const result = fillFromCache(root, {
      scope: { files: [{ fid: 'D001', document: TRAMA }] },
      factsDir,
      cacheDir,
    });
    assert.deepEqual(result, { hits: [], misses: [], present: ['D001'] });
    assert.equal(fs.readFileSync(path.join(factsDir, 'D001.json'), 'utf8'), existing);
  });
});

test('fill: a missing document is a miss', () => {
  withDirs(({ root, cacheDir, factsDir }) => {
    const result = fillFromCache(root, {
      scope: { files: [{ fid: 'D009', document: 'Plot/Assente.md' }] },
      factsDir,
      cacheDir,
    });
    assert.deepEqual(result, { hits: [], misses: ['D009'], present: [] });
    assert.equal(fs.existsSync(path.join(factsDir, 'D009.json')), false);
  });
});

test('store: extracted and read documents are stored, the empty read one as an empty list', () => {
  withDirs(({ root, cacheDir }) => {
    const factsJson = {
      coverage: [
        { fid: 'D001', document: TRAMA, status: 'extracted' },
        { fid: 'D002', document: POZZO, status: 'read' },
      ],
      facts: [{ ...FACT, id: 'F-D001-001', document: TRAMA, line: 5, from_metadata: false }],
      discarded: [],
      ignored_frontmatter: [],
    };
    const result = storeToCache(root, { factsJson, cacheDir });
    assert.deepEqual(result, { stored: [TRAMA, POZZO], skipped: [] });

    const trama = JSON.parse(
      fs.readFileSync(path.join(cacheDir, `${sha256(fs.readFileSync(path.join(root, TRAMA)))}-${vocabSha()}.json`), 'utf8'),
    );
    assert.deepEqual(Object.keys(trama), ['doc_sha256', 'vocab_sha16', 'facts']);
    assert.equal(trama.vocab_sha16, vocabSha());
    assert.deepEqual(trama.facts, [FACT]);

    const pozzo = JSON.parse(
      fs.readFileSync(path.join(cacheDir, `${sha256(fs.readFileSync(path.join(root, POZZO)))}-${vocabSha()}.json`), 'utf8'),
    );
    assert.deepEqual(pozzo.facts, []);
  });
});

test('store: a document with discards is skipped, and a to-read document with reason not-read', () => {
  withDirs(({ root, cacheDir }) => {
    const factsJson = {
      coverage: [
        { fid: 'D001', document: TRAMA, status: 'extracted' },
        { fid: 'D002', document: POZZO, status: 'to-read' },
      ],
      facts: [{ ...FACT, id: 'F-D001-001', document: TRAMA, line: 5, from_metadata: false }],
      discarded: [{ fid: 'D001', index: 1, reason: 'quote not found', fact: {} }],
      ignored_frontmatter: [],
    };
    const result = storeToCache(root, { factsJson, cacheDir });
    assert.deepEqual(result, {
      stored: [],
      skipped: [
        { document: TRAMA, reason: 'has-discards' },
        { document: POZZO, reason: 'not-read' },
      ],
    });
    assert.deepEqual(fs.readdirSync(cacheDir), []);
  });
});

test('store: metadata facts are not stored', () => {
  withDirs(({ root, cacheDir }) => {
    const factsJson = {
      coverage: [{ fid: 'D003', document: 'People/Oria Valdes.md', status: 'extracted' }],
      facts: [
        {
          id: 'M-D003',
          subject: 'oria-valdes',
          attribute: 'location.current',
          value: 'morvalle',
          source_type: 'editorial-summary',
          quote: 'location: [morvalle]',
          document: 'People/Oria Valdes.md',
          line: 3,
          from_metadata: true,
        },
        { ...FACT, id: 'F-D003-001', document: 'People/Oria Valdes.md', line: 7, from_metadata: false },
      ],
      discarded: [],
      ignored_frontmatter: [],
    };
    storeToCache(root, { factsJson, cacheDir });
    const entry = JSON.parse(
      fs.readFileSync(
        path.join(cacheDir, `${sha256(fs.readFileSync(path.join(root, 'People/Oria Valdes.md')))}-${vocabSha()}.json`),
        'utf8',
      ),
    );
    assert.deepEqual(entry.facts, [{ ...FACT, line: 7 }]);
  });
});

test('round trip: store then fill gives facts that validateFacts accepts unchanged', () => {
  withDirs(({ root, cacheDir, factsDir }) => {
    const vocab = loadVocabulary();
    const scope = {
      mode: 'pre',
      files: [
        { fid: 'D001', document: TRAMA },
        { fid: 'D002', document: 'People/Oria Valdes.md' },
      ],
    };
    const original = tempDir('yllir-cache-orig-');
    try {
      fs.writeFileSync(
        path.join(original, 'D001.json'),
        JSON.stringify({ fid: 'D001', document: TRAMA, read: true, facts: [FACT] }),
      );
      fs.writeFileSync(
        path.join(original, 'D002.json'),
        JSON.stringify({ fid: 'D002', document: 'People/Oria Valdes.md', read: true, facts: [] }),
      );
      const validated = validateFacts(root, scope, original, vocab);
      assert.equal(validated.complete, true);
      assert.ok(validated.facts.length >= 2, 'the fixture has a body fact and a metadata fact');

      const stored = storeToCache(root, { factsJson: validated, cacheDir });
      assert.deepEqual(stored.stored, [TRAMA, 'People/Oria Valdes.md']);

      const filled = fillFromCache(root, { scope, factsDir, cacheDir });
      assert.deepEqual(filled, { hits: ['D001', 'D002'], misses: [], present: [] });

      const again = validateFacts(root, scope, factsDir, vocab);
      assert.deepEqual(again.facts, validated.facts);
      assert.deepEqual(again.discarded, []);
      assert.equal(again.complete, true);
    } finally {
      fs.rmSync(original, { recursive: true, force: true });
    }
  });
});

test('cli: fill prints the counts and the misses', () => {
  withDirs(({ root, cacheDir, factsDir }) => {
    writeEntry(cacheDir, fs.readFileSync(path.join(root, TRAMA)), [FACT]);
    const scopeFile = path.join(tempDir('yllir-cache-scope-'), 'scope.json');
    fs.writeFileSync(
      scopeFile,
      JSON.stringify({ mode: 'pre', subjects: null, files: [
        { fid: 'D001', document: TRAMA },
        { fid: 'D002', document: POZZO },
      ] }),
    );
    const run = spawnSync(process.execPath, [
      CLI, 'fill', root, '--scope', scopeFile, '--facts-dir', factsDir, '--cache-dir', cacheDir,
    ], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stdout, `cache: 1 hits, 1 to extract\nD002 ${POZZO}\nexit: 0\n`);
    assert.equal(fs.existsSync(path.join(factsDir, 'D001.json')), true);
    fs.rmSync(path.dirname(scopeFile), { recursive: true, force: true });
  });
});

test('cli: store prints the counts; a usage error exits 2', () => {
  withDirs(({ root, cacheDir }) => {
    const factsFile = path.join(tempDir('yllir-cache-facts-'), 'facts.json');
    fs.writeFileSync(
      factsFile,
      JSON.stringify({
        coverage: [{ fid: 'D002', document: POZZO, status: 'read' }],
        facts: [],
        discarded: [],
        ignored_frontmatter: [],
      }),
    );
    const run = spawnSync(process.execPath, [CLI, 'store', root, '--facts', factsFile, '--cache-dir', cacheDir], {
      encoding: 'utf8',
    });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stdout, 'cache: 1 stored, 0 skipped\nexit: 0\n');

    const bad = spawnSync(process.execPath, [CLI, 'store', root], { encoding: 'utf8' });
    assert.equal(bad.status, 2);
    assert.match(bad.stderr, /usage:/);
    fs.rmSync(path.dirname(factsFile), { recursive: true, force: true });
  });
});
