// Offline tests of the system case runner: the cases and keys load, every case sets up a copy with one
// saved version and its game system, and the graders pass hand-made correct results and fail the traps.
// No model runs: the agent is never called.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { REPO_ROOT } from './lib/case-common.mjs';
import {
  fightState,
  gradeSystemRun,
  loadSystemCase,
  setupSystemCopy,
  snapshotSystem,
  validateSystemKey,
} from './run-system-case.mjs';
import { listVersions } from '../../yllir/scripts/lib/versions.mjs';

const RUNNER = path.join(REPO_ROOT, 'testbench', 'runners', 'run-system-case.mjs');
const COMBAT = path.join(REPO_ROOT, 'yllir', 'skills', 'library', 'combat-tracker', 'scripts', 'combat.mjs');
const CASES = path.join(REPO_ROOT, 'testbench', 'cases', 'system');
const NAMES = ['fu-rules-v11', 'fu-homonym-veil', 'fu-tracker-statuses', 'fu-check-flags'];

function caseOf(name) {
  return loadSystemCase(path.join(CASES, name));
}

/** Sets up a copy of a case, runs the test body on it and removes the temporary folder. */
function withCopy(name, body) {
  const caseData = caseOf(name);
  const setup = setupSystemCopy(caseData);
  try {
    return body(setup, caseData);
  } finally {
    fs.rmSync(setup.tmp, { recursive: true, force: true });
  }
}

/** Runs the combat tracker on a copy, as the agent would (operation, then root, then options), and returns its parsed output. */
function combat(copy, [op, ...options]) {
  const out = spawnSync('node', [COMBAT, op, copy, ...options], { encoding: 'utf8' });
  // The tool prints its JSON and then a line `exit: <code>`, which is not part of the JSON.
  const parsed = JSON.parse(out.stdout.replace(/\r?\nexit: \d+\s*$/, ''));
  return { status: out.status, parsed };
}

/** A fight with The Brine Warden holding the conditions given, written by combat.mjs itself. */
function startFight(copy, conditions) {
  assert.equal(combat(copy, ['start']).status, 0, 'start the fight');
  const added = combat(copy, ['add', '--name', 'The Brine Warden', '--side', 'enemy', '--hp', '150', '--hp-max', '150', '--sheet', 'Creature/The Brine Warden.md']);
  assert.equal(added.status, 0, 'add the Warden');
  const id = added.parsed.combat.combatants[0].id;
  for (const condition of conditions) {
    const done = combat(copy, ['condition-add', '--id', id, '--condition', condition]);
    assert.equal(done.status, 0, `add ${condition}`);
  }
}

// ---------------------------------------------------------------- cases and keys

test('every system case loads with its fixture, its runs and its limits', () => {
  for (const name of NAMES) {
    const data = caseOf(name);
    assert.equal(data.case, `system-${name}`, `${name}: case name is <kind>-<name>`);
    assert.equal(data.fixture, 'fabula-ultima');
    assert.equal(data.runs, 3, `${name}: runs per agent`);
    assert.deepEqual(data.limits, { max_minutes: 3, max_tool_calls: 60 }, `${name}: limits`);
    assert.ok(!fs.existsSync(path.join(CASES, name, 'campaign')), `${name}: no campaign folder beside the key`);
  }
  assert.equal(caseOf('fu-tracker-statuses').live_session, true);
  assert.equal(caseOf('fu-rules-v11').live_session, false);
});

test('the keys keep their answer out of the campaign and the regexes are case-insensitive', () => {
  const fixtureCampaign = path.join(REPO_ROOT, 'testbench', 'fixtures', 'fabula-ultima', 'campaign');
  assert.ok(!fs.existsSync(path.join(fixtureCampaign, 'key.yaml')));
  const key = caseOf('fu-tracker-statuses').key;
  assert.equal(key.fight.combatant, 'Brine Warden');
  assert.deepEqual(key.fight.conditions, ['slow', 'enraged']);
  assert.ok(new RegExp(key.text_all[0], 'i').test('It rolls a D6.'));
});

