import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  cancelInterruptedUpdate,
  postponeNotice,
  updateCampaign,
} from './update-campaign.mjs';
import { generateInstructions } from '../../../../../scripts/lib/instructions.mjs';
import { ensureRepo, listVersions, saveVersion } from '../../../../../scripts/lib/versions.mjs';
import { stripExitLine } from '../../../../../scripts/lib/cli-exit.mjs';
import { plotMap } from '../../../../../skills/library/plot-map/scripts/lib/plot-map.mjs';

// Identity logic is exercised only when no global or system git config exists.
process.env.GIT_CONFIG_GLOBAL = '/dev/null';
process.env.GIT_CONFIG_NOSYSTEM = '1';

const HERE = import.meta.dirname;
const PLUGIN_JSON = path.resolve(HERE, '../../../../../.claude-plugin/plugin.json');
const CLI = path.resolve(HERE, '../update-campaign.mjs');
const INSTALLED = JSON.parse(fs.readFileSync(PLUGIN_JSON, 'utf8')).version;
const OLD = '0.0.1';

const MINIMAL_CONFIG = `schema: 1
campaign:
  name: "Prova"
language:
  main: it
prose:
  register: plain
system:
  adapter: none
structure:
  - id: trama
    folder: Trama
    type: plot
`;

const tempDirs = [];
after(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-upd-'));
  tempDirs.push(dir);
  return dir;
}

function git(dir, ...args) {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
}

function write(dir, file, text) {
  const full = path.join(dir, file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, text);
}

function read(dir, file) {
  return fs.readFileSync(path.join(dir, file), 'utf8');
}

// A campaign made by the framework and saved as one version (the tree is clean).
function makeCampaign() {
  const dir = tmp();
  ensureRepo(dir);
  write(dir, 'campaign.yaml', MINIMAL_CONFIG);
  generateInstructions(dir);
  saveVersion(dir, { message: 'Campaign created.', kind: 'framework' });
  return dir;
}

// Rewrites the recorded framework version and saves it, as an older install would have left it.
function setVersion(dir, version) {
  const text = read(dir, '.campaign/version.yaml');
  write(dir, '.campaign/version.yaml', text.replace(/^framework_version: .*$/m, `framework_version: "${version}"`));
  saveVersion(dir, { message: `Test: framework version ${version}`, kind: 'framework' });
}

function listTree(dir) {
  const entries = [];
  const walk = (current) => {
    for (const name of fs.readdirSync(current).sort()) {
      if (current === dir && name === '.git') continue;
      const full = path.join(current, name);
      if (fs.statSync(full).isDirectory()) {
        entries.push(`${path.relative(dir, full)}/`);
        walk(full);
      } else {
        entries.push(`${path.relative(dir, full)} ${fs.readFileSync(full, 'utf8').length}`);
      }
    }
  };
  walk(dir);
  return entries;
}

function snapshot(dir) {
  return {
    tree: listTree(dir),
    head: git(dir, 'rev-parse', 'HEAD'),
    status: git(dir, 'status', '--porcelain', '--untracked-files=all'),
  };
}

function writeState(dir, text) {
  write(dir, '.campaign/state/update.yaml', text);
}

test('an up-to-date campaign is reported and nothing is written', () => {
  const dir = makeCampaign();
  const head = git(dir, 'rev-parse', 'HEAD');
  const count = listVersions(dir, { limit: 100 }).length;
  const result = updateCampaign(dir);
  assert.equal(result.status, 'up-to-date');
  assert.equal(result.from, INSTALLED);
  assert.equal(result.to, INSTALLED);
  assert.equal(git(dir, 'rev-parse', 'HEAD'), head);
  assert.equal(listVersions(dir, { limit: 100 }).length, count);
  assert.equal(fs.existsSync(path.join(dir, '.campaign/state/update.yaml')), false);
});

test('a dry-run never clears a stale pending sheet-migration marker', () => {
  const dir = makeCampaign();
  const state = 'status: completed\nsheet_migration_id: "statistics-tables-v1"\nsheet_migration: pending\n';
  write(dir, '.campaign/state/update.yaml', state);
  const result = updateCampaign(dir, { dryRun: true });
  assert.equal(result.status, 'up-to-date');
  assert.equal(result.sheet_migration, 'complete');
  assert.equal(read(dir, '.campaign/state/update.yaml'), state);
});

