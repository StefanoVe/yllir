import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyWorldMigration, planWorldMigration } from './migrate-world.mjs';
import { ensureRepo, listVersions, saveVersion } from '../../../../../scripts/lib/versions.mjs';
import { newTopic, askTopic, finishTopic } from '../../../../../scripts/lib/topics.mjs';
import { parseYamlLite } from '../../../../../scripts/lib/yaml-lite.mjs';
import { parseFrontmatter } from '../../../../../scripts/lib/frontmatter.mjs';

// Identity logic is exercised only when no global or system git config exists.
process.env.GIT_CONFIG_GLOBAL = '/dev/null';
process.env.GIT_CONFIG_NOSYSTEM = '1';

const FIXTURE = path.resolve(import.meta.dirname, '../../../../../../testbench/fixtures/morvalle-legacy/campaign');
const tempDirs = [];
after(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

/** A git copy of the morvalle campaign, saved once as the starting version. */
function freshCampaign({ extraConfig = '', language } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-world-'));
  tempDirs.push(dir);
  fs.cpSync(FIXTURE, dir, { recursive: true });
  if (extraConfig !== '' || language !== undefined) {
    let config = fs.readFileSync(path.join(dir, 'campaign.yaml'), 'utf8');
    if (language !== undefined) config = config.replace('main: it', `main: ${language}`);
    fs.writeFileSync(path.join(dir, 'campaign.yaml'), `${config}${extraConfig}`);
  }
  ensureRepo(dir);
  saveVersion(dir, { message: 'Starting campaign', kind: 'manual' });
  return dir;
}

const read = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const exists = (root, rel) => fs.existsSync(path.join(root, rel));

/** Everything under the campaign except git and the derived cache, as a map of path -> content. */
function snapshot(root) {
  const out = {};
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === '.campaign') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else out[path.relative(root, full)] = fs.readFileSync(full, 'utf8');
    }
  };
  walk(root);
  return out;
}

/** Text after the closing frontmatter line (the body, byte for byte). */
function bodyOf(text) {
  const lines = text.split('\n');
  const close = lines.indexOf('---', 1);
  return lines.slice(close + 1).join('\n');
}

const fm = (root, rel) => parseFrontmatter(read(root, rel)).data;

test('a dry run changes nothing and reports the work it would do', () => {
  const root = freshCampaign();
  const before = snapshot(root);
  const versions = listVersions(root).length;

  const plan = planWorldMigration(root);

  assert.equal(plan.status, 'pending');
  assert.deepEqual(plan.errors, []);
  assert.ok(plan.changed.includes('Mondo/Morvalle/Morvalle.md'));
  assert.ok(plan.changed.includes('campaign.yaml'));
  assert.ok(plan.changed.includes('Seme del mondo.md'));
  assert.ok(plan.changed.includes('.campaign/state/work-note.md') === false);
  assert.deepEqual(snapshot(root), before);
  assert.equal(listVersions(root).length, versions);
  assert.equal(exists(root, '.campaign/cache/world.json'), false);
});

test('kind and provenance are added per category and template; free, plot and chronicle get no kind', () => {
  const root = freshCampaign();
  const result = applyWorldMigration(root);
  assert.equal(result.status, 'complete');
  assert.deepEqual(result.errors, []);

  assert.equal(fm(root, 'Mondo/Morvalle/Morvalle.md').kind, 'place');
  assert.equal(fm(root, 'Mondo/Morvalle/Lago Grigio.md').kind, 'place');
  assert.equal(fm(root, 'Personaggi/Lino Valdes.md').kind, 'character'); // template npc
  assert.equal(fm(root, 'Personaggi/Fosco il Ramaio.md').kind, 'character'); // template vendor
  assert.equal(fm(root, 'Creature/Capra cinerina.md').kind, 'creature'); // template creature
  assert.equal(fm(root, 'Creature/Verme di brace.md').kind, 'creature'); // template enemy
  assert.equal(fm(root, 'Oggetti/Lanterna di Morvalle.md').kind, 'item');
  assert.equal(fm(root, 'Oggetti/Taglia sul verme di brace.md').kind, 'item'); // template notice

  assert.equal(fm(root, 'Storia/Voce del Pozzo.md').kind, undefined);
  assert.equal(fm(root, 'Trama/Sessione 1/Sessione 1.md').kind, undefined);
  assert.equal(fm(root, 'Cronaca/2026-10-03.md').kind, undefined);

  for (const rel of [
    'Mondo/Morvalle/Morvalle.md',
    'Personaggi/Teodo Marr.md',
    'Oggetti/Lanterna di Morvalle.md',
    'Storia/Voce del Pozzo.md',
    'Trama/Sessione 1/Sessione 1.md',
    'Trama/Sessione 1/Eventi/La strada verso la valle.md',
    'Cronaca/2026-10-03.md',
  ]) {
    assert.equal(fm(root, rel).provenance, 'master', rel);
  }
});

