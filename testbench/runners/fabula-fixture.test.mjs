// Offline test of the fabula-ultima fixture: the adapter's own checks must flag exactly the seeded problems.
// Reads testbench/fixtures/fabula-ultima/campaign (read-only) and key.yaml; writes nothing.
// The sheet and scene validators are the functions the engine calls (adapter-ops.mjs validateSheet and
// loadSceneValueCheck, plot/scene-checks.mjs checkScene). The engine's own file selection is mirrored below.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAdapter, pluginRootFromHere } from '../../yllir/scripts/lib/adapter.mjs';
import { validateSheet, loadSceneValueCheck } from '../../yllir/scripts/lib/adapter-ops.mjs';
import { checkScene } from '../../yllir/scripts/lib/plot/scene-checks.mjs';
import { parseFrontmatter } from '../../yllir/scripts/lib/frontmatter.mjs';
import { parseYamlLite } from '../../yllir/scripts/lib/yaml-lite.mjs';
import { effectiveDie } from '../../yllir/modules/systems/fabula-ultima/checks.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(here, '..', 'fixtures', 'fabula-ultima');
const CAMPAIGN = path.join(FIXTURE, 'campaign');

function readYaml(file) {
  const parsed = parseYamlLite(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(parsed.errors, [], `${file} parses`);
  return parsed.data;
}

function markdownFiles(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return markdownFiles(full, base);
    return entry.name.endsWith('.md') ? [path.relative(base, full).split(path.sep).join('/')] : [];
  }).sort();
}

// Same rule as the engine's isSceneEventFile (commit.mjs): a .md inside a plot folder, in Events or Eventi, not a session main file.
function isSceneEventFile(rel, plotFolders) {
  if (!rel.endsWith('.md') || !plotFolders.some((folder) => rel === folder || rel.startsWith(`${folder}/`))) return false;
  const parent = path.posix.basename(path.posix.dirname(rel));
  if (parent !== 'Eventi' && parent !== 'Events') return false;
  return path.posix.basename(rel, '.md') !== parent;
}

// Every problem the engine's adapter validators report over the fixture: { file, code, message }.
async function fixtureProblems(adapter, lang, structure) {
  const plotFolders = structure.filter((entry) => entry.type === 'plot').map((entry) => entry.folder);
  const checkValue = await loadSceneValueCheck(adapter);
  assert.equal(typeof checkValue, 'function', 'the adapter exports checkSceneCheck');
  const problems = [];
  for (const rel of markdownFiles(CAMPAIGN)) {
    const text = fs.readFileSync(path.join(CAMPAIGN, rel), 'utf8');
    const { data } = parseFrontmatter(text);
    const sketch = data?.sketch === true || data?.sketch === 'true';
    if (!sketch && ['enemy', 'npc', 'vendor'].includes(data?.template)) {
      const checked = await validateSheet(adapter, 'creature', text, lang);
      for (const error of checked.errors) problems.push({ file: rel, code: error.code, message: error.message });
    }
    if (isSceneEventFile(rel, plotFolders)) {
      for (const entry of checkScene(text, lang, { checkValue })) {
        problems.push({ file: rel, code: entry.code, message: entry.message });
      }
    }
  }
  return problems;
}

const loaded = loadAdapter(pluginRootFromHere(), 'fabula-ultima');
const config = readYaml(path.join(CAMPAIGN, 'campaign.yaml'));
const key = readYaml(path.join(FIXTURE, 'key.yaml'));
const lang = config.language.main;

test('the adapter loads and the fixture names it', () => {
  assert.equal(loaded.ok, true, JSON.stringify(loaded.errors));
  assert.equal(config.system.adapter, 'fabula-ultima');
  assert.equal(lang, 'en');
});

test('the adapter checks flag exactly the seeded problems', async () => {
  const problems = await fixtureProblems(loaded.adapter, lang, config.structure);
  const actual = problems.map((p) => `${p.file} ${p.code}`).sort();
  const expected = key.flagged.map((f) => `${f.file} ${f.code}`).sort();
  assert.deepEqual(actual, expected, `problems: ${JSON.stringify(problems, null, 1)}`);
  for (const entry of key.flagged) {
    const hit = problems.find((p) => p.file === entry.file && p.code === entry.code);
    assert.ok(hit, `${entry.file} is flagged with ${entry.code}`);
    if (entry.message) assert.ok(hit.message.includes(entry.message), `${entry.file}: "${hit.message}" contains "${entry.message}"`);
  }
});

test('no problem is reported for the files that must be clean', async () => {
  const problems = await fixtureProblems(loaded.adapter, lang, config.structure);
  const flaggedFiles = new Set(key.flagged.map((f) => f.file));
  for (const file of key.not_flagged) {
    assert.ok(fs.existsSync(path.join(CAMPAIGN, file)), `${file} exists in the fixture`);
    assert.equal(flaggedFiles.has(file), false, `${file} is not in the flagged list`);
    assert.deepEqual(problems.filter((p) => p.file === file), [], `${file} has no problem`);
  }
});

test('the homonym spell has a different effect for the PC and the NPC', () => {
  const pc = fs.readFileSync(path.join(CAMPAIGN, 'Characters', 'Kael Morrow.md'), 'utf8');
  const npc = fs.readFileSync(path.join(CAMPAIGN, 'Characters', 'Ysolde Varn.md'), 'utf8');
  const spell = key.homonym_spell;
  assert.match(pc, new RegExp(`\\b${spell}\\b`));
  assert.match(npc, new RegExp(`\\b${spell}\\b`));
  for (const word of key.pc_spell_effect_words) assert.ok(pc.includes(word), `PC sheet has "${word}"`);
  for (const word of key.npc_spell_effect_words) assert.ok(npc.includes(word), `NPC sheet has "${word}"`);
  for (const word of key.npc_spell_effect_words) assert.ok(!pc.includes(word), `PC sheet does not have "${word}"`);
});

test('tracker: DEX base d8 with slow and enraged is d6', () => {
  const { enemy, dex_base: dexBase, statuses, dex_effective: dexEffective } = key.tracker;
  const sheet = fs.readFileSync(path.join(CAMPAIGN, 'Creature', `${enemy}.md`), 'utf8');
  assert.match(sheet, new RegExp(`\\| DEX \\| ${dexBase} \\|`), `${enemy} has DEX ${dexBase} on its sheet`);
  // The adapter has no function that turns statuses into dice: encounter.mjs only words them. The test counts the
  // statuses that name DEX in condition_effects and gives that count to effectiveDie (checks.mjs).
  const adapter = loaded.adapter;
  const lowering = statuses.filter((status) => (adapter.condition_effects?.[status] ?? []).includes('dex'));
  assert.equal(effectiveDie(dexBase, lowering.length), dexEffective);
  // Never below the floor, however many statuses there are.
  assert.equal(effectiveDie(dexBase, 10), 'd6');
});
