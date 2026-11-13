import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkPlayerSheets } from './pc-check.mjs';

function campaign(language = 'it') {
  return [
    'name: Test',
    'language:',
    `  main: ${language}`,
    'structure:',
    '  - id: mondo',
    '    folder: Mondo',
    '    type: places',
    '  - id: giocatori',
    '    folder: Giocatori',
    '    type: master-only',
    '',
  ].join('\n');
}

const IT_SHEET = [
  '<!-- yllir',
  'id: ilde-varno',
  'level: 3',
  '-->',
  '',
  '# Ilde Varno',
  '',
  '## Scheda',
  '',
  'Ladra, mezzelfo.',
  '',
  '## Integrazione con la trama',
  '',
  '### Il debito',
  '',
  '- Gancio: deve denaro alla Gilda del sale.',
  '- Innesco: la Gilda manda un esattore al porto.',
  '- Posta: la sua libertà.',
  '- Stato: pronto',
  '- Sessioni: [sessione-03]',
  '',
  '### La madre',
  '',
  '- Gancio: la madre è viva, in una torre a nord.',
  '- Innesco: una lettera arriva dal nord.',
  '- Posta: il segreto della famiglia.',
  '- Stato: da proporre',
  '',
  '## Background',
  '',
  'Cresciuta al porto.',
  '',
  '## Domande aperte',
  '',
  'Chi era il padre?',
  '',
  '## Originali',
  '',
  'Vedi la scheda cartacea.',
  '',
].join('\n');

const EN_SHEET = [
  '<!-- yllir',
  'id: ilde-varno',
  '-->',
  '',
  '# Ilde Varno',
  '',
  '## Sheet',
  '',
  'Rogue, half-elf.',
  '',
  '## Plot integration',
  '',
  '### The debt',
  '',
  '- Hook: owes money to the Salt Guild.',
  '- Trigger: the Guild sends a collector to the harbor.',
  '- Stakes: her freedom.',
  '- Status: ready',
  '',
  '### The mother',
  '',
  '- Hook: the mother is alive in a tower to the north.',
  '- Trigger: a letter arrives from the north.',
  '- Stakes: the family secret.',
  '- Status: to propose',
  '',
].join('\n');

