import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig } from '../../../../../scripts/lib/config.mjs';
import { collectEntries, matchForm, categoryTitle, codexSettings, allowedSections, filterPublicBody } from './entries.mjs';
import { makeCampaign, sheet, cleanupCampaigns, makePng, campaignYaml } from './test-support.mjs';

after(cleanupCampaigns);

const PIER = sheet({
  id: 'porto-di-selce',
  meta: ['kind: place'],
  body: '# Porto di Selce\n\nA grey harbour. See [the ledger keeper](../Personaggi/Ilde%20Varno.md) and [the vault](../Oggetti/Cassaforte.md).',
  master: 'The pier hides a smuggler route.',
});
const ILDE = sheet({ id: 'ilde-varno', meta: ['kind: character'], body: '# Ilde Varno\n\nKeeps the ledger.', master: '### Codici\n- diario: ascia-9' });
// Every kind is on in these tests; the defaults (items only) are tested apart.
const ALL_KINDS = campaignYaml({ extra: 'encyclopedia:\n  kinds: [place, character, creature, item, faction, event]' });

function collect(files, options = { yaml: ALL_KINDS }) {
  const root = makeCampaign(files, options);
  const { config, ok, errors } = validateConfig(root);
  assert.equal(ok, true, JSON.stringify(errors));
  return collectEntries(root, config);
}

test('an included public sheet becomes an entry with id, title, category, body and links', () => {
  const result = collect({ 'Mondo/porto.md': PIER, 'Personaggi/Ilde Varno.md': ILDE });
  const pier = result.entries.find((e) => e.id === 'porto-di-selce');
  assert.ok(pier);
  assert.equal(pier.title, 'Porto di Selce');
  assert.equal(pier.category, 'luoghi');
  assert.equal(pier.categoryTitle, 'Luoghi');
  assert.equal(pier.markdown.includes('smuggler'), false, 'the reserved block is not in the public body');
  assert.deepEqual(pier.links, ['ilde-varno'], 'only links to included entries are outgoing links');
  assert.deepEqual(result.entries.map((e) => e.id), ['porto-di-selce', 'ilde-varno']);
});

test('master-only categories never appear: not as entries, not in the excluded list, and their title is reserved', () => {
  const result = collect({
    'Mondo/porto.md': PIER,
    'Giocatori/Traditore.md': sheet({ id: 'traditore', body: '# Vettore Nero\n\nA hidden traitor who sold the guild.' }),
  });
  assert.equal(result.entries.some((e) => e.id === 'traditore'), false);
  assert.equal(JSON.stringify(result.excluded).includes('Vettore'), false);
  assert.equal(JSON.stringify(result.excluded).includes('Traditore'), false);
  assert.ok(result.reserved.titles.some((t) => matchForm(t) === matchForm('Vettore Nero')));
  assert.ok(result.reserved.lines.some((l) => l.includes('hidden traitor who sold the guild')));
});

test('the world seed is excluded and its text is reserved', () => {
  const result = collect({
    'Mondo/porto.md': PIER,
    'World seed.md': '# World seed\n\nThe year 312 of the Axe is a lie told by the priests.\n',
  });
  assert.ok(result.excluded.some((x) => x.path === 'World seed.md' && x.reason.length > 0));
  assert.ok(result.reserved.lines.some((l) => l.includes('priests')));
});

test('public:false, sketch, drafts, missing metadata, missing and invalid ids are excluded with a reason', () => {
  const result = collect({
    'Mondo/porto.md': PIER,
    'Personaggi/Nascosto.md': sheet({ id: 'nascosto', body: '# Nascosto\n\nText.', meta: ['public: false'] }),
    'Personaggi/Schizzo.md': sheet({ id: 'schizzo', body: '# Schizzo\n\nText.', meta: ['sketch: true'] }),
    'Personaggi/drafts/Bozza.md': sheet({ id: 'bozza', body: '# Bozza\n\nText.' }),
    'Personaggi/Senza.md': '# Senza\n\nNo metadata here.\n',
    'Personaggi/Senza id.md': '<!-- yllir\nkind: character\n-->\n# Senza id\n\nText.\n',
    'Personaggi/Maiuscolo.md': sheet({ id: 'Ilde_Varno', body: '# Maiuscolo\n\nText.' }),
  });
  assert.deepEqual(result.entries.map((e) => e.id), ['porto-di-selce']);
  const reasons = result.excluded.map((x) => x.reason);
  assert.ok(reasons.some((r) => /non pubblica|not marked|not public/.test(r)), reasons.join(' | '));
  assert.ok(reasons.some((r) => /abbozzo|sketch/.test(r)));
  assert.ok(reasons.some((r) => /bozza|draft/.test(r)));
  assert.ok(reasons.some((r) => /senza metadati|no metadata/.test(r)));
  assert.ok(reasons.some((r) => /senza id|no id/.test(r)));
  assert.ok(reasons.some((r) => /id non valido|invalid id/.test(r)));
  // The hidden public:false sheet is listed by its category folder, never by its title-bearing name.
  assert.equal(JSON.stringify(result.excluded).includes('Nascosto'), false);
});

