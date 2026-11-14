import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { alignNeeded, alignScriptPath, runAlignCheck } from './align-check.js';

const roots: string[] = [];
after(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

/** A framework folder whose update script prints the JSON in answer.json, and fails when not called with --dry-run. */
function fakeFramework(): { framework: string; campaign: string; answer(result: unknown, code?: number): void } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-align-check-'));
  roots.push(root);
  const framework = path.join(root, 'yllir');
  const campaign = path.join(root, 'campaign');
  fs.mkdirSync(path.dirname(alignScriptPath(framework)), { recursive: true });
  fs.mkdirSync(campaign, { recursive: true });
  const answerFile = path.join(root, 'answer.json');
  fs.writeFileSync(
    alignScriptPath(framework),
    [
      "import fs from 'node:fs';",
      `const cfg = JSON.parse(fs.readFileSync(${JSON.stringify(answerFile)}, 'utf8'));`,
      "const dry = process.argv[3] === '--dry-run';",
      "const result = dry ? cfg.result : { status: 'failed', errors: [{ code: 'bad-args', message: 'not a dry run' }] };",
      "process.stdout.write(JSON.stringify(result, null, 2) + '\\n');",
      "process.stdout.write(`exit: ${result.status === 'failed' ? 1 : 0}\\n`);",
    ].join('\n'),
  );
  return {
    framework,
    campaign,
    answer(result, code = 0) {
      fs.writeFileSync(answerFile, JSON.stringify({ result, code }));
    },
  };
}

describe('alignNeeded', () => {
  it('needs the alignment when the campaign would be updated, or an earlier update was interrupted', () => {
    assert.equal(alignNeeded({ status: 'would-update', from: '0.1.0', to: '0.2.0', errors: [], pending_migrations: [] }), true);
    assert.equal(alignNeeded({ status: 'failed', errors: [{ code: 'interrupted-update' }] }), true);
  });

  it('does not need it for a would-update with equal versions, only hand-edited files and no migration', () => {
    const result = {
      status: 'would-update',
      from: '0.2.0',
      to: '0.2.0',
      restored_by_hand: ['CLAUDE.md'],
      migrations: { x: 'not-needed' },
      pending_migrations: [],
    };
    assert.equal(alignNeeded(result), false);
  });

  it('does not need it for equal versions when a migration is needed by content only (drift)', () => {
    const result = {
      status: 'would-update',
      from: '0.2.0',
      to: '0.2.0',
      restored_by_hand: [],
      migrations: { x: 'complete' },
      pending_migrations: [],
      saved_pending: [],
    };
    assert.equal(alignNeeded(result), false);
  });

  it('needs it for equal versions when a migration is saved as pending', () => {
    const result = {
      status: 'would-update',
      from: '0.2.0',
      to: '0.2.0',
      restored_by_hand: [],
      migrations: { x: 'pending' },
      pending_migrations: ['x'],
      saved_pending: ['x'],
    };
    assert.equal(alignNeeded(result), true);
  });

  it('needs it for a would-update whose versions differ, or whose version is unknown', () => {
    assert.equal(alignNeeded({ status: 'would-update', from: '0.1.0', to: '0.2.0', migrations: { x: 'not-needed' }, pending_migrations: [], saved_pending: [] }), true);
    assert.equal(alignNeeded({ status: 'would-update', from: null, to: '0.2.0', pending_migrations: [], saved_pending: [] }), true);
  });

  it('does not need it for equal versions when the dry run pends a migration but nothing is saved as pending', () => {
    const result = {
      status: 'up-to-date',
      from: '0.2.0',
      to: '0.2.0',
      errors: [],
      pending_migrations: ['item-descriptions-v1'],
      saved_pending: [],
    };
    assert.equal(alignNeeded(result), false);
    assert.equal(alignNeeded({ ...result, status: 'would-update' }), false);
  });

  it('needs the alignment when a migration saved as pending is still open, even when up to date', () => {
    assert.equal(alignNeeded({ status: 'up-to-date', errors: [], pending_migrations: ['statistics-tables-v1'], saved_pending: ['statistics-tables-v1'] }), true);
  });

  it('does not need it when up to date with nothing pending, or when another failure happened', () => {
    assert.equal(alignNeeded({ status: 'up-to-date', errors: [], pending_migrations: [] }), false);
    assert.equal(alignNeeded({ status: 'failed', errors: [{ code: 'no-repo' }], pending_migrations: [] }), false);
    assert.equal(alignNeeded({ status: 'up-to-date' }), false);
  });

  it('throws when the result is not an object', () => {
    assert.throws(() => alignNeeded(null), /no object/);
  });
});

describe('runAlignCheck', () => {
  it('runs the dry run of the framework script and reads its result', async () => {
    const fake = fakeFramework();
    fake.answer({ status: 'would-update', errors: [], pending_migrations: [] });
    assert.equal(await runAlignCheck(fake.campaign, fake.framework), true);
    fake.answer({ status: 'up-to-date', errors: [], pending_migrations: [] });
    assert.equal(await runAlignCheck(fake.campaign, fake.framework), false);
  });

  it('rejects when the script prints no result', async () => {
    const fake = fakeFramework();
    fs.writeFileSync(alignScriptPath(fake.framework), 'process.exit(2);\n');
    await assert.rejects(runAlignCheck(fake.campaign, fake.framework), /printed no result/);
  });
});