/** Writes a temporary campaign with the given files, runs `fn` on it and removes it afterwards. */
function withCampaign(files, fn, language = 'it') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-pc-'));
  try {
    const all = { 'campaign.yaml': campaign(language), 'Mondo/Porto.md': '---\nid: porto\n---\n\n# Porto\n', ...files };
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

const FILE = 'Giocatori/Ilde Varno.md';

/** Errors of one player sheet in a campaign of the given language. */
function errorsOf(sheet, language = 'it') {
  return withCampaign({ [FILE]: sheet }, (root) => checkPlayerSheets(root, { files: [FILE] }).errors, language);
}

function codesOf(sheet, language = 'it') {
  return errorsOf(sheet, language).map((e) => e.code);
}

/** Replaces one line of the Italian sheet, failing when the line is not there. */
function replaceLine(sheet, from, to) {
  assert.ok(sheet.includes(from), `fixture has no line ${JSON.stringify(from)}`);
  return sheet.replace(from, to);
}

test('a valid Italian sheet with two hooks (ready and to propose) has no errors', () => {
  assert.deepEqual(errorsOf(IT_SHEET), []);
});

test('a valid English sheet has no errors', () => {
  assert.deepEqual(errorsOf(EN_SHEET, 'en'), []);
});

test('a campaign in another language uses the English labels', () => {
  assert.deepEqual(errorsOf(EN_SHEET, 'fr'), []);
  assert.ok(codesOf(IT_SHEET, 'fr').includes('pc-sections'));
});

test('Background before Integrazione con la trama reports pc-sections', () => {
  const sheet = [
    '<!-- yllir',
    'id: ilde-varno',
    '-->',
    '',
    '# Ilde Varno',
    '',
    '## Scheda',
    '',
    'Ladra.',
    '',
    '## Background',
    '',
    'Cresciuta al porto.',
    '',
    '## Integrazione con la trama',
    '',
    '### Il debito',
    '',
    '- Gancio: a.',
    '- Innesco: b.',
    '- Posta: c.',
    '- Stato: pronto',
    '',
  ].join('\n');
  const errors = errorsOf(sheet);
  assert.deepEqual(errors.map((e) => e.code), ['pc-sections']);
  assert.ok(errors[0].message.includes('Background'), errors[0].message);
});

test('a missing ## Scheda reports pc-sections', () => {
  const sheet = replaceLine(IT_SHEET, '## Scheda', '## Note');
  const errors = errorsOf(sheet);
  assert.ok(errors.some((e) => e.code === 'pc-sections' && e.message.includes('Scheda')), JSON.stringify(errors));
});

test('sections out of order report pc-sections', () => {
  const sheet = [
    '<!-- yllir',
    'id: ilde-varno',
    '-->',
    '',
    '# Ilde Varno',
    '',
    '## Integrazione con la trama',
    '',
    '### Il debito',
    '',
    '- Gancio: a.',
    '- Innesco: b.',
    '- Posta: c.',
    '- Stato: pronto',
    '',
    '## Scheda',
    '',
    'Ladra.',
    '',
  ].join('\n');
  assert.deepEqual(codesOf(sheet), ['pc-sections']);
});

test('an unknown ## heading reports pc-sections', () => {
  const sheet = replaceLine(IT_SHEET, '## Originali', '## Segreti');
  const errors = errorsOf(sheet);
  assert.deepEqual(errors.map((e) => e.code), ['pc-sections']);
  assert.ok(errors[0].message.includes('Segreti'));
});

test('a master block reports pc-master-block', () => {
  const sheet = IT_SHEET + '\n<!-- master -->\n\n## Segreti\n\nIl padre è il Re.\n';
  assert.ok(codesOf(sheet).includes('pc-master-block'));
});

test('a hook without Posta reports pc-hook', () => {
  const sheet = replaceLine(IT_SHEET, '- Posta: la sua libertà.\n', '');
  const errors = errorsOf(sheet);
  assert.deepEqual(errors.map((e) => e.code), ['pc-hook']);
  assert.ok(errors[0].message.includes('Posta'));
});

test('an empty Innesco reports pc-hook', () => {
  const sheet = replaceLine(IT_SHEET, '- Innesco: la Gilda manda un esattore al porto.', '- Innesco:');
  assert.deepEqual(codesOf(sheet), ['pc-hook']);
});

test('a status other than the two allowed values reports pc-hook', () => {
  const sheet = replaceLine(IT_SHEET, '- Stato: pronto', '- Stato: forse');
  assert.deepEqual(codesOf(sheet), ['pc-hook']);
});

test('an English status other than the two allowed values reports pc-hook', () => {
  const sheet = replaceLine(EN_SHEET, '- Status: ready', '- Status: maybe');
  assert.deepEqual(codesOf(sheet, 'en'), ['pc-hook']);
});

test('level 0 reports pc-level', () => {
  const sheet = replaceLine(IT_SHEET, 'level: 3', 'level: 0');
  assert.deepEqual(codesOf(sheet), ['pc-level']);
});

test('level that is not a number reports pc-level', () => {
  const sheet = replaceLine(IT_SHEET, 'level: 3', 'level: abc');
  assert.deepEqual(codesOf(sheet), ['pc-level']);
});

test('a positive level is accepted and a missing level is fine', () => {
  assert.deepEqual(errorsOf(replaceLine(IT_SHEET, 'level: 3', 'level: 12')), []);
  assert.deepEqual(errorsOf(replaceLine(IT_SHEET, 'level: 3\n', '')), []);
});

test('a fifth extra item in a hook is accepted', () => {
  const sheet = replaceLine(IT_SHEET, '- Sessioni: [sessione-03]', '- Sessioni: [sessione-03]\n- Note: il padre è vivo');
  assert.deepEqual(errorsOf(sheet), []);
});

test('a file outside Giocatori is ignored', () => {
  const file = 'Mondo/Nota.md';
  const errors = withCampaign(
    { [file]: replaceLine(IT_SHEET, '## Scheda', '## Note') },
    (root) => checkPlayerSheets(root, { files: [file] }).errors,
  );
  assert.deepEqual(errors, []);
});

test('without a files list every sheet in Giocatori is checked and others are not', () => {
  const errors = withCampaign(
    {
      [FILE]: replaceLine(IT_SHEET, '- Posta: la sua libertà.\n', ''),
      'Mondo/Nota.md': replaceLine(IT_SHEET, '## Scheda', '## Note'),
    },
    (root) => checkPlayerSheets(root).errors,
  );
  assert.deepEqual(errors.map((e) => [e.file, e.code]), [[FILE, 'pc-hook']]);
});