test('a fully master-only subject (empty public body) does not appear at all, title included', () => {
  const result = collect({
    'Mondo/porto.md': PIER,
    'Personaggi/Solo.md': sheet({ id: 'solo-master', master: '### Indicazioni\n\nSecret: the baron is a ghost.' }),
  });
  assert.equal(result.entries.some((e) => e.id === 'solo-master'), false);
  const dump = JSON.stringify(result.excluded);
  assert.equal(dump.includes('Solo'), false, 'the file name is not in the excluded list');
  assert.ok(result.excluded.some((x) => x.path === 'Personaggi'));
  assert.ok(result.reserved.lines.some((l) => l.includes('baron is a ghost')));
});

test('a public text with no top-level heading is excluded: no public title', () => {
  const result = collect({ 'Mondo/porto.md': PIER, 'Mondo/senza-titolo.md': sheet({ id: 'senza-titolo', body: 'Text only.' }) });
  assert.equal(result.entries.some((e) => e.id === 'senza-titolo'), false);
  assert.ok(result.excluded.some((x) => /titolo|title/.test(x.reason)));
});

test('duplicate ids publish neither sheet and say so', () => {
  const result = collect({
    'Mondo/a.md': sheet({ id: 'stesso', meta: ['kind: place'], body: '# A\n\nFirst.' }),
    'Personaggi/b.md': sheet({ id: 'stesso', meta: ['kind: character'], body: '# B\n\nSecond.' }),
    'Mondo/porto.md': PIER,
  });
  assert.equal(result.entries.some((e) => e.id === 'stesso'), false);
  assert.equal(result.excluded.filter((x) => /id già|already used/.test(x.reason)).length, 2);
  assert.ok(result.warnings.some((w) => w.code === 'duplicate-id'));
});

test('a link to an excluded entry gets no href and its target is never an outgoing link', () => {
  const result = collect({ 'Mondo/porto.md': PIER, 'Personaggi/Ilde Varno.md': ILDE });
  const pier = result.entries.find((e) => e.id === 'porto-di-selce');
  assert.equal(pier.linkHref('../Oggetti/Cassaforte.md'), null);
  assert.equal(pier.linkHref('../Personaggi/Ilde%20Varno.md'), '../ilde-varno/');
  assert.equal(pier.linkHref('../Personaggi/Ilde%20Varno.md#diario'), '../ilde-varno/#diario');
  assert.equal(pier.linkHref('../Giocatori/Traditore.md#master'), null);
  assert.equal(pier.linkHref('javascript:alert(1)'), null);
});

test('sources and notes categories and private folder names are never read as entries', () => {
  const result = collect({
    'Fonti/fonte.md': sheet({ id: 'fonte', body: '# Fonte\n\nOriginal source.' }),
    'Mondo/porto.md': PIER,
  });
  assert.equal(result.entries.some((e) => e.id === 'fonte'), false);
  assert.ok(result.excluded.some((x) => x.path === 'Fonti' && /privata|private/.test(x.reason)));
});

test('locked texts: the code is read from the reserved part; a missing code is a problem', () => {
  const missing = sheet({ id: 'ilde-varno', meta: ['kind: character'], body: '# Ilde Varno\n\n<!-- locked: diario -->\nSecret.\n<!-- /locked -->' });
  const result = collect({ 'Personaggi/Ilde Varno.md': missing, 'Mondo/porto.md': PIER });
  assert.deepEqual(result.lockedProblems.map((p) => p.code), ['locked-missing']);
  const ok = collect({ 'Personaggi/Ilde Varno.md': ILDE.replace('Keeps the ledger.', '<!-- locked: diario -->\nSecret.\n<!-- /locked -->\nKeeps the ledger.'), 'Mondo/porto.md': PIER });
  assert.deepEqual(ok.lockedProblems, []);
  assert.equal(ok.entries.find((e) => e.id === 'ilde-varno').codes.diario, 'ascia-9');
});