test('a campaign made with an older version is updated and saved as one version', () => {
  const dir = makeCampaign();
  setVersion(dir, OLD);
  const before = listVersions(dir, { limit: 100 }).length;
  const result = updateCampaign(dir, { today: '2026-11-09' });
  assert.equal(result.status, 'updated');
  assert.equal(result.from, OLD);
  assert.equal(result.to, INSTALLED);
  assert.ok(result.restore_point);
  assert.ok(result.rewritten.includes('.campaign/version.yaml'));
  assert.match(read(dir, '.campaign/version.yaml'), new RegExp(`^framework_version: "${INSTALLED}"$`, 'm'));
  const versions = listVersions(dir, { limit: 100 });
  assert.equal(versions.length, before + 1);
  assert.equal(versions[0].message, `Updated Yllir to ${INSTALLED}`);
  assert.equal(versions[0].kind, 'framework');
  const state = read(dir, '.campaign/state/update.yaml');
  assert.match(state, /^status: completed$/m);
  assert.match(state, /^completed_on: 2026-11-09$/m);
  assert.match(state, /^started_on: 2026-11-09$/m);
});

test('an update identifies legacy statistics blocks and leaves their documents for post-update review', () => {
  const dir = makeCampaign();
  write(dir, 'campaign.yaml', MINIMAL_CONFIG.replace('type: plot', 'type: plot\n  - id: subjects\n    folder: Subjects\n    type: subjects'));
  write(dir, 'Subjects/Guardia.md', '---\nid: guardia\ntemplate: npc\n---\n\n# Guardia\n\n## Statistiche\n\nCA: 13\nPF: 24\n');
  setVersion(dir, OLD);
  const dry = updateCampaign(dir, { dryRun: true });
  assert.equal(dry.sheet_migration, 'pending');
  assert.deepEqual(dry.sheet_migration_files, ['Subjects/Guardia.md']);
  assert.match(read(dir, 'Subjects/Guardia.md'), /CA: 13/);
  const result = updateCampaign(dir, { today: '2026-11-09' });
  assert.equal(result.status, 'updated');
  assert.equal(result.sheet_migration, 'pending');
  assert.deepEqual(result.sheet_migration_files, ['Subjects/Guardia.md']);
  assert.match(read(dir, '.campaign/state/update.yaml'), /^sheet_migration: pending$/m);
  assert.match(read(dir, 'Subjects/Guardia.md'), /CA: 13/);
});

test('a generated file edited by hand is restored, and the edit stays in history', () => {
  const dir = makeCampaign();
  const original = read(dir, 'CLAUDE.md');
  write(dir, 'CLAUDE.md', `${original}Hand edit line\n`);
  const result = updateCampaign(dir);
  assert.equal(result.status, 'updated');
  assert.deepEqual(result.restored_by_hand, ['CLAUDE.md']);
  assert.equal(read(dir, 'CLAUDE.md'), original);

  const manual = listVersions(dir, { paths: ['CLAUDE.md'] }).find((entry) => entry.kind === 'manual');
  assert.ok(manual, 'the hand edit is saved as a manual version');
  assert.match(git(dir, 'show', `${manual.hash}:CLAUDE.md`), /Hand edit line/);
});

test('customizations.md is never changed by an update', () => {
  const dir = makeCampaign();
  write(dir, '.campaign/customizations.md', '# Le mie regole\n\nNiente spoiler sul drago.\n');
  saveVersion(dir, { message: 'Master rules', kind: 'manual' });
  const original = fs.readFileSync(path.join(dir, '.campaign/customizations.md'));
  const historyBefore = git(dir, 'log', '--oneline', '--', '.campaign/customizations.md');
  setVersion(dir, OLD);

  const result = updateCampaign(dir);
  assert.equal(result.status, 'updated');
  assert.equal(result.restored_by_hand.includes('.campaign/customizations.md'), false);
  assert.ok(fs.readFileSync(path.join(dir, '.campaign/customizations.md')).equals(original));
  assert.equal(git(dir, 'log', '--oneline', '--', '.campaign/customizations.md'), historyBefore);
});

test('pending master changes are saved as a manual version before the update', () => {
  const dir = makeCampaign();
  setVersion(dir, OLD);
  write(dir, 'Trama/session.md', 'Notes from the table.\n');

  const result = updateCampaign(dir);
  assert.equal(result.status, 'updated');
  const log = git(dir, 'log', '--format=%s').split('\n');
  assert.equal(log[0], `Updated Yllir to ${INSTALLED}`);
  assert.equal(log[1], `Saved manual changes before updating Yllir to ${INSTALLED}`);
  assert.match(git(dir, 'show', '--name-only', '--format=', 'HEAD~1'), /Trama\/session\.md/);
});

