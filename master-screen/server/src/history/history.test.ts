import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { createCtx } from '../context.js';
import { loadHistory, cleanSubject, summarize } from './groups.js';
import { diff, isCleanCanon, parseUnifiedDiff, resolveCommit, showFiles } from './git.js';
import { makeRepo, CAMPAIGN_YAML_EN, type TestRepo } from './test-repo.js';

const REAL_FRAMEWORK = fileURLToPath(new URL('../../../../yllir', import.meta.url));

describe('history: groups, diff and association', () => {
  let repo: TestRepo;
  let first: string;
  let second: string;

  beforeEach(() => {
    repo = makeRepo();
    repo.write('campaign.yaml', CAMPAIGN_YAML_EN);
    repo.write('sheets/hero.md', '# Hero\n\nOne\n');
    first = repo.commit('Created the first sheet; version 0.1.0');
    repo.write('sheets/hero.md', '# Hero\n\nTwo\n');
    second = repo.commit('Updated the hero');
    repo.write('.campaign/state/notes.json', '{}\n');
    repo.commit('Saved internal state');
    repo.write('sheets/bad.md', '# Bad\n');
    repo.write('.campaign/state/notes.json', '{"a":1}\n');
    repo.commit('npc-manager 0.6.0');
  });

  afterEach(() => {
    repo.cleanup();
  });

  function ctxFor(root: string) {
    return createCtx({ campaignRoot: root, frameworkRoot: REAL_FRAMEWORK, port: 1, log: () => {} });
  }

  it('lists groups newest first, ignores .campaign-only commits and cleans summaries', async () => {
    const items = await loadHistory(ctxFor(repo.root));
    const groups = items.map((item) => item.group);
    assert.equal(groups.length, 3);
    assert.equal(groups[0].summary, 'Changed 1 document');
    assert.deepEqual(groups[0].files, [{ path: 'sheets/bad.md', status: 'added' }]);
    assert.equal(groups[1].summary, 'Updated the hero');
    assert.equal(groups[2].summary, 'Created the first sheet');
    assert.equal(groups[2].id, first);
    assert.equal(groups[1].id, second);
    assert.ok(groups.every((g) => g.files.every((f) => !f.path.startsWith('.campaign/'))));
    assert.ok(groups.every((g) => !/[0-9a-f]{7,}/.test(g.summary)));
    assert.ok(groups.every((g) => g.undone === false && g.isUndo === false));
  });

  it('detects renames with their origin', async () => {
    repo.git('mv', 'sheets/hero.md', 'sheets/hero-final.md');
    const sha = repo.commit('Renamed the hero sheet');
    const files = await showFiles(repo.root, sha);
    assert.deepEqual(files, [{ path: 'sheets/hero-final.md', status: 'renamed', from: 'sheets/hero.md' }]);
    const items = await loadHistory(ctxFor(repo.root));
    assert.deepEqual(items[0].group.files, [{ path: 'sheets/hero-final.md', status: 'renamed', from: 'sheets/hero.md' }]);
  });

  it('parses add, delete, modify, rename with change and binary in one diff', async () => {
    repo.write('sheets/keep.md', 'one\ntwo\n');
    repo.write('sheets/gone.md', 'bye\n');
    repo.write('sheets/old.md', 'alpha\nbeta\ngamma\ndelta\n');
    repo.commit('Setup for the diff');

    repo.write('sheets/added.md', 'fresh\n');
    repo.remove('sheets/gone.md');
    repo.write('sheets/keep.md', 'one\n2\n');
    repo.remove('sheets/old.md');
    repo.write('sheets/new-name.md', 'alpha\nbeta\nGAMMA\ndelta\n');
    repo.write('assets/map.bin', '\u0000\u0001\u0002ÿ');
    const sha = repo.commit('Mixed changes');

    const files = await diff(repo.root, sha);
    const byPath = new Map(files.map((f) => [f.path, f]));
    assert.equal(files.length, 5);

    const added = byPath.get('sheets/added.md');
    assert.equal(added?.status, 'added');
    assert.ok(added?.hunks[0].header.startsWith('@@'));
    assert.deepEqual(added?.hunks[0].lines, [{ kind: 'add', text: 'fresh' }]);

    const gone = byPath.get('sheets/gone.md');
    assert.equal(gone?.status, 'deleted');
    assert.deepEqual(gone?.hunks[0].lines, [{ kind: 'del', text: 'bye' }]);

    const keep = byPath.get('sheets/keep.md');
    assert.equal(keep?.status, 'modified');
    assert.deepEqual(keep?.hunks[0].lines.map((l) => l.kind), ['ctx', 'del', 'add']);
    assert.deepEqual(keep?.hunks[0].lines.filter((l) => l.kind !== 'ctx'), [
      { kind: 'del', text: 'two' },
      { kind: 'add', text: '2' },
    ]);

    const renamed = byPath.get('sheets/new-name.md');
    assert.equal(renamed?.status, 'renamed');
    assert.deepEqual(renamed?.hunks[0].lines.filter((l) => l.kind !== 'ctx'), [
      { kind: 'del', text: 'gamma' },
      { kind: 'add', text: 'GAMMA' },
    ]);

    const binary = byPath.get('assets/map.bin');
    assert.equal(binary?.status, 'added');
    assert.deepEqual(binary?.hunks, []);
  });

  it('parses a pure rename and drops .campaign paths from a diff', () => {
    const text = [
      'diff --git a/.campaign/x.json b/.campaign/x.json',
      'index 1..2 100644',
      '--- a/.campaign/x.json',
      '+++ b/.campaign/x.json',
      '@@ -1 +1 @@',
      '-a',
      '+b',
      'diff --git a/old.md b/new.md',
      'similarity index 100%',
      'rename from old.md',
      'rename to new.md',
    ].join('\n');
    const files = parseUnifiedDiff(text);
    assert.deepEqual(files, [{ path: 'new.md', status: 'renamed', hunks: [] }]);
  });

  it('resolves a commit and reports an unknown id as missing', async () => {
    assert.equal(await resolveCommit(repo.root, second.slice(0, 7)), second);
    assert.equal(await resolveCommit(repo.root, 'deadbee'), null);
  });

  it('uses the campaign language for the fallback summary', () => {
    assert.equal(summarize('npc-manager 0.6.0', false, 2, 'en'), 'Changed 2 documents');
    assert.equal(summarize('npc-manager 0.6.0', false, 1, 'it'), 'Modificato 1 documento');
    assert.equal(summarize('Undo: Updated the hero; version 0.2.0', true, 1, 'en'), 'Undone: Updated the hero');
    assert.equal(cleanSubject('0.6.0 - linker and dependency update'), 'linker and dependency update');
  });

  it('reports a dirty tree only for canon files', async () => {
    assert.equal(await isCleanCanon(repo.root), true);
    repo.write('.campaign/state/draft.json', '{}');
    assert.equal(await isCleanCanon(repo.root), true);
    repo.write('sheets/unsaved.md', 'x');
    assert.equal(await isCleanCanon(repo.root), false);
  });

  it('attaches a chat message to the groups of its turn range only', async () => {
    const stateDir = path.join(repo.root, '.campaign', 'state', 'master-screen');
    const before = await loadHistory(ctxFor(repo.root));
    assert.equal(before.find((i) => i.group.id === second)?.group.chatMessageId, undefined);

    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(
      path.join(stateDir, 'turns.json'),
      JSON.stringify([{ messageId: 'msg-1', fromSha: first, toSha: second }]),
    );
    const after = await loadHistory(ctxFor(repo.root));
    assert.equal(after.find((i) => i.group.id === second)?.group.chatMessageId, 'msg-1');
    assert.equal(after.find((i) => i.group.id === first)?.group.chatMessageId, undefined);
  });
});
