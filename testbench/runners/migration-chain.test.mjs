// The whole migration chain on the morvalle-legacy fixture: from the campaign before the
// world-graph migration to the current format, in one update. The observable results are
// the ones the old hand-written sequence produced (checked by running both versions).
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { REPO_ROOT } from './lib/case-common.mjs';
import { generateInstructions } from '../../yllir/scripts/lib/instructions.mjs';
import { ensureRepo, listVersions, saveManualChanges, saveVersion } from '../../yllir/scripts/lib/versions.mjs';
import { sessionCheck, formatCheck } from '../../yllir/scripts/lib/session-check.mjs';
import { plotMap } from '../../yllir/scripts/lib/plot/plot-map.mjs';
import { parseYamlLite } from '../../yllir/scripts/lib/yaml-lite.mjs';
import { findMetadataBlock } from '../../yllir/scripts/lib/frontmatter.mjs';
import { listMetadataFiles } from '../../yllir/skills/library/update/scripts/lib/migrate-metadata.mjs';
import { updateCampaign } from '../../yllir/skills/library/update/scripts/lib/update-campaign.mjs';

// Identity logic is exercised only when no global or system git config exists.
process.env.GIT_CONFIG_GLOBAL = '/dev/null';
process.env.GIT_CONFIG_NOSYSTEM = '1';

const FIXTURE = path.join(REPO_ROOT, 'testbench', 'fixtures', 'morvalle-legacy', 'campaign');
const INSTALLED = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'yllir', '.claude-plugin', 'plugin.json'), 'utf8')).version;
const OLD = '0.0.1';
const PENDING = ['category-first-geography-v1', 'item-descriptions-v1', 'statistics-tables-v1'];
const ORDER = ['session-layout-v1', 'category-first-geography-v1', 'item-descriptions-v1', 'statistics-tables-v1', 'world-graph-v1', 'metadata-comment-v1'];

const tempDirs = [];
after(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

/** A copy of the legacy fixture, made by the framework at version 0.0.1 and saved, as the runner does. */
function legacyCampaign() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-chain-'));
  tempDirs.push(tmp);
  const dir = path.join(tmp, 'campaign');
  fs.cpSync(FIXTURE, dir, { recursive: true });
  generateInstructions(dir);
  ensureRepo(dir);
  saveVersion(dir, { message: 'Creata la campagna', kind: 'framework' });
  const versionPath = path.join(dir, '.campaign/version.yaml');
  fs.writeFileSync(versionPath, fs.readFileSync(versionPath, 'utf8').replace(/^framework_version: .*$/m, `framework_version: "${OLD}"`));
  saveManualChanges(dir, 'Prima dell aggiornamento');
  return dir;
}

test('the legacy campaign reaches the current format in one update; the guided parts are left pending', async () => {
  const dir = legacyCampaign();
  const result = await updateCampaign(dir, { today: '2026-11-11' });
  assert.equal(result.status, 'updated');
  assert.deepEqual(result.errors, []);
  assert.deepEqual(Object.keys(result.migrations), ORDER);
  assert.equal(result.migrations['session-layout-v1'], 'complete');
  assert.equal(result.migrations['world-graph-v1'], 'complete');
  assert.equal(result.migrations['metadata-comment-v1'], 'complete');
  assert.deepEqual(result.pending_migrations, PENDING);
  // The fixture's sessions are already folders: only the world graph is old in it.
  assert.deepEqual(result.migrated, []);
  assert.ok(result.world_migration_files.includes('Seme del mondo.md'));

  // The sessions are folders with one file per scene, and their maps are in place.
  const map = plotMap(dir);
  assert.deepEqual(map.errors, []);
  assert.ok(map.sessions.length > 0);
  assert.equal(fs.existsSync(path.join(dir, 'Trama/Sessione 1/Sessione 1.md')), true);
  assert.equal(fs.existsSync(path.join(dir, 'Trama/Sessione 1/Eventi')), true);

  // No campaign document keeps the metadata block in the old --- form.
  for (const rel of listMetadataFiles(dir)) {
    const lines = fs.readFileSync(path.join(dir, rel), 'utf8').split('\n').map((line) => line.replace(/\r$/, ''));
    assert.notEqual(findMetadataBlock(lines)?.format, 'dashes', `${rel} still has the --- form`);
  }

  // The world migration added the seed of the world to campaign.yaml.
  const config = parseYamlLite(fs.readFileSync(path.join(dir, 'campaign.yaml'), 'utf8')).data;
  assert.equal(typeof config.campaign.seed, 'string');

  // The history: the framework version, the world format, then the files of the later migrations.
  const versions = listVersions(dir, { limit: 3 });
  assert.equal(versions[2].message, `Updated Yllir to ${INSTALLED}`);
  assert.equal(versions[1].message, 'Aggiornamento del formato della campagna');
  assert.equal(versions[0].message, `Updated Yllir to ${INSTALLED}`);
  // Nothing is left uncommitted after the update.
  assert.equal(execFileSync('git', ['-C', dir, 'status', '--porcelain'], { encoding: 'utf8' }), '');

  // The session check now names the guided parts that are left, in order.
  const check = sessionCheck(dir);
  assert.deepEqual(check.post_update, PENDING);
  assert.match(formatCheck(check), /^post-update needed: category-first-geography-v1, item-descriptions-v1, statistics-tables-v1$/m);
});

test('a second update of the same campaign changes nothing and saves no version', async () => {
  const dir = legacyCampaign();
  await updateCampaign(dir, { today: '2026-11-11' });
  const count = listVersions(dir, { limit: 1000 }).length;
  const again = await updateCampaign(dir, { today: '2026-11-11' });
  assert.equal(again.status, 'up-to-date');
  assert.deepEqual(again.pending_migrations, PENDING);
  assert.equal(listVersions(dir, { limit: 1000 }).length, count);
});

test('a dry run of the legacy campaign reports the same migrations and writes nothing', async () => {
  const dir = legacyCampaign();
  const before = listVersions(dir, { limit: 1000 }).length;
  const dry = await updateCampaign(dir, { dryRun: true, today: '2026-11-11' });
  assert.equal(dry.status, 'would-update');
  assert.deepEqual(dry.errors, []);
  assert.equal(dry.migrations['session-layout-v1'], 'complete');
  assert.equal(dry.migrations['world-graph-v1'], 'pending');
  assert.equal(listVersions(dir, { limit: 1000 }).length, before);
  assert.equal(fs.existsSync(path.join(dir, '.campaign/state/update.yaml')), false);
});