test('the inserted lines follow the id line and every body byte stays the same', () => {
  const root = freshCampaign();
  const originals = snapshot(FIXTURE);
  applyWorldMigration(root);

  const edited = snapshot(root);
  const changedDocs = Object.keys(originals).filter(
    (rel) => rel.endsWith('.md') && rel !== 'campaign.yaml' && edited[rel] !== originals[rel],
  );
  assert.ok(changedDocs.length > 20);
  for (const rel of changedDocs) {
    const before = originals[rel];
    const after = edited[rel];
    assert.equal(bodyOf(after), bodyOf(before), `body of ${rel}`);
    const lines = after.split('\n');
    const idIndex = lines.findIndex((line) => line.startsWith('id:'));
    assert.match(lines[idIndex + 1], /^(kind: \S+|provenance: master)$/, rel);
    // Only the inserted lines differ in the frontmatter.
    const kept = lines.filter((line) => !/^(kind: \S+|provenance: master)$/.test(line));
    assert.deepEqual(kept, before.split('\n'), rel);
  }
  // Documents that needed nothing stay byte-identical.
  assert.equal(edited['Appunti/Idee.md'], originals['Appunti/Idee.md']);
});

test('a document without frontmatter id is skipped and reported, not changed', () => {
  const root = freshCampaign();
  fs.writeFileSync(path.join(root, 'Personaggi/Senza id.md'), '# Senza id\n\nTesto.\n');
  const original = read(root, 'Personaggi/Senza id.md');
  const result = applyWorldMigration(root);
  assert.equal(result.status, 'complete');
  assert.deepEqual(result.skipped, [{ file: 'Personaggi/Senza id.md', reason: 'no-id' }]);
  assert.equal(read(root, 'Personaggi/Senza id.md'), original);
});

