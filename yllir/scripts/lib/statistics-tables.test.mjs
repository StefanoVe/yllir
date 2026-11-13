import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspectStatisticsTables, convertStatisticsTables, validateStatisticsTables, actionRowCount } from './statistics-tables.mjs';
import { validateSheet } from './adapter-ops.mjs';

test('converts only clear labelled rows and preserves outside bytes', async () => {
  const input = 'before\n\n## Statistics\n\nAC: 15\nHP: 22\nAttack: [Claw](rules.md) | +4, 1d6 damage.\n\n## Loot\n\nfur\n';
  const result = convertStatisticsTables(input, 'en');
  assert.equal(result.status, 'converted');
  assert.equal(result.convertedCount, 1);
  assert.ok(result.markdown.startsWith('before\n\n## Statistics'));
  assert.ok(result.markdown.includes('| AC | 15 |'));
  assert.ok(result.markdown.includes('[Claw](rules.md) \\| +4, 1d6 damage.'));
  assert.ok(result.markdown.endsWith('## Loot\n\nfur\n'));
});

test('ambiguous prose and unknown labels remain byte exact and pending', async () => {
  const input = '## Statistics\n\nIt is fast and has sharp claws.\n';
  const inspected = inspectStatisticsTables(input, 'en');
  assert.equal(inspected.status, 'pending');
  assert.equal(inspected.tables[0].classification, 'ambiguous');
  const result = convertStatisticsTables(input, 'en');
  assert.equal(result.markdown, input);
  assert.equal(result.status, 'pending');
});

test('Italian labels and master block are handled without touching master bytes', async () => {
  const input = '## Statistiche\n\nCA: 12\nPF: 9\n\n<!-- master -->\n## Master\nCA segreta: 20\n<!-- /master -->\n';
  const result = convertStatisticsTables(input, 'it');
  assert.equal(result.status, 'converted');
  assert.ok(result.markdown.includes('### Caratteristiche'));
  assert.ok(result.markdown.endsWith('<!-- master -->\n## Master\nCA segreta: 20\n<!-- /master -->\n'));
});

test('already compliant tables are left unchanged; placeholder is not pending', async () => {
  const compliant = '## Statistics\n\n### Characteristics\n\n| Characteristic | Value |\n| --- | --- |\n| AC | 12 |\n';
  assert.equal(inspectStatisticsTables(compliant, 'en').status, 'none');
  assert.equal(inspectStatisticsTables(compliant, 'en').sections.length, 1);
  assert.equal(convertStatisticsTables(compliant, 'en').markdown, compliant);
  assert.equal(inspectStatisticsTables('## Statistics\n\nTo be defined.\n', 'en').status, 'none');
  assert.equal(inspectStatisticsTables('## Statistics\n\nNo statistics: it does not fight.\n', 'en').status, 'none');
  assert.equal(validateStatisticsTables('No statistics: it does not fight.', 'en').ok, false);
});

test('adapter field detection still reads labels from tables', async () => {
  const adapter = { headings: { statistics: { it: 'Statistiche', en: 'Statistics' } }, creature_sheet: { required: [
    { id: 'ac', label_it: 'CA', label_en: 'AC' }, { id: 'hp', label_it: 'PF', label_en: 'HP' },
  ] } };
  const sheet = '---\nid: synthetic\ntemplate: enemy\n---\n\n## Statistics\n\n### Characteristics\n\n| Characteristic | Value |\n| --- | --- |\n| AC | 12 |\n| HP | 8 |\n';
  assert.deepEqual((await validateSheet(adapter, 'creature', sheet, 'en')), { ok: true, errors: [] });
});

