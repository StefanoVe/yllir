import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { changeDraft } from './change-draft.mjs';
import { checkBatch, DRAFT_DIR } from './commit.mjs';
import { changePlan } from './change-plan.mjs';
import { ensureRepo } from '../versions.mjs';

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
  'Mondo/molo.md': page(
    ['id: molo-vecchio', 'kind: place', 'provenance: master'],
    '# Molo Vecchio\n\nIl molo antico.\n',
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
  'Storia/doppio.md': page(
    ['id: doppio'],
    '# Doppio\n\nDue link: [Borgo Cenere](../Mondo/borgo.md) e [il borgo](../Mondo/borgo.md#piazza).\n',
  ),
  'Storia/codificato.md': page(
    ['id: codificato'],
    '# Codificato\n\nUn link codificato: [Borgo Cenere](../Mondo/borgo%2Emd).\n',
  ),
  'Storia/rotta.md': page(
    ['id: rotta-sud'],
    '# Rotta sud\n\nSi parte dal [Molo Vecchio](../Mondo/molo.md) e poi [il molo](../Mondo/molo.md#fondo).\n',
  ),
  'Cronaca/2026-10-03.md': page(
    ['id: cronaca-03', 'provenance: played'],
    '# Cronaca del 3 ottobre\n\nIl gruppo rientra a [Borgo Cenere](../Mondo/borgo.md) e trova Il Borgo in festa.\n',
  ),
  'Cronaca/2026-10-04.md': page(
    ['id: cronaca-04', 'provenance: played'],
    '# Cronaca del 4 ottobre\n\nIl gruppo passa da [molo](../Mondo/molo.md) al tramonto.\n',
  ),
  'Appunti/idee.md': page(
    ['id: idee'],
    '# Idee\n\n- Controllare [il borgo](../Mondo/borgo.md).\n- Il Borgo Cenere da rivedere.\n',
  ),
};

function git(dir, args) {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
}

/** Creates a temporary campaign from WORLD, with `extra` files added or replaced (not a git repo). */
function makeCampaign(t, extra = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-change-draft-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'campaign.yaml'), CAMPAIGN_YAML);
  for (const [rel, content] of Object.entries({ ...WORLD, ...extra })) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return root;
}

/** The same campaign as a git repository with one commit, which checkBatch needs. */
function makeRepoCampaign(t) {
  const root = makeCampaign(t);
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['config', 'user.name', 'Test Master']);
  git(root, ['config', 'user.email', 'master@test.invalid']);
  ensureRepo(root);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'fixture']);
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

/**
 * A snapshot without the drafts folder (and the .campaign folder that holds it):
 * what a change wrote outside .campaign/drafts/.
 */
function outsideDrafts(root) {
  const all = snapshot(root);
  return Object.fromEntries(
    Object.entries(all).filter(([rel]) => rel !== '.campaign/' && rel !== `${DRAFT_DIR}/` && !rel.startsWith(`${DRAFT_DIR}/`)),
  );
}

function readDraft(root, rel) {
  return fs.readFileSync(path.join(root, DRAFT_DIR, rel), 'utf8');
}

test('rename writes the new sheet with the new title and the old title as alias, and deletes the old path', (t) => {
  const root = makeCampaign(t);
  const before = outsideDrafts(root);
  const result = changeDraft(root, { op: 'rename', subject: 'borgo-cenere', title: 'Borgo Nuovo' });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(Object.keys(result), ['ok', 'op', 'subject', 'files', 'deletes', 'pending', 'errors']);
  assert.equal(result.op, 'rename');
  assert.equal(result.subject, 'borgo-cenere');
  assert.deepEqual(result.deletes, ['Mondo/borgo.md']);
  assert.ok(result.files.includes('Mondo/Borgo Nuovo.md'), JSON.stringify(result.files));
  assert.deepEqual(result.errors, []);
  assert.equal(
    readDraft(root, 'Mondo/Borgo Nuovo.md'),
    WORLD['Mondo/borgo.md']
      .replace('# Borgo Cenere', '# Borgo Nuovo')
      .replace('aliases: [Il Borgo]', 'aliases: [Il Borgo, Borgo Cenere]'),
  );
  assert.deepEqual(outsideDrafts(root), before);
});

