import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { changePlan } from './change-plan.mjs';
import { compareStrings } from '../subjects.mjs';

const CAMPAIGN_YAML = `schema: 1

campaign:
  name: "Prova"
  slug: prova

structure:
  - id: mondo
    folder: Mondo
    type: places
  - id: personaggi
    folder: Personaggi
    type: subjects
  - id: storia
    folder: Storia
    type: free
  - id: cronaca
    folder: Cronaca
    type: chronicle
  - id: appunti
    folder: Appunti
    type: notes
`;

/** A document: frontmatter lines, then a body (already Markdown). */
const page = (frontmatter, body) => ['---', ...frontmatter, '---', body, ''].join('\n');

/** A small synthetic campaign. The subject under test is borgo-cenere. */
const WORLD = {
  'Mondo/borgo.md': page(
    ['id: borgo-cenere', 'kind: place', 'provenance: master', 'aliases: [Il Borgo]'],
    '# Borgo Cenere\n\nUn borgo sul lago.\n\n## Piazza\n\nLa piazza del mercato.\n',
  ),
  'Mondo/taverna.md': page(
    ['id: taverna-cenere', 'kind: place', 'provenance: master', 'aliases: [Borgo Cenere]'],
    '# Taverna del Gallo\n\nLa taverna del borgo.\n',
  ),
  'Personaggi/teodo.md': page(
    ['id: teodo-marr', 'kind: character', 'provenance: master', 'location: [borgo-cenere]'],
    '# Teodo Marr\n\nVive a [Borgo Cenere](../Mondo/borgo.md#piazza) con la famiglia.\n',
  ),
  'Personaggi/lino.md': page(
    ['id: lino-valdes', 'kind: character', 'provenance: master'],
    '# Lino Valdes\n\nUn pescatore. Torna spesso da Borgo Cenere. Il Borgo ha un molo.\n',
  ),
  'Storia/incontro.md': page(
    ['id: incontro-molo', 'kind: event', 'provenance: played', 'when: 312', 'depends_on: [borgo-cenere]'],
    '# Incontro al molo\n\nSi ritrovano al [borgo](../Mondo/borgo.md) all\'alba.\n',
  ),
  'Cronaca/2026-10-03.md': page(
    ['id: cronaca-03', 'provenance: played'],
    '# Cronaca del 3 ottobre\n\nIl gruppo rientra a [Borgo Cenere](../Mondo/borgo.md) e trova Il Borgo in festa.\n',
  ),
  'Appunti/idee.md': page(
    ['id: idee'],
    '# Idee\n\n- Controllare [il borgo](../Mondo/borgo.md).\n- Il Borgo Cenere da rivedere.\n',
  ),
};

/** Creates a temporary campaign from WORLD, with `extra` files added or replaced. */
function makeCampaign(t, extra = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-change-plan-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'campaign.yaml'), CAMPAIGN_YAML);
  for (const [rel, content] of Object.entries({ ...WORLD, ...extra })) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return root;
}

/** Every file and folder of a tree, with the content of the files: used to prove nothing was written. */
function snapshot(root) {
  const out = {};
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full).split(path.sep).join('/');
      if (entry.isDirectory()) {
        out[`${rel}/`] = null;
        walk(full);
      } else {
        out[rel] = fs.readFileSync(full, 'utf8');
      }
    }
  };
  walk(root);
  return out;
}

test('a link from another sheet is reported with its text, target and history false', (t) => {
  const result = changePlan(makeCampaign(t), 'borgo-cenere');
  assert.equal(result.ok, true);
  assert.deepEqual(result.subject, {
    id: 'borgo-cenere',
    sheet: 'Mondo/borgo.md',
    title: 'Borgo Cenere',
    forms: ['Borgo Cenere', 'Il Borgo'],
  });
  const fromStory = result.links.find((link) => link.file === 'Storia/incontro.md');
  assert.deepEqual(fromStory, {
    file: 'Storia/incontro.md',
    line: 10,
    text: 'borgo',
    target: '../Mondo/borgo.md',
    history: false,
  });
});

test('a link with an anchor is reported with the anchor as written', (t) => {
  const result = changePlan(makeCampaign(t), 'borgo-cenere');
  assert.deepEqual(
    result.links.filter((link) => link.file === 'Personaggi/teodo.md'),
    [{ file: 'Personaggi/teodo.md', line: 9, text: 'Borgo Cenere', target: '../Mondo/borgo.md#piazza', history: false }],
  );
});