test('separates labelled characteristics, actions, and equipment and keeps punctuation', async () => {
  const source = '## Statistics\n\nAC: 15\nHP: 22.\nAttack: Bite | +4, 1d6 damage.\nEquipment: [Spear](items.md)\n';
  const result = convertStatisticsTables(source, 'en');
  assert.match(result.markdown, /### Characteristics[\s\S]*\| HP \| 22\. \|/);
  assert.match(result.markdown, /### Attacks and abilities[\s\S]*\| Attack \| Bite \\\| \+4, 1d6 damage\. \|/);
  assert.match(result.markdown, /### Equipment[\s\S]*\[Spear\]\(items\.md\)/);
});

test('mixed table and prose, duplicate headings, and fenced fake headings remain pending', async () => {
  const mixed = '## Statistics\n\n### Characteristics\n\n| Characteristic | Value |\n| --- | --- |\n| AC | 12 |\nAC: 13\n';
  assert.equal(inspectStatisticsTables(mixed, 'en').status, 'pending');
  assert.equal(convertStatisticsTables(mixed, 'en').markdown, mixed);
  const duplicate = '## Statistics\n\n### Characteristics\n\nAC: 12\n\n### Characteristics\n\nHP: 8\n';
  assert.equal(inspectStatisticsTables(duplicate, 'en').status, 'pending');
  const mixedGroups = '## Statistics\n\n### Attacks and abilities\n\n| Attack or ability | Details |\n| --- | --- |\n| Bite | 1d6 |\n\n### Characteristics\n\nAC: 12\n';
  assert.equal(inspectStatisticsTables(mixedGroups, 'en').status, 'pending');
  const fenced = '## Description\n\n```md\n## Statistics\nCA: 12\n```\n';
  assert.equal(inspectStatisticsTables(fenced, 'en').status, 'none');
  const comment = '## Statistics\n\n<!-- retain me -->\nAC: 12\n';
  assert.equal(inspectStatisticsTables(comment, 'en').status, 'pending');
});

test('ignores master statistics and preserves inline code and existing Markdown escapes', async () => {
  const input = '## Statistics\n\nAC: `1|2`\\|3\n\n<!-- master -->\n## Master\n## Statistics\nAC: 99\n<!-- /master -->\n';
  const result = convertStatisticsTables(input, 'en');
  assert.equal(result.status, 'converted');
  assert.ok(result.markdown.includes('`1\\|2`'));
  assert.ok(result.markdown.includes('\\|3'));
  assert.ok(result.markdown.endsWith('<!-- master -->\n## Master\n## Statistics\nAC: 99\n<!-- /master -->\n'));
});

test('preserves CRLF bytes before and after a converted section', async () => {
  const input = 'before\r\n## Statistics\r\n\r\nAC: 12\r\n\r\n## Loot\r\n\r\ncoin\r\n';
  const result = convertStatisticsTables(input, 'en');
  assert.ok(result.markdown.startsWith('before\r\n## Statistics\r\n'));
  assert.ok(result.markdown.endsWith('\r\n## Loot\r\n\r\ncoin\r\n'));
});

test('actionRowCount counts the data rows of the actions table, not its header and separator', () => {
  const two = '## Statistiche\n\n### Attacchi e capacità\n\n| Attacco o capacità | Dettagli |\n| --- | --- |\n| Pugnale | Colpisce: 1d4 danni. |\n| Morso | Colpisce: 1d6 danni. |\n';
  assert.equal(actionRowCount(two, 'it'), 2);
  const none = '## Statistiche\n\n### Attacchi e capacità\n\n| Attacco o capacità | Dettagli |\n| --- | --- |\n';
  assert.equal(actionRowCount(none, 'it'), 0);
  const noHeading = '## Statistiche\n\n### Caratteristiche\n\n| Caratteristica | Valore |\n| --- | --- |\n| CA | 12 |\n';
  assert.equal(actionRowCount(noHeading, 'it'), 0);
  const en = '## Statistics\n\n### Attacks and abilities\n\n| Attack or ability | Details |\n| --- | --- |\n| Dagger | Hits: 1d4 damage. |\n';
  assert.equal(actionRowCount(en, 'en'), 1);
});

test('findStatisticsSections returns the content range under the Statistiche heading', async () => {
  const { findStatisticsSections } = await import('./statistics-tables.mjs');
  const text = '# Titolo\n\n## Statistiche\n\n### Caratteristiche\n\n| Caratteristica | Valore |\n| --- | --- |\n| CA | 12 |\n\n## Al tavolo\n\nTesto.\n';
  const ranges = findStatisticsSections(text, 'it');
  assert.equal(ranges.length, 1);
  assert.ok(text.slice(ranges[0].start, ranges[0].end).includes('### Caratteristiche'));
  assert.ok(!text.slice(ranges[0].start, ranges[0].end).includes('## Statistiche'));
});