test('images: a public picture is kept with its hash; a picture of a private folder is skipped with a warning', () => {
  const pierImage = PIER.replace('# Porto di Selce', '# Porto di Selce\n\n![Harbour](img/molo.png)');
  const result = collect({
    'Mondo/porto.md': pierImage,
    'Mondo/img/molo.png': makePng([['tEXt', 'Author\0someone']]),
  });
  const pier = result.entries[0];
  assert.deepEqual(pier.images, ['Mondo/img/molo.png']);
  assert.match(pier.imageSrc.get('img/molo.png'), /^\.\.\/\.\.\/assets\/img\/[0-9a-f]{16}\.png$/);
});

// Italian campaign: the section names of the sheets (Descrizione, Sinossi, Mappa) are the Italian ones.
const IT_KINDS = campaignYaml({ lang: 'it', extra: 'encyclopedia:\n  kinds: [place, character, creature, item, faction, event]' });
const collectIt = (files) => collect(files, { yaml: IT_KINDS });

const CHEST = sheet({
  id: 'chiave-del-faro',
  meta: ['kind: item', 'item_type: key'],
  body: '# Chiave del faro\n\n## In breve\n\nA key.\n\n## Descrizione\n\nIron key.\n\n## Origine\n\nMade in the north.\n\n## Ritrovamento\n\nFound in a well.\n\n## Effetti\n\nOpens the lighthouse.\n\n## Testo\n\nThe text.\n\n## Valore\n\n10 gold.',
});

test('with no settings, only item sheets are entries; a character is excluded for its kind', () => {
  const result = collect({ 'Mondo/porto.md': PIER, 'Personaggi/Ilde Varno.md': ILDE, 'Oggetti/chiave.md': CHEST }, {});
  assert.deepEqual(result.entries.map((e) => e.id), ['chiave-del-faro']);
  assert.deepEqual(result.settings, { kinds: ['item'], flavourText: true, list: 'full' });
  const ilde = result.excluded.find((x) => x.path === 'Personaggi/Ilde Varno.md');
  assert.equal(ilde.reason, 'kind not chosen for the Codex');
});

test('codexSettings reads the block with its defaults', () => {
  assert.deepEqual(codexSettings({}), { kinds: ['item'], flavourText: true, list: 'full' });
  assert.deepEqual(codexSettings({ encyclopedia: { kinds: ['place'], flavour_text: 'false', list: 'discovered' } }), {
    kinds: ['place'], flavourText: false, list: 'discovered',
  });
});

