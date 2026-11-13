import test from 'node:test';
import assert from 'node:assert/strict';
import { loadAdapter, pluginRootFromHere } from './adapter.mjs';
import { cardFields, loadRateEncounter, loadRollFix, loadStatSummary, progressionEvent, validateSheet } from './adapter-ops.mjs';

const adapter = loadAdapter(pluginRootFromHere(), 'dnd-2024').adapter;
const completeStats = 'CA 12 · PF 20 · Velocità 9 · FOR 10 · DES 11 · COS 12 · INT 13 · SAG 14 · CAR 15';

function creature(stats = completeStats, extra = '') {
  return `---\nid: synthetic-subject\ntemplate: enemy\n---\n\n# Custode\n\n## Natura\n\nUna descrizione inventata.\n\n## Statistiche\n\n${stats}\n${extra}`;
}

test('complete synthetic enemy sheet passes', async () => {
  assert.equal((await validateSheet(adapter, 'creature', creature(), 'it')).ok, true);
});

test('missing field reports its field id', async () => {
  const result = (await validateSheet(adapter, 'creature', creature(completeStats.replace('COS 12 · ', '')), 'it'));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((entry) => entry.code === 'missing-field' && entry.message.includes('con')));
});

test('labels match as whole Unicode letter and digit tokens', async () => {
  const result = (await validateSheet(adapter, 'creature', creature('CA 12 · PF 20 · Velocità 9 · FOR 10 · DESCRIZIONE · PFX · CARTA · INT 13 · SAG 14 · CHA 15'), 'it'));
  assert.deepEqual(result.errors.filter((entry) => entry.code === 'missing-field').map((entry) => entry.message), [
    'missing field: dex', 'missing field: con', 'missing field: cha',
  ]);
});

test('fields appearing only in master block do not count', async () => {
  const text = `---\nid: synthetic-subject\ntemplate: enemy\n---\n\n# Custode\n\n## Statistiche\n\n${completeStats.replace('COS 12 · ', '')}\n\n<!-- master -->\n## Master\n\n### Note\n\nCOS 12\n<!-- /master -->`;
  const result = (await validateSheet(adapter, 'creature', text, 'it'));
  assert.ok(result.errors.some((entry) => entry.code === 'missing-field' && entry.message.includes('con')));
});

test('inline master marker truncates creature statistics', async () => {
  const beforeMarker = completeStats.replace('COS 12 · ', '');
  const text = `---\nid: synthetic-subject\ntemplate: enemy\n---\n\n# Custode\n\n## Statistiche\n\n${beforeMarker} <!-- master --> COS 12`;
  const result = (await validateSheet(adapter, 'creature', text, 'it'));
  assert.ok(result.errors.some((entry) => entry.code === 'missing-field' && entry.message.includes('con')));
});

test('non-combat creature requires the statistics section but no fields', async () => {
  const text = '---\nid: synthetic-creature\ntemplate: creature\n---\n\n# Compagno\n\n## Statistiche\n\nNessuna statistica.';
  assert.deepEqual((await validateSheet(adapter, 'creature', text, 'it')), { ok: true, errors: [] });
});

test('English labels are checked using the selected language', async () => {
  const text = '---\nid: synthetic-subject\ntemplate: enemy\n---\n\n# Warden\n\n## Statistics\n\nAC 12 · HP 20 · Speed 9 · STR 10 · DEX 11 · CON 12 · INT 13 · WIS 14 · CHA 15';
  assert.deepEqual((await validateSheet(adapter, 'creature', text, 'en')), { ok: true, errors: [] });
});

test('unsupported language and kind return stable error codes', async () => {
  assert.equal((await validateSheet(adapter, 'creature', creature(), 'fr')).errors[0].code, 'unsupported-language');
  assert.equal((await validateSheet(adapter, 'other', creature(), 'it')).errors[0].code, 'bad-kind');
  assert.equal(cardFields(adapter, '# Thing', 'fr').errors[0].code, 'unsupported-language');
});

test('item validation requires description and effects sections', async () => {
  const text = '# Token\n\n## Descrizione\n\nUn gettone.\n\n## Effetti\n\nNessun effetto.';
  assert.deepEqual((await validateSheet(adapter, 'item', text, 'it')), { ok: true, errors: [] });
  assert.ok((await validateSheet(adapter, 'item', '# Token\n\n## Descrizione\n\nUn gettone.', 'it')).errors.some((entry) => entry.code === 'missing-section'));
});

test('card fields expose only printable title and description', async () => {
  const text = `---\nid: synthetic-item\ntemplate: item\n---\n\n# Lanterna anonima\n\n## Descrizione\n\nUna lanterna dal vetro scuro.\n\n## Effetti\n\nTesto meccanico da escludere.\n\n<!-- master -->\n## Master\n\n### Note\n\nSegreto da escludere.\n<!-- /master -->`;
  const result = cardFields(adapter, text, 'it');
  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(result.fields), ['title', 'description']);
  assert.equal(result.fields.title, 'Lanterna anonima');
  assert.equal(result.fields.description, 'Una lanterna dal vetro scuro.');
  assert.equal(JSON.stringify(result.fields).includes('meccanico'), false);
  assert.equal(JSON.stringify(result.fields).includes('Segreto'), false);
});

test('card fields prefer the brief description and never expose master notes', async () => {
  const text = `---\nid: synthetic-item\ntemplate: item\n---\n\n# Lanterna\n\n## In breve\n\nUna lanterna compatta.\n\n## Descrizione\n\nLa lanterna ha una storia più completa.\n\n## Effetti\n\nEffetto pubblico.\n\n<!-- master -->\n## Master\n\n### Indicazioni per il master\n\nSegreto nascosto.\n<!-- /master -->`;
  const result = cardFields(adapter, text, 'it');
  assert.equal(result.ok, true);
  assert.deepEqual(result.fields, { title: 'Lanterna', description: 'Una lanterna compatta.' });
  assert.equal(JSON.stringify(result.fields).includes('Segreto'), false);
  assert.equal(JSON.stringify(result.fields).includes('Effetto pubblico'), false);
});