test('validateSystemKey rejects a bad pattern, a bad list and a bad fight block', () => {
  assert.throws(() => validateSystemKey({ text_all: ['('] }), /invalid pattern/);
  assert.throws(() => validateSystemKey({ text_any: 'd6' }), /text_any must be a list/);
  assert.throws(() => validateSystemKey({ fight: { conditions: ['slow'] } }), /fight.combatant must be a name/);
  assert.throws(() => validateSystemKey({ documents_unchanged: 'yes' }), /documents_unchanged/);
  const ok = validateSystemKey({});
  assert.deepEqual(ok.text_all, []);
  assert.deepEqual(ok.text_none, []);
});

// ---------------------------------------------------------------- setup

test('setup-only builds a copy with one saved version and the adapter, and opens the live session when asked', () => {
  for (const name of NAMES) {
    const out = spawnSync('node', [RUNNER, path.join(CASES, name), '--setup-only'], { encoding: 'utf8' });
    assert.equal(out.status, 0, `${name}: exit code, ${out.stderr}`);
    const line = JSON.parse(out.stdout.trim().split('\n').pop());
    assert.equal(line.case, `system-${name}`);
    assert.equal(line.versions, 1, `${name}: one saved version`);
    assert.equal(line.adapter, 'fabula-ultima', `${name}: adapter`);
    assert.equal(line.live_session_open, name === 'fu-tracker-statuses', `${name}: live session`);
  }
});

test('a copy from setup has one saved version and no fight state yet', () => {
  withCopy('fu-tracker-statuses', (setup) => {
    assert.equal(listVersions(setup.copy, { limit: 500 }).length, 1);
    assert.equal(fightState(setup.copy), null);
  });
});

// ---------------------------------------------------------------- rules and wording

test('fu-rules-v11: the reference answer passes and the tutorial answer fails', () => {
  withCopy('fu-rules-v11', (setup, caseData) => {
    const good = 'Studying an enemy gives more information at DL 7, DL 10 and DL 13. A Tonic cures all status effects, not only one.';
    const passed = gradeSystemRun({ key: caseData.key, snap: snapshotSystem(setup.copy, setup, good), baseline: setup.tree });
    assert.equal(passed.pass, true, passed.failures.join('; '));
    for (const id of ['X1', 'X2', 'X3', 'X4', 'X6']) assert.equal(passed.checks[id], true, id);

    const tutorial = 'Study gives more with DL 10, 13 and 16. A Tonic cures one status only.';
    const failed = gradeSystemRun({ key: caseData.key, snap: snapshotSystem(setup.copy, setup, tutorial), baseline: setup.tree });
    assert.equal(failed.pass, false);
    assert.ok(failed.checks.X1 === false || failed.checks.X3 === false, 'the tutorial values fail X1 or X3');
    assert.equal(failed.checks.X3, false);
  });
});

test('fu-homonym-veil: Kael effect passes and Ysolde effect fails', () => {
  withCopy('fu-homonym-veil', (setup, caseData) => {
    const good = "Kael's Veil: the caster and one ally ignore the next ranged attack this round.";
    assert.equal(gradeSystemRun({ key: caseData.key, snap: snapshotSystem(setup.copy, setup, good), baseline: setup.tree }).pass, true);
    const mixed = "Veil makes one enemy cannot see beyond 5 metres, which is Ysolde's spell.";
    const failed = gradeSystemRun({ key: caseData.key, snap: snapshotSystem(setup.copy, setup, mixed), baseline: setup.tree });
    assert.equal(failed.checks.X3, false);
    assert.equal(failed.checks.X1, false);
  });
});

test('fu-check-flags: the two seeded problems pass and a flagged valid scene fails', () => {
  withCopy('fu-check-flags', (setup, caseData) => {
    const good =
      'Harbor Thug: its hit points are 25, but the minimum for level 5 with MIG d6 is 40, so the hit points are wrong. ' +
      'Session 1, scene Sluice Lift: the check uses DL 12, which is not a valid difficulty.';
    assert.equal(gradeSystemRun({ key: caseData.key, snap: snapshotSystem(setup.copy, setup, good), baseline: setup.tree }).pass, true);
    const noisy = `${good} Also Gull Swarm has an invalid hit point count.`;
    const failed = gradeSystemRun({ key: caseData.key, snap: snapshotSystem(setup.copy, setup, noisy), baseline: setup.tree });
    assert.equal(failed.checks.X3, false);
  });
});