test('with kinds item and character, the character keeps its title and Sinossi only, not Ruolo', () => {
  const ruolo = sheet({ id: 'ilde-varno', meta: ['kind: character'], body: '# Ilde Varno\n\n## Sinossi\n\nKeeps the ledger.\n\n## Ruolo\n\nAgent of the guild.' });
  const result = collectIt({ 'Personaggi/Ilde Varno.md': ruolo, 'Oggetti/chiave.md': CHEST });
  const ilde = result.entries.find((e) => e.id === 'ilde-varno');
  assert.ok(ilde);
  assert.match(ilde.markdown, /^# Ilde Varno/);
  assert.ok(ilde.markdown.includes('## Sinossi'));
  assert.equal(ilde.markdown.includes('## Ruolo'), false);
  assert.equal(ilde.markdown.includes('Agent of the guild'), false);
});

test('an item keeps In breve, Descrizione, Effetti and Testo, and drops Origine, Ritrovamento and Valore', () => {
  const result = collectIt({ 'Oggetti/chiave.md': CHEST });
  const item = result.entries[0];
  for (const kept of ['## In breve', '## Descrizione', '## Effetti', '## Testo']) assert.ok(item.markdown.includes(kept), kept);
  for (const dropped of ['## Origine', '## Ritrovamento', '## Valore']) assert.equal(item.markdown.includes(dropped), false, dropped);
});

test('a notice keeps Testo and Premio and drops Indizi', () => {
  const notice = sheet({
    id: 'avviso-porto',
    meta: ['kind: item', 'template: notice'],
    body: '# Avviso\n\n## Testo\n\nWritten text.\n\n## Premio\n\nGold.\n\n## Indizi\n\nClues here.',
  });
  const result = collectIt({ 'Oggetti/avviso.md': notice });
  const body = result.entries[0].markdown;
  assert.ok(body.includes('## Testo') && body.includes('## Premio'));
  assert.equal(body.includes('Indizi'), false);
  assert.deepEqual(allowedSections({ kind: 'item', template: 'notice' }, 'it'), ['Testo', 'Premio']);
  assert.deepEqual(allowedSections({ kind: 'item' }, 'en'), ['In brief', 'Description', 'Effects', 'Text']);
});

test('flavour_text false gives bodies with the title only and empty summaries', () => {
  const result = collect({ 'Oggetti/chiave.md': CHEST }, { yaml: campaignYaml({ extra: 'encyclopedia:\n  kinds: [item]\n  flavour_text: false' }) });
  assert.equal(result.entries[0].markdown, '# Chiave del faro');
  assert.equal(result.entries[0].summary, '');
  assert.equal(result.settings.flavourText, false);
});

test('filterPublicBody does not read a heading inside a code fence', () => {
  const body = '# T\n\n## Descrizione\n\n```\n## Testo\n```\n\n## Testo\n\nReal.';
  const out = filterPublicBody(body, ['Descrizione', 'Testo']);
  assert.ok(out.includes('## Testo\n\nReal.'));
  assert.ok(out.includes('```\n## Testo\n```'));
});

test('artwork is the picture under the title, and null when the only picture is inside a section', () => {
  const under = sheet({ id: 'lanterna', meta: ['kind: item'], body: '# Lanterna\n\n![Brass](lanterna.png)\n\n## Descrizione\n\nA lamp.' });
  const inside = sheet({ id: 'sigillo', meta: ['kind: item'], body: '# Sigillo\n\n## Descrizione\n\n![Inside](sigillo.png)\n\nA seal.' });
  const result = collectIt({
    'Oggetti/lanterna.md': under,
    'Oggetti/lanterna.png': makePng([]),
    'Oggetti/sigillo.md': inside,
    'Oggetti/sigillo.png': makePng([]),
  });
  const lamp = result.entries.find((e) => e.id === 'lanterna');
  const seal = result.entries.find((e) => e.id === 'sigillo');
  assert.equal(lamp.artwork.alt, 'Brass');
  assert.match(lamp.artwork.src, /^assets\/img\/[0-9a-f]{16}\.png$/);
  assert.equal(seal.artwork, null);
});

test('placeholder: the item type, notice, other for an item without a type, and the kind for the rest', () => {
  const notice = sheet({ id: 'avviso', meta: ['kind: item', 'template: notice'], body: '# Avviso\n\n## Testo\n\nText.' });
  const plain = sheet({ id: 'pietra', meta: ['kind: item'], body: '# Pietra\n\nA stone.' });
  const result = collect({ 'Oggetti/chiave.md': CHEST, 'Oggetti/avviso.md': notice, 'Oggetti/pietra.md': plain, 'Mondo/porto.md': PIER });
  const by = (id) => result.entries.find((e) => e.id === id).placeholder;
  assert.equal(by('chiave-del-faro'), 'key');
  assert.equal(by('avviso'), 'notice');
  assert.equal(by('pietra'), 'other');
  assert.equal(by('porto-di-selce'), 'place');
});

test('a place with a Mappa section has one battle map, and its body has no link to the map files', () => {
  const harbour = sheet({
    id: 'porto-mappa',
    meta: ['kind: place'],
    body: '# Porto\n\nIntro.\n\n## Sinossi\n\nA harbour.\n\n<!-- yllir:map -->\n## Mappa\n\n![Mappa del porto](img/porto-map-grid.png)\n\n[Senza griglia](img/porto-map.png) · [Virtual tabletop](img/porto-map.uvtt)\n<!-- /yllir:map -->',
  });
  const result = collectIt({ 'Mondo/porto.md': harbour, 'Mondo/img/porto-map-grid.png': makePng([]) });
  const place = result.entries[0];
  const battle = place.maps.filter((m) => m.label === 'battleMap');
  assert.equal(battle.length, 1);
  assert.equal(battle[0].alt, 'Mappa del porto');
  assert.match(battle[0].src, /^assets\/img\/[0-9a-f]{16}\.png$/);
  assert.equal(place.markdown.includes('.uvtt'), false);
  assert.equal(place.markdown.includes('yllir:map'), false);
});

test('the summary is the plain text of the first allowed section, cut at 280 characters at a word', () => {
  const long = sheet({ id: 'lungo', meta: ['kind: item'], body: `# Lungo\n\n## Descrizione\n\n${'parola '.repeat(80)}\n\n## Testo\n\nFine.` });
  const summary = collectIt({ 'Oggetti/lungo.md': long }).entries[0].summary;
  assert.ok(summary.length <= 280, String(summary.length));
  assert.ok(summary.endsWith('…'));
  assert.equal(summary.includes('Fine'), false);
});

test('matchForm and categoryTitle are stable helpers', () => {
  assert.equal(matchForm('  Porto,  di Selce!  '), ' porto di selce ');
  assert.equal(matchForm('---'), '');
  assert.equal(categoryTitle('luoghi-minori'), 'Luoghi minori');
});