test('legacy item cards fall back to Description', async () => {
  const text = '# Token\n\n## Descrizione\n\nUn token antico.\n\n## Effetti\n\nNessun effetto.';
  assert.deepEqual(cardFields(adapter, text, 'it').fields, { title: 'Token', description: 'Un token antico.' });
});

test('card-fields uses the conventional brief heading when an adapter omits it', async () => {
  const withoutBrief = { ...adapter, headings: { ...adapter.headings } };
  delete withoutBrief.headings.brief;
  const text = '# Token\n\n## In breve\n\nUn token compatto.\n\n## Descrizione\n\nDettaglio esteso.\n\n## Effetti\n\nNessun effetto.';
  assert.deepEqual(cardFields(withoutBrief, text, 'it').fields, { title: 'Token', description: 'Un token compatto.' });
});

test('inline master marker truncates item description', async () => {
  const text = '# Lanterna anonima\n\n## Descrizione\n\nUna lanterna. <!-- master --> Segreto da escludere.\n\n## Effetti\n\nNessun effetto.';
  const result = cardFields(adapter, text, 'it');
  assert.equal(result.fields.description, 'Una lanterna.');
  assert.equal(JSON.stringify(result.fields).includes('Segreto'), false);
});

test('card fields report missing printable fields', async () => {
  const result = cardFields(adapter, '# Senza descrizione', 'it');
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((entry) => entry.code === 'missing-field'));
});

test('progression records only a master-declared milestone', async () => {
  assert.deepEqual(progressionEvent(adapter, { kind: 'milestone', declared_by_master: true }), { ok: true, milestone: true });
  assert.equal(progressionEvent(adapter, { kind: 'milestone' }).reason, 'not-declared-by-master');
  assert.equal(progressionEvent(adapter, { kind: 'other', declared_by_master: true }).reason, 'not-a-milestone');
  assert.equal(progressionEvent({ progression: { method: 'experience' } }, { kind: 'milestone', declared_by_master: true }).reason, 'adapter-has-no-milestones');
});

function characteristicsSheet({ str = '14 (+2)', cr = '5', proficiency = '+3' } = {}) {
  return creature(`### Caratteristiche

| Caratteristica | Valore |
| --- | --- |
| CA | 15 (cuoio borchiato) |
| PF | 33 (6d10) |
| Velocità | 9 |
| FOR | ${str} |
| DES | 11 (+0) |
| COS | 12 (+1) |
| INT | 13 (+1) |
| SAG | 14 (+2) |
| CAR | 15 (+2) |
| Sfida | ${cr} |
| Bonus competenza | ${proficiency} |
`);
}

test('creature table with correct arithmetic passes the adapter checks', async () => {
  assert.deepEqual(await validateSheet(adapter, 'creature', characteristicsSheet(), 'it'), { ok: true, errors: [] });
});

test('creature table with a wrong modifier fails with bad-modifier', async () => {
  const result = await validateSheet(adapter, 'creature', characteristicsSheet({ str: '14 (+3)' }), 'it');
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((entry) => entry.code === 'bad-modifier' && entry.message.includes('str')));
});

test('creature table with a wrong proficiency bonus fails with bad-proficiency', async () => {
  const result = await validateSheet(adapter, 'creature', characteristicsSheet({ proficiency: '+2' }), 'it');
  assert.deepEqual(result.errors.map((entry) => entry.code), ['bad-proficiency']);
});

test('creature attack with a precomputed roll fails with precomputed-roll', async () => {
  const extra = '\n### Attacchi e capacità\n\n| Attacco | Dettagli |\n| --- | --- |\n| Lancia | Attacco in mischia: +3. Colpisce: 4 (1d6 + 1) danni perforanti. |\n';
  const result = await validateSheet(adapter, 'creature', creature(completeStats, extra), 'it');
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((entry) => entry.code === 'precomputed-roll'));
});

test('adapter checks are skipped for non-combat creatures', async () => {
  const text = '---\nid: synthetic-creature\ntemplate: creature\n---\n\n# Compagno\n\n## Statistiche\n\n### Caratteristiche\n\n| Caratteristica | Valore |\n| --- | --- |\n| FOR | 14 (+9) |';
  assert.deepEqual(await validateSheet(adapter, 'creature', text, 'it'), { ok: true, errors: [] });
});

test('loadRollFix gives the fixRolls of the dnd-2024 checks, and null without a checks file', async () => {
  assert.equal(typeof (await loadRollFix(adapter)), 'function');
  assert.equal(await loadRollFix({ id: 'no-checks' }), null);
});

test('loadRateEncounter gives the rateEncounter of dnd-2024, and null without difficulty.ops', async () => {
  assert.equal(typeof (await loadRateEncounter(adapter)), 'function');
  assert.equal(await loadRateEncounter({ id: 'no-ops', difficulty: { method: 'band-and-cr' } }), null);
  assert.equal(await loadRateEncounter(null), null);
});

test('loadStatSummary gives the statSummary of dnd-2024, and null without encounter_ops', async () => {
  assert.equal(typeof (await loadStatSummary(adapter)), 'function');
  assert.equal(await loadStatSummary({ id: 'no-ops', checksPath: adapter.checksPath }), null);
  assert.equal(await loadStatSummary(null), null);
});