test('rename rewrites the link target and, when it is the old title, the link text; the anchor is kept', (t) => {
  const root = makeCampaign(t);
  changeDraft(root, { op: 'rename', subject: 'borgo-cenere', title: 'Borgo Nuovo' });
  assert.equal(
    readDraft(root, 'Personaggi/teodo.md'),
    WORLD['Personaggi/teodo.md'].replace(
      '[Borgo Cenere](../Mondo/borgo.md#piazza)',
      '[Borgo Nuovo](../Mondo/Borgo%20Nuovo.md#piazza)',
    ),
  );
});

test('rename keeps the link text of a link whose text is not the old title', (t) => {
  const root = makeCampaign(t);
  changeDraft(root, { op: 'rename', subject: 'borgo-cenere', title: 'Borgo Nuovo' });
  assert.equal(
    readDraft(root, 'Storia/incontro.md'),
    WORLD['Storia/incontro.md'].replace('(../Mondo/borgo.md)', '(../Mondo/Borgo%20Nuovo.md)'),
  );
});

test('rename of a chronicle keeps its text and only changes the link target', (t) => {
  const root = makeCampaign(t);
  changeDraft(root, { op: 'rename', subject: 'borgo-cenere', title: 'Borgo Nuovo' });
  assert.equal(
    readDraft(root, 'Cronaca/2026-10-03.md'),
    WORLD['Cronaca/2026-10-03.md'].replace('[Borgo Cenere](../Mondo/borgo.md)', '[Borgo Cenere](../Mondo/Borgo%20Nuovo.md)'),
  );
});

test('rename rewrites every link of one document in one draft', (t) => {
  const root = makeCampaign(t);
  changeDraft(root, { op: 'rename', subject: 'borgo-cenere', title: 'Borgo Nuovo' });
  assert.equal(
    readDraft(root, 'Storia/doppio.md'),
    WORLD['Storia/doppio.md'].replace(
      'Due link: [Borgo Cenere](../Mondo/borgo.md) e [il borgo](../Mondo/borgo.md#piazza).',
      'Due link: [Borgo Nuovo](../Mondo/Borgo%20Nuovo.md) e [il borgo](../Mondo/Borgo%20Nuovo.md#piazza).',
    ),
  );
});

test('rename keeps the percent-encoding style of the original link', (t) => {
  const root = makeCampaign(t);
  changeDraft(root, { op: 'rename', subject: 'borgo-cenere', title: 'Borgo Nuovo' });
  assert.equal(
    readDraft(root, 'Storia/codificato.md'),
    WORLD['Storia/codificato.md'].replace(
      '[Borgo Cenere](../Mondo/borgo%2Emd)',
      '[Borgo Nuovo](../Mondo/Borgo%20Nuovo.md)',
    ),
  );
});

test('rename leaves an unlinked mention in pending and writes no draft for its document', (t) => {
  const root = makeCampaign(t);
  const result = changeDraft(root, { op: 'rename', subject: 'borgo-cenere', title: 'Borgo Nuovo' });
  const census = changePlan(root, 'borgo-cenere');
  assert.deepEqual(result.pending.mentions, census.mentions);
  assert.deepEqual(result.pending.homonyms, census.homonyms);
  assert.ok(result.pending.mentions.some((mention) => mention.file === 'Personaggi/lino.md'));
  assert.equal(result.files.includes('Personaggi/lino.md'), false);
  assert.equal(fs.existsSync(path.join(root, DRAFT_DIR, 'Personaggi/lino.md')), false);
});

test('rename refuses a file name that is taken, with nothing written', (t) => {
  const root = makeCampaign(t);
  const before = snapshot(root);
  const result = changeDraft(root, { op: 'rename', subject: 'borgo-cenere', title: 'taverna' });
  assert.equal(result.ok, false);
  assert.deepEqual(Object.keys(result), ['ok', 'errors']);
  assert.equal(result.errors[0].code, 'path-taken');
  assert.deepEqual(snapshot(root), before);
});

