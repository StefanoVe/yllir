import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PDFDocument } from '../../vendor/print-libs.mjs';
import { listCommand, renderCardCommand, sheetsCommand, pruneSheets, stampOf, clockFromEnv, personalCopiesOf, KEEP_SHEETS } from './commands.mjs';
import { objectSheet, makeCampaign, removeCampaign, readText } from './fixtures.mjs';
import { PRINT_CACHE_DIR } from './paths.mjs';
import { parseYamlLite } from '../../../../../scripts/lib/yaml-lite.mjs';

function readStructureOf(root) {
  return parseYamlLite(fs.readFileSync(path.join(root, 'campaign.yaml'), 'utf8')).data.structure;
}

const T1 = new Date('2026-11-12T10:00:00Z');

function sheetsFiles(root) {
  const dir = path.join(root, PRINT_CACHE_DIR);
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => /^sheets-.*\.pdf$/.test(n)).sort() : [];
}

test('stamps and clocks: UTC compact stamp, YLLIR_NOW fixes the clock', () => {
  assert.equal(stampOf(T1), '20261112T100000Z');
  assert.equal(clockFromEnv({ YLLIR_NOW: '2026-11-12T10:00:00Z' }).creationDate.toISOString(), T1.toISOString());
  assert.throws(() => clockFromEnv({ YLLIR_NOW: 'non una data' }), /YLLIR_NOW/);
});