test('a dry run reports the plan and writes nothing at all', () => {
  const dir = makeCampaign();
  setVersion(dir, OLD);
  write(dir, 'Trama/session.md', 'Not saved by a dry run.\n');
  const before = snapshot(dir);

  const result = updateCampaign(dir, { dryRun: true });
  assert.equal(result.status, 'would-update');
  assert.equal(result.from, OLD);
  assert.equal(result.restore_point, null);
  assert.ok(result.rewritten.includes('CLAUDE.md'));
  assert.ok(result.rewritten.includes('.campaign/version.yaml'));
  assert.equal(result.rewritten.includes('.campaign/customizations.md'), false);

  assert.deepEqual(snapshot(dir), before);
  assert.equal(fs.existsSync(path.join(dir, '.campaign/state')), false);
});

test('a folder that is not a git repository is refused', () => {
  const dir = tmp();
  write(dir, 'campaign.yaml', MINIMAL_CONFIG);
  const result = updateCampaign(dir);
  assert.equal(result.status, 'failed');
  assert.equal(result.errors[0].code, 'no-repo');
  assert.equal(result.restore_point, null);
  assert.equal(fs.existsSync(path.join(dir, '.git')), false);
});

test('a folder without campaign.yaml is refused', () => {
  const dir = tmp();
  ensureRepo(dir);
  const result = updateCampaign(dir);
  assert.equal(result.status, 'failed');
  assert.equal(result.errors[0].code, 'missing-config');
});

test('an interrupted update is reported, not started again, and can be cancelled', () => {
  const dir = makeCampaign();
  setVersion(dir, OLD);
  const head = git(dir, 'rev-parse', '--short', 'HEAD');
  writeState(
    dir,
    `status: in_progress\nfrom_version: "${OLD}"\nto_version: "${INSTALLED}"\nrestore_point: "${head}"\nstarted_on: 2026-11-09\n`,
  );

  const blocked = updateCampaign(dir);
  assert.equal(blocked.status, 'failed');
  assert.equal(blocked.errors[0].code, 'interrupted-update');
  assert.equal(blocked.restore_point, head);
  assert.equal(blocked.from, OLD);
  assert.match(read(dir, '.campaign/version.yaml'), new RegExp(`framework_version: "${OLD}"`));

  // The master changed a file after the interruption; cancelling keeps it in history.
  write(dir, 'Trama/draft.md', 'Draft written after the interruption.\n');
  const cancelled = cancelInterruptedUpdate(dir);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.restore_point, head);
  assert.equal(fs.existsSync(path.join(dir, 'Trama/draft.md')), false);
  assert.match(read(dir, '.campaign/state/update.yaml'), /^status: cancelled$/m);
  assert.match(git(dir, 'log', '--all', '--format=%s', '--', 'Trama/draft.md'), /Saved changes before cancelling/);
  assert.equal(cancelInterruptedUpdate(dir).errors[0].code, 'no-interrupted-update');
});

test('resume finishes an interrupted update and keeps its restore point', () => {
  const dir = makeCampaign();
  setVersion(dir, OLD);
  const head = git(dir, 'rev-parse', '--short', 'HEAD');
  writeState(
    dir,
    `status: in_progress\nfrom_version: "${OLD}"\nto_version: "${INSTALLED}"\nrestore_point: "${head}"\nstarted_on: 2026-11-08\n`,
  );
  const result = updateCampaign(dir, { resume: true, today: '2026-11-09' });
  assert.equal(result.status, 'updated');
  assert.equal(result.restore_point, head);
  assert.match(read(dir, '.campaign/version.yaml'), new RegExp(`framework_version: "${INSTALLED}"`));
  assert.match(read(dir, '.campaign/state/update.yaml'), /^status: completed$/m);
});