test('X6: a final message with a backtick or a technical word fails', () => {
  withCopy('fu-rules-v11', (setup, caseData) => {
    const bad = 'Use `DL 7`, DL 10 and DL 13. A Tonic cures all status effects.';
    const failed = gradeSystemRun({ key: caseData.key, snap: snapshotSystem(setup.copy, setup, bad), baseline: setup.tree });
    assert.equal(failed.checks.X6, false);
  });
});

test('an agent error fails the run without checks', () => {
  withCopy('fu-rules-v11', (setup, caseData) => {
    const graded = gradeSystemRun({ key: caseData.key, snap: null, baseline: setup.tree, agentError: 'turn 1: timeout' });
    assert.deepEqual(graded.checks, {});
    assert.equal(graded.pass, false);
  });
});

// ---------------------------------------------------------------- fight state

test('fu-tracker-statuses: the fight state written by combat.mjs passes X5 with both conditions', () => {
  withCopy('fu-tracker-statuses', (setup, caseData) => {
    startFight(setup.copy, ['slow', 'enraged']);
    const state = fightState(setup.copy);
    assert.ok(state, 'a fight state file exists');
    assert.equal(state.combat.combatants[0].name, 'The Brine Warden');
    assert.deepEqual(state.combat.combatants[0].conditions.map((c) => c.id), ['slow', 'enraged']);

    const good = gradeSystemRun({ key: caseData.key, snap: snapshotSystem(setup.copy, setup, 'It rolls a d6.'), baseline: setup.tree });
    assert.equal(good.pass, true, good.failures.join('; '));
    assert.equal(good.checks.X1, true);
    assert.equal(good.checks.X3, true);
    assert.equal(good.checks.X5, true);
    assert.equal(good.checks.X4, true);
  });
});

test('fu-tracker-statuses: a fight with only slow fails X5, and no fight at all fails X5', () => {
  withCopy('fu-tracker-statuses', (setup, caseData) => {
    startFight(setup.copy, ['slow']);
    const onlySlow = gradeSystemRun({ key: caseData.key, snap: snapshotSystem(setup.copy, setup, 'It rolls a d6.'), baseline: setup.tree });
    assert.equal(onlySlow.checks.X5, false);
    assert.equal(onlySlow.pass, false);
  });
  withCopy('fu-tracker-statuses', (setup, caseData) => {
    const none = gradeSystemRun({ key: caseData.key, snap: snapshotSystem(setup.copy, setup, 'It rolls a d6.'), baseline: setup.tree });
    assert.equal(none.checks.X5, false);
    assert.match(none.failures.join(' '), /no fight state file/);
  });
});

test('fu-tracker-statuses: the answer d4 fails X3', () => {
  withCopy('fu-tracker-statuses', (setup, caseData) => {
    startFight(setup.copy, ['slow', 'enraged']);
    const wrong = gradeSystemRun({ key: caseData.key, snap: snapshotSystem(setup.copy, setup, 'It rolls a d4 now.'), baseline: setup.tree });
    assert.equal(wrong.checks.X3, false);
    assert.equal(wrong.checks.X1, false);
  });
});

// ---------------------------------------------------------------- documents unchanged

test('X4 fails when a campaign document changed, and passes when only the fight state changed', () => {
  withCopy('fu-tracker-statuses', (setup, caseData) => {
    startFight(setup.copy, ['slow', 'enraged']);
    const fine = gradeSystemRun({ key: caseData.key, snap: snapshotSystem(setup.copy, setup, 'It rolls a d6.'), baseline: setup.tree });
    assert.equal(fine.checks.X4, true);

    const file = path.join(setup.copy, 'Creature', 'Gull Swarm.md');
    fs.writeFileSync(file, `${fs.readFileSync(file, 'utf8')}\nEdited by the test.\n`);
    const changed = gradeSystemRun({ key: caseData.key, snap: snapshotSystem(setup.copy, setup, 'It rolls a d6.'), baseline: setup.tree });
    assert.equal(changed.checks.X4, false);
    assert.equal(changed.pass, false);
  });
});

test('X4 fails when a new campaign file is added', () => {
  withCopy('fu-rules-v11', (setup, caseData) => {
    fs.writeFileSync(path.join(setup.copy, 'Notes.md'), '# Notes\n');
    const graded = gradeSystemRun({
      key: caseData.key,
      snap: snapshotSystem(setup.copy, setup, 'A Tonic cures all status effects, at DL 7, 10 and 13.'),
      baseline: setup.tree,
    });
    assert.equal(graded.checks.X4, false);
  });
});