test('retention keeps the newest five sheet files and nothing else', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-prune-'));
  try {
    for (let h = 1; h <= 7; h++) fs.writeFileSync(path.join(dir, `sheets-202611120${h}0000Z.pdf`), 'x');
    fs.writeFileSync(path.join(dir, 'job-a.json'), '{}');
    const removed = pruneSheets(dir);
    assert.equal(removed.length, 2);
    const left = fs.readdirSync(dir).sort();
    assert.equal(left.filter((n) => n.startsWith('sheets-')).length, KEEP_SHEETS);
    assert.ok(left.includes('job-a.json'));
    assert.ok(!left.includes('sheets-20261112T010000Z.pdf'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('sheets: exclusions with reasons, retention after six runs, same bytes under the same clock', async () => {
  const root = makeCampaign({
    sheets: {
      'Oggetti/Lanterna.md': objectSheet({ id: 'lanterna', title: 'Lanterna', shortText: 'Breve.', print: 'to-print' }),
      'Oggetti/Vuota.md': objectSheet({ id: 'vuota', title: 'Vuota', print: 'to-print' }),
    },
  });
  try {
    const clock = { now: T1, creationDate: T1 };
    const first = await sheetsCommand(root, { clock });
    assert.equal(first.code, 0);
    assert.equal(first.value.ok, true);
    assert.deepEqual(first.value.excluded, [{ id: 'vuota', reason: 'no-public-text' }]);
    assert.equal(first.value.file, `${PRINT_CACHE_DIR}/sheets-20261112T100000Z.pdf`);
    const bytesA = fs.readFileSync(path.join(root, first.value.file));
    const doc = await PDFDocument.load(bytesA);
    assert.equal(doc.getPageCount(), 2);

    const again = await sheetsCommand(root, { clock });
    assert.equal(again.code, 0);
    const bytesB = fs.readFileSync(path.join(root, again.value.file));
    assert.equal(Buffer.compare(bytesA, bytesB), 0, 'the same run gives the same bytes');

    for (let h = 11; h <= 16; h++) {
      const later = new Date(`2026-11-12T${h}:00:00Z`);
      assert.equal((await sheetsCommand(root, { clock: { now: later, creationDate: T1 } })).code, 0);
    }
    assert.equal(sheetsFiles(root).length, KEEP_SHEETS);
  } finally {
    removeCampaign(root);
  }
});

test('sheets: nothing printable is a refusal with no file', async () => {
  const root = makeCampaign({
    sheets: { 'Oggetti/Vuota.md': objectSheet({ id: 'vuota', title: 'Vuota' }) },
  });
  try {
    const result = await sheetsCommand(root, { ids: ['vuota'], clock: { now: T1, creationDate: T1 } });
    assert.equal(result.code, 1);
    assert.equal(result.value.file, null);
    assert.deepEqual(result.value.excluded, [{ id: 'vuota', reason: 'no-public-text' }]);
    assert.deepEqual(sheetsFiles(root), []);
  } finally {
    removeCampaign(root);
  }
});

test('sheets: personal cards get one copy per player character, explicit counts win', async () => {
  const root = makeCampaign({
    sheets: {
      'Oggetti/Carta personale.md': objectSheet({ id: 'carta', title: 'Carta', shortText: 'Per il PG.', print: 'to-print', personal: true }),
      'Giocatori/Ada.md': '<!-- yllir\nid: ada\n-->\n# Ada\n',
      'Giocatori/Bruno.md': '<!-- yllir\nid: bruno\n-->\n# Bruno\n',
      'Giocatori/Carla.md': '<!-- yllir\nid: carla\n-->\n# Carla\n',
    },
    categories: [{ id: 'characters', folder: 'Giocatori', type: 'master-only' }],
  });
  try {
    assert.equal(personalCopiesOf(root, readStructureOf(root)), 3);
    const byDefault = await sheetsCommand(root, { clock: { now: T1, creationDate: T1 } });
    assert.equal(byDefault.value.pages, 6, 'three copies, front and back each');
    const explicit = await sheetsCommand(root, { ids: ['carta'], copies: { carta: 1 }, clock: { now: T1, creationDate: T1 } });
    assert.equal(explicit.value.pages, 2);
  } finally {
    removeCampaign(root);
  }
});

test('listing shows every card with its state and no master text', () => {
  const root = makeCampaign({
    sheets: {
      'Oggetti/Lanterna.md': objectSheet({ id: 'lanterna', title: 'Lanterna', shortText: 'Breve.', print: 'printed', master: 'SEGRETO-XYZ' }),
    },
  });
  try {
    const { code, value } = listCommand(root);
    assert.equal(code, 0);
    assert.deepEqual(value.cards, [{
      id: 'lanterna', title: 'Lanterna', path: 'Oggetti/Lanterna.md', category: 'Oggetti', print: 'printed', hasImage: false, personal: false,
    }]);
    assert.equal(JSON.stringify(value).includes('SEGRETO-XYZ'), false);
  } finally {
    removeCampaign(root);
  }
});

test('render-card: node draws the face, refuses to replace it without overwrite, photoshop writes the job', () => {
  const root = makeCampaign({
    sheets: { 'Oggetti/Lanterna.md': objectSheet({ id: 'lanterna', title: 'Lanterna', shortText: 'Breve.' }) },
  });
  try {
    const node = renderCardCommand(root, { id: 'lanterna', renderer: 'node' });
    assert.equal(node.code, 0);
    assert.equal(node.value.file, 'Oggetti/img/lanterna.png');
    assert.ok(fs.existsSync(path.join(root, 'Oggetti/img/lanterna.png')));

    const again = renderCardCommand(root, { id: 'lanterna', renderer: 'node' });
    assert.equal(again.code, 1);
    assert.equal(again.value.error, 'exists');

    const replaced = renderCardCommand(root, { id: 'lanterna', renderer: 'node', overwrite: true });
    assert.equal(replaced.code, 0);

    const job = renderCardCommand(root, { id: 'lanterna', renderer: 'photoshop' });
    assert.equal(job.code, 0);
    assert.equal(job.value.job, `${PRINT_CACHE_DIR}/job-lanterna.json`);
    assert.equal(JSON.parse(readText(root, job.value.job)).text, 'Breve.');

    assert.equal(renderCardCommand(root, { id: 'nessuno', renderer: 'node' }).value.error, 'not-found');
  } finally {
    removeCampaign(root);
  }
});