test('an unlinked mention keeps its ambiguous state when a homonym shares the form', (t) => {
  const result = changePlan(makeCampaign(t), 'borgo-cenere');
  const lino = result.mentions.filter((mention) => mention.file === 'Personaggi/lino.md');
  const ambiguous = lino.find((mention) => mention.form === 'Borgo Cenere');
  assert.ok(ambiguous, JSON.stringify(lino));
  assert.equal(ambiguous.state, 'ambiguous');
  assert.equal(ambiguous.history, false);
});

test('an unlinked mention with no homonym is reported as bare with the subject form', (t) => {
  const result = changePlan(makeCampaign(t), 'borgo-cenere');
  const bare = result.mentions.find((mention) => mention.file === 'Personaggi/lino.md' && mention.form === 'Il Borgo');
  assert.deepEqual(bare, { file: 'Personaggi/lino.md', line: 8, form: 'Il Borgo', state: 'bare', history: false });
});

test('a homonym is listed with every subject of its group', (t) => {
  const result = changePlan(makeCampaign(t), 'borgo-cenere');
  assert.equal(result.homonyms.length, 1);
  assert.deepEqual(result.homonyms[0].subjects, ['borgo-cenere', 'taverna-cenere']);
  assert.equal(result.homonyms[0].folded, 'borgo cenere');
});

test('an id held by location and depends_on is reported as a field of another document', (t) => {
  const result = changePlan(makeCampaign(t), 'borgo-cenere');
  assert.deepEqual(result.fields, [
    { file: 'Personaggi/teodo.md', field: 'location', history: false },
    { file: 'Storia/incontro.md', field: 'depends_on', history: false },
  ]);
});

test('a link and a mention inside a chronicle are reported with history true', (t) => {
  const result = changePlan(makeCampaign(t), 'borgo-cenere');
  assert.deepEqual(
    result.links.filter((link) => link.file === 'Cronaca/2026-10-03.md'),
    [{ file: 'Cronaca/2026-10-03.md', line: 7, text: 'Borgo Cenere', target: '../Mondo/borgo.md', history: true }],
  );
  assert.deepEqual(
    result.mentions.filter((mention) => mention.file === 'Cronaca/2026-10-03.md'),
    [{ file: 'Cronaca/2026-10-03.md', line: 7, form: 'Il Borgo', state: 'bare', history: true }],
  );
});

test('notes give links but no mentions, and their links keep history false', (t) => {
  const result = changePlan(makeCampaign(t), 'borgo-cenere');
  assert.deepEqual(
    result.links.filter((link) => link.file === 'Appunti/idee.md'),
    [{ file: 'Appunti/idee.md', line: 6, text: 'il borgo', target: '../Mondo/borgo.md', history: false }],
  );
  assert.equal(result.mentions.some((mention) => mention.file === 'Appunti/idee.md'), false);
});

test('an unknown id gives ok false with the unknown-subject error', (t) => {
  const result = changePlan(makeCampaign(t), 'nessuno');
  assert.equal(result.ok, false);
  assert.deepEqual(Object.keys(result), ['ok', 'errors']);
  assert.equal(result.errors[0].code, 'unknown-subject');
  assert.match(result.errors[0].message, /nessuno/);
});

test('the result is sorted by file then line and is the same on every call', (t) => {
  const root = makeCampaign(t);
  const first = changePlan(root, 'borgo-cenere');
  assert.deepEqual(first, changePlan(root, 'borgo-cenere'));
  for (const key of ['links', 'mentions']) {
    const keys = first[key].map((item) => [item.file, item.line]);
    const sorted = [...keys].sort((a, b) => compareStrings(a[0], b[0]) || a[1] - b[1]);
    assert.deepEqual(keys, sorted, key);
  }
  const files = first.fields.map((field) => field.file);
  assert.deepEqual(files, [...files].sort(compareStrings));
});

test('nothing is written: the campaign folder is identical before and after', (t) => {
  const root = makeCampaign(t);
  const before = snapshot(root);
  changePlan(root, 'borgo-cenere');
  changePlan(root, 'nessuno');
  assert.deepEqual(snapshot(root), before);
});