test('the seed is created with the description, and campaign.yaml keeps its other bytes', () => {
  const root = freshCampaign();
  const before = read(root, 'campaign.yaml');
  applyWorldMigration(root);

  const seed = read(root, 'Seme del mondo.md');
  const data = parseFrontmatter(seed).data;
  assert.equal(data.id, 'seme-del-mondo');
  assert.equal(data.provenance, 'master');
  assert.match(seed, /^# Seme del mondo$/m);
  assert.match(seed, /<!-- master -->\n## Master\n/);
  assert.match(seed, /<!-- \/master -->/);
  const sections = [...seed.matchAll(/^### (.+)$/gm)].map((m) => m[1]);
  assert.deepEqual(sections, ['Genere e tono', 'Temi', 'Conflitti centrali', 'Fazioni', 'Culture', 'Convenzioni dei nomi', 'Livello di potere', 'Calendario', 'Da evitare']);
  assert.match(seed, /### Genere e tono\n\nUna valle coperta di cenere vulcanica, dove un pozzo antico parla a chi sa ascoltare\.\n/);
  assert.match(seed, /### Temi\n\nDa definire\.\n/);

  const after = read(root, 'campaign.yaml');
  const parsed = parseYamlLite(after);
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.data.campaign.seed, 'Seme del mondo.md');
  assert.equal(parsed.data.campaign.description, undefined);
  // Apart from the description line (replaced by the seed key), every line is the same and in the same place.
  const withoutDescription = before.split('\n').filter((line) => !line.startsWith('  description:'));
  const withoutSeed = after.split('\n').filter((line) => !line.startsWith('  seed:'));
  assert.deepEqual(withoutSeed, withoutDescription);
  assert.match(after, /^campaign:\n  name: "Le ceneri della valle"\n  slug: ceneri-della-valle\n  seed: Seme del mondo\.md\n  created: 2026-11-07$/m);
});

test('an English campaign gets the English seed file and sections', () => {
  const root = freshCampaign({ language: 'en' });
  applyWorldMigration(root);
  assert.equal(exists(root, 'World seed.md'), true);
  assert.equal(exists(root, 'Seme del mondo.md'), false);
  const seed = read(root, 'World seed.md');
  assert.match(seed, /^id: world-seed$/m);
  assert.match(seed, /^# World seed$/m);
  assert.match(seed, /### Genre and tone\n\nUna valle/);
  assert.match(seed, /### To avoid\n\nTo be defined\./);
  assert.equal(parseYamlLite(read(root, 'campaign.yaml')).data.campaign.seed, 'World seed.md');
});

test('allow_model_imagination is removed when present and nothing else of campaign.yaml moves', () => {
  const root = freshCampaign({ extraConfig: 'allow_model_imagination: true\n' });
  const before = read(root, 'campaign.yaml');
  assert.match(before, /^allow_model_imagination: true$/m);
  applyWorldMigration(root);
  const after = read(root, 'campaign.yaml');
  assert.doesNotMatch(after, /allow_model_imagination/);
  assert.equal(after.includes('structure:\n  - id: trama'), true);
  assert.equal(after.endsWith('\n'), true);
});

test('the topics of the old engine become one work note, and the topics folder is deleted', () => {
  const root = freshCampaign();
  const topic = newTopic(root, { process: 'prepare-session', goal: 'Preparare la sessione 2' });
  askTopic(root, { id: topic.id, question: 'Quale luogo?', next: 'Chiedere al master il luogo' });
  const closed = newTopic(root, { process: 'after-session', goal: 'Chiuso' });
  finishTopic(root, { id: closed.id, done: 'Fatto' });
  assert.equal(exists(root, '.campaign/state/topics'), true);

  const result = applyWorldMigration(root);
  assert.equal(result.status, 'complete');

  assert.equal(exists(root, '.campaign/state/topics'), false);
  const note = read(root, '.campaign/state/work-note.md');
  const lines = note.split('\n');
  assert.equal(lines[0], '# Work in progress');
  assert.match(lines[1], /^updated: \d{4}-\d{2}-\d{2}T/);
  assert.match(lines[2], /^last saved: [0-9a-f]+ /);
  assert.equal(lines[3], 'files: none');
  assert.equal(lines[4], 'note: Preparare la sessione 2 — next: Chiedere al master il luogo');
});

test('with no open topic the work note says none', () => {
  const root = freshCampaign();
  fs.mkdirSync(path.join(root, '.campaign/state/topics'), { recursive: true });
  applyWorldMigration(root);
  assert.match(read(root, '.campaign/state/work-note.md'), /^note: none$/m);
});

test('the derived indexes are rebuilt', () => {
  const root = freshCampaign();
  applyWorldMigration(root);
  const subjects = JSON.parse(read(root, '.campaign/cache/subjects.json'));
  assert.ok(subjects.subjects.some((s) => s.id === 'lino-valdes' || s.id === 'oria-valdes'));
  const world = JSON.parse(read(root, '.campaign/cache/world.json'));
  const borgo = world.subjects.find((s) => s.id === 'borgo-cenere');
  assert.equal(borgo.kind, 'place');
  assert.equal(borgo.provenance, 'master');
});

test('one framework version is saved with the Italian message', () => {
  const root = freshCampaign();
  const before = listVersions(root).length;
  applyWorldMigration(root);
  const versions = listVersions(root);
  assert.equal(versions.length, before + 1);
  assert.equal(versions[0].message, 'Aggiornamento del formato della campagna');
  assert.equal(versions[0].kind, 'framework');
});

test('a second run changes nothing and reports complete', () => {
  const root = freshCampaign();
  applyWorldMigration(root);
  const versions = listVersions(root).length;
  const before = snapshot(root);
  const again = applyWorldMigration(root);
  assert.equal(again.status, 'complete');
  assert.deepEqual(again.changed, []);
  assert.deepEqual(again.errors, []);
  assert.deepEqual(snapshot(root), before);
  assert.equal(listVersions(root).length, versions);
  assert.equal(planWorldMigration(root).status, 'complete');
});

test('an existing seed file with other content is not overwritten: error seed-exists, nothing written', () => {
  const root = freshCampaign();
  fs.writeFileSync(path.join(root, 'Seme del mondo.md'), '# Altro\n\nGià scritto dal master.\n');
  const before = snapshot(root);
  const versions = listVersions(root).length;

  const result = applyWorldMigration(root);

  assert.equal(result.status, 'failed');
  assert.equal(result.errors[0].code, 'seed-exists');
  assert.deepEqual(snapshot(root), before);
  assert.equal(listVersions(root).length, versions);
});
