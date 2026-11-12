import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig } from '../../../../../scripts/lib/config.mjs';
import { collectEntries, matchForm, categoryTitle } from './entries.mjs';
import { makeCampaign, sheet, cleanupCampaigns, makePng } from './test-support.mjs';

after(cleanupCampaigns);

const PIER = sheet({
  id: 'porto-di-selce',
  body: '# Porto di Selce\n\nA grey harbour. See [the ledger keeper](../Personaggi/Ilde%20Varno.md) and [the vault](../Oggetti/Cassaforte.md).',
  master: 'The pier hides a smuggler route.',
});
const ILDE = sheet({ id: 'ilde-varno', body: '# Ilde Varno\n\nKeeps the ledger.', master: '### Codici\n- diario: ascia-9' });

function collect(files, options) {
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
    'Mondo/a.md': sheet({ id: 'stesso', body: '# A\n\nFirst.' }),
    'Personaggi/b.md': sheet({ id: 'stesso', body: '# B\n\nSecond.' }),
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
  const missing = sheet({ id: 'ilde-varno', body: '# Ilde Varno\n\n<!-- locked: diario -->\nSecret.\n<!-- /locked -->' });
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

test('matchForm and categoryTitle are stable helpers', () => {
  assert.equal(matchForm('  Porto,  di Selce!  '), ' porto di selce ');
  assert.equal(matchForm('---'), '');
  assert.equal(categoryTitle('luoghi-minori'), 'Luoghi minori');
});