test('a generation error restores the campaign and marks the update cancelled', () => {
  const dir = makeCampaign();
  setVersion(dir, OLD);
  const versionText = read(dir, '.campaign/version.yaml');
  write(dir, 'campaign.yaml', 'campaign: [unclosed\n');

  const result = updateCampaign(dir);
  assert.equal(result.status, 'failed');
  assert.equal(result.errors[0].code, 'yaml-syntax');
  assert.ok(result.restore_point);
  assert.equal(read(dir, '.campaign/version.yaml'), versionText);
  assert.match(read(dir, '.campaign/state/update.yaml'), /^status: cancelled$/m);
  // The master's broken config was saved before the update began, so it is kept in history.
  assert.match(git(dir, 'log', '--format=%s', '-1'), /Saved manual changes before updating/);
  assert.match(git(dir, 'show', 'HEAD:campaign.yaml'), /campaign: \[unclosed/);
});

test('postponeNotice writes the notice file with a one-day snooze by default', () => {
  const dir = tmp();
  const result = postponeNotice(dir, { today: '2026-11-09' });
  assert.deepEqual(result, {
    status: 'postponed',
    last_notified_version: '',
    last_notified_on: '2026-11-09',
    snoozed_until: '2026-11-10',
  });
  assert.equal(
    read(dir, '.campaign/state/update-notice.yaml'),
    'last_notified_version: ""\nlast_notified_on: 2026-11-09\nsnoozed_until: 2026-11-10\n',
  );
});

test('postponeNotice keeps an existing last_notified_version', () => {
  const dir = tmp();
  write(dir, '.campaign/state/update-notice.yaml', 'last_notified_version: "0.0.9"\nlast_notified_on: 2026-11-01\nsnoozed_until: 2026-11-02\n');
  const result = postponeNotice(dir, { today: '2026-11-09', days: 3 });
  assert.equal(result.last_notified_version, '0.0.9');
  assert.equal(result.snoozed_until, '2026-11-12');
  assert.match(read(dir, '.campaign/state/update-notice.yaml'), /^last_notified_version: "0\.0\.9"$/m);
});

test('postponeNotice rolls the date over the end of a month and a year', () => {
  const dir = tmp();
  assert.equal(postponeNotice(dir, { today: '2026-01-31' }).snoozed_until, '2026-02-01');
  assert.equal(postponeNotice(dir, { today: '2026-12-31' }).snoozed_until, '2027-01-01');
  assert.equal(postponeNotice(dir, { today: '2028-02-25', days: 7 }).snoozed_until, '2028-03-03');
});

test('the CLI prints one JSON document and ends with the exit line', () => {
  const dir = makeCampaign();
  const run = spawnSync(process.execPath, [CLI, dir], { encoding: 'utf8' });
  assert.equal(run.status, 0);
  const lines = run.stdout.trimEnd().split('\n');
  assert.equal(lines[lines.length - 1], 'exit: 0');
  assert.equal(JSON.parse(stripExitLine(run.stdout)).status, 'up-to-date');
});

test('the CLI exits 2 on a usage error and 1 on a known failure', () => {
  const usage = spawnSync(process.execPath, [CLI], { encoding: 'utf8' });
  assert.equal(usage.status, 2);
  assert.equal(usage.stdout.trimEnd().split('\n').pop(), 'exit: 2');

  const notRepo = tmp();
  const failed = spawnSync(process.execPath, [CLI, notRepo, '--dry-run'], { encoding: 'utf8' });
  assert.equal(failed.status, 1);
  assert.equal(failed.stdout.trimEnd().split('\n').pop(), 'exit: 1');
  assert.equal(JSON.parse(stripExitLine(failed.stdout)).errors[0].code, 'no-repo');
});

test('an old-layout campaign is migrated to the session folders in one saved version', () => {
  const dir = makeCampaign();
  write(
    dir,
    'Trama/Ombre/Sessione 1.md',
    '---\nid: ombre-1\ndepends_on: []\nlocation: []\n---\n\n# Arrivo\n\nAl porto.\n\n# Fuga\n\nNella notte.\n',
  );
  setVersion(dir, OLD);

  const result = updateCampaign(dir, { today: '2026-11-09' });
  assert.equal(result.status, 'updated');
  assert.deepEqual(result.migrated, ['Trama/Ombre/Sessione 1.md']);
  assert.deepEqual(result.errors, []);
  assert.equal(fs.existsSync(path.join(dir, 'Trama/Ombre/Sessione 1.md')), false);
  assert.match(read(dir, 'Trama/Sessione 1/Sessione 1.md'), /^arc: "Ombre"$/m);
  assert.match(read(dir, 'Trama/Sessione 1/Eventi/Fuga.md'), /^Nella notte\.$/m);
  assert.equal(listVersions(dir, { limit: 1 })[0].message, `Updated Yllir to ${INSTALLED}`);
  assert.match(git(dir, 'show', '--name-only', '--format=', 'HEAD', '--', 'Trama'), /Trama\/Sessione 1\/Sessione 1\.md/);

  const map = plotMap(dir);
  assert.deepEqual(map.errors, []);
  assert.deepEqual(map.sessions.map((s) => s.id), ['ombre-1']);
  assert.equal(map.sessions[0].events.length, 2);
});