test('rename refuses a title that leaves no file name, with nothing written', (t) => {
  const root = makeCampaign(t);
  const before = snapshot(root);
  for (const title of ['/\\:*?"<>|', '   ']) {
    const result = changeDraft(root, { op: 'rename', subject: 'borgo-cenere', title });
    assert.equal(result.ok, false, title);
    assert.equal(result.errors[0].code, 'bad-title', title);
  }
  assert.deepEqual(snapshot(root), before);
});

test('delete is blocked by still-referenced for every field that holds the id, with nothing written', (t) => {
  const root = makeCampaign(t);
  const before = snapshot(root);
  const result = changeDraft(root, { op: 'delete', subject: 'borgo-cenere' });
  assert.equal(result.ok, false);
  assert.equal(result.errors.length, 2, JSON.stringify(result.errors));
  assert.ok(result.errors.every((error) => error.code === 'still-referenced'));
  assert.ok(result.errors.some((error) => /Personaggi\/teodo\.md/.test(error.message) && /location/.test(error.message)));
  assert.ok(result.errors.some((error) => /Storia\/incontro\.md/.test(error.message) && /depends_on/.test(error.message)));
  assert.deepEqual(snapshot(root), before);
});

test('delete turns every link into its plain text, history or not, and deletes the sheet', (t) => {
  const root = makeCampaign(t);
  const result = changeDraft(root, { op: 'delete', subject: 'molo-vecchio' });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.deletes, ['Mondo/molo.md']);
  assert.deepEqual(result.files, ['Cronaca/2026-10-04.md', 'Storia/rotta.md']);
  assert.equal(
    readDraft(root, 'Storia/rotta.md'),
    WORLD['Storia/rotta.md'].replace(
      'Si parte dal [Molo Vecchio](../Mondo/molo.md) e poi [il molo](../Mondo/molo.md#fondo).',
      'Si parte dal Molo Vecchio e poi il molo.',
    ),
  );
  assert.equal(
    readDraft(root, 'Cronaca/2026-10-04.md'),
    WORLD['Cronaca/2026-10-04.md'].replace('[molo](../Mondo/molo.md)', 'molo'),
  );
});

test('an unknown subject gives unknown-subject with nothing written', (t) => {
  const root = makeCampaign(t);
  const before = snapshot(root);
  const result = changeDraft(root, { op: 'delete', subject: 'nessuno' });
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, 'unknown-subject');
  assert.deepEqual(snapshot(root), before);
});

test('a title is required for rename and forbidden for delete, and the op must be known', (t) => {
  const root = makeCampaign(t);
  const before = snapshot(root);
  assert.equal(changeDraft(root, { op: 'rename', subject: 'borgo-cenere' }).errors[0].code, 'usage');
  assert.equal(changeDraft(root, { op: 'delete', subject: 'molo-vecchio', title: 'X' }).errors[0].code, 'usage');
  assert.equal(changeDraft(root, { op: 'merge', subject: 'borgo-cenere', title: 'X' }).errors[0].code, 'usage');
  assert.deepEqual(snapshot(root), before);
});

test('the drafts of a rename pass checkBatch', async (t) => {
  const root = makeRepoCampaign(t);
  const before = outsideDrafts(root);
  const result = changeDraft(root, { op: 'rename', subject: 'borgo-cenere', title: 'Borgo Nuovo' });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(outsideDrafts(root), before);
  const check = await checkBatch(root, { files: result.files, deletes: result.deletes });
  assert.equal(check.ok, true, JSON.stringify(check.errors));
});

test('the drafts of a delete pass checkBatch', async (t) => {
  const root = makeRepoCampaign(t);
  const before = outsideDrafts(root);
  const result = changeDraft(root, { op: 'delete', subject: 'molo-vecchio' });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(outsideDrafts(root), before);
  const check = await checkBatch(root, { files: result.files, deletes: result.deletes });
  assert.equal(check.ok, true, JSON.stringify(check.errors));
});
