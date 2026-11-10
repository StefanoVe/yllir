import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { REPO_ROOT, loadYamlMapping } from './lib/case-common.mjs';
import { grade } from './run-item-manager-case.mjs';

const fixture = (mode) => path.join(REPO_ROOT, 'testbench/fixtures/item-manager', mode);
const loadKey = (mode) => loadYamlMapping(path.join(fixture(mode), 'key.yaml'));
const createDraft = `---\nid: sigillo-di-cenere\ntemplate: item\nlocation: [guado-nero]\n---\n# Sigillo di Cenere\n\n## In breve\nDisco di bronzo con tre tacche.\n\n## Descrizione\nIl sigillo è un disco di bronzo con tre tacche. Quando piove, emette una debole luce dorata.\n\n## Effetti\nApre il condotto della diga e, quando piove, emette una debole luce dorata.\n\n<!-- master -->\n## Master\n\n### Indicazioni per il master\nLa lega contiene argento lunare.\n<!-- /master -->\n`;
const createReport = `Luce di Ada è un alias esatto di lanterna-del-guado. La ricerca di Lanterna trova due schede: Lanterna del Guado e Lanterna della Torre; non ho creato duplicati. Nessuna scheda per la tazza scenografica. La bozza è pronta; non riporto qui il dettaglio riservato.`;
const createReportWithIds = `Ran find --name 'Lanterna'. \"Lanterna\" returned partial title matches lanterna-del-guado and lanterna-della-torre. No duplicate created.`;
const checkReport = `ITEM MANAGER REPORT\nstatus: ASK\nmode: check\ncoverage: Checked 3 item sheets and 2 events.\nquestion: Does the medallion have an effect that lets it seal the dam? Scene 1 says it is used for that purpose, while its sheet says it has no game effect.\nproblems:\n- legacy-brief Oggetti/Cerchio.md: missing brief section; upgrade required, no edit made\n- section-order Oggetti/Cerchio.md: required In breve section is out of order\n- public-secret-leak Oggetti/Scatola.md:9: public text contains a secret claim; master-only details omitted\n- description-conflict Oggetti/Scatola.md:4: brief says the box is empty while the full description says it contains coarse salt\n- missing-item-declaration Trama/Diga 1/Eventi/Scena 1.md:9: medallion is used in the event but is absent from its items declaration; existing item id: medaglione-di-ada. The first “Ada” is the character; the second is part of the medallion's title.\n- missing-item-sheet Trama/Diga 1/Eventi/Scena 2.md:9: Chiave della Cisterna is used to open the passage and is absent from the items declaration; no matching subject exists\nopen points:\n- Confirm the medallion's effect; resolve the conflicting box descriptions and public secret leak; add a sheet for Chiave della Cisterna if confirmed. The sigillo di cenere candidate was excluded by audit.exclusions for plot.items. Generic lanterna ignored.`;
const checkReportAlternateCodes = checkReport
  .replace('description-conflict', 'brief-description-mismatch')
  .replace('public-secret-leak', 'master-only-leak')
  .replace('question: Does the medallion have an effect that lets it seal the dam? Scene 1 says it is used for that purpose, while its sheet says it has no game effect.', 'question: The plot says the Medaglione di Ada seals the dam, while its sheet says it has no game effect. Is this an established effect that should be recorded, or does the plot wording need correction?')
  .replace('- missing-item-sheet Trama/Diga 1/Eventi/Scena 2.md:9:', '- missing-item-sheet Trama/Diga 1/Eventi/Scena 2.md:9:')
  .replace('open points:\n-', '- plot-sheet-conflict Trama/Diga 1/Eventi/Scena 1.md:9: plot action conflicts with the sheet\'s established no-effect property; master decision needed.\nopen points:\n-')
  .replace('The first “Ada” is the character; the second is part of the medallion\'s title.', 'The first “Ada” is the character; the second is part of the medallion\'s title.');

function gradeMode(mode, report, drafts, changed = ['.campaign/state/item-manager/report.txt']) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'item-manager-grade-'));
  try {
    const files = drafts.map((content, index) => { const file = path.join(dir, `${index}.md`); fs.writeFileSync(file, content); return file; });
    return grade({ key: loadKey(mode), report, drafts: files, changed });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('create grader accepts a complete, plain, secret-safe draft with all confirmed effects', () => {
  const result = gradeMode('create', createReport, [createDraft]);
  assert.equal(result.pass, true, result.failures.join(', '));
});

test('create grader rejects a secret leaked into public text and a draft written outside state', () => {
  const leaked = createDraft.replace('Quando piove, emette una debole luce dorata.', 'La lega contiene argento lunare. Quando piove, emette una debole luce dorata.');
  const result = gradeMode('create', createReport, [leaked], ['Oggetti/Sigillo.md']);
  assert.equal(result.checks.keeps_secret_master_only, false);
  assert.equal(result.checks.no_secret_in_report, true);
  assert.equal(result.checks.no_campaign_file_written, false);
  assert.equal(result.pass, false);
});

test('create grader accepts both canonical ids as partial title matches', () => {
  const result = gradeMode('create', createReportWithIds, [createDraft]);
  assert.equal(result.checks.reports_both_partial_lanterna_matches, true);
});

test('create grader rejects a report with only one partial lantern match', () => {
  const result = gradeMode('create', createReportWithIds.replace(' and lanterna-della-torre', ''), [createDraft]);
  assert.equal(result.checks.reports_both_partial_lanterna_matches, false);
  assert.equal(result.pass, false);
});

test('create grader accepts a question that offers both full lantern titles', () => {
  const report = `question: Which lantern do you mean, Lanterna del Guado or Lanterna della Torre?`;
  const result = gradeMode('create', report, [createDraft]);
  assert.equal(result.checks.reports_both_partial_lanterna_matches, true);
});

test('create grader rejects a question that offers only one lantern title', () => {
  const report = `question: Which lantern do you mean, Lanterna del Guado?`;
  const result = gradeMode('create', report, [createDraft]);
  assert.equal(result.checks.reports_both_partial_lanterna_matches, false);
});

test('check grader accepts issue-coded findings with file paths, ids, synonyms and contextual Ada disambiguation', () => {
  const result = gradeMode('check', checkReport, []);
  assert.equal(result.pass, true, result.failures.join(', '));
});

test('check grader accepts alternate issue codes and a plot-sheet-conflict finding', () => {
  const result = gradeMode('check', checkReportAlternateCodes, []);
  assert.equal(result.pass, true, result.failures.join(', '));
});

test('check grader rejects a generic unrelated mention used to mask a missed conflict', () => {
  const result = gradeMode('check', checkReport.replace(/- missing-item-declaration[^\n]+\n/, '- note Trama/Diga 1/Eventi/Scena 1.md: a medallion is mentioned.\n').replace(/^question:.*\n/m, 'question: no question recorded.\n'), []);
  assert.equal(result.checks.asks_about_plot_vs_sheet_effect_conflict, false);
  assert.equal(result.pass, false);
});

test('check grader ignores exclusion and scenery notes in open points', () => {
  const result = gradeMode('check', checkReport, []);
  assert.equal(result.checks.does_not_flag_excluded_sigillo, true);
  assert.equal(result.checks.does_not_flag_scenery_lantern, true);
});

test('check grader rejects an actionable false positive for a recorded exclusion', () => {
  const report = checkReport.replace('open points:', 'problems: the sigillo di cenere candidate is missing a sheet.\nopen points:');
  const result = gradeMode('check', report, []);
  assert.equal(result.checks.does_not_flag_excluded_sigillo, false);
  assert.equal(result.pass, false);
});
