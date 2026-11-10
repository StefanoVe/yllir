import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatCheck, sessionCheck } from './session-check.mjs';
import { generateInstructions } from './instructions.mjs';
import { ensureRepo, saveVersion } from './versions.mjs';
import { newTopic } from './topics.mjs';

// Git identity and config must come from the test only.
process.env.GIT_CONFIG_GLOBAL = '/dev/null';
process.env.GIT_CONFIG_NOSYSTEM = '1';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(here, '../session-start.mjs');
const PLUGIN_JSON = path.resolve(here, '../../.claude-plugin/plugin.json');
const FRAMEWORK_VERSION = JSON.parse(fs.readFileSync(PLUGIN_JSON, 'utf8')).version;

const tempDirs = [];
after(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-session-'));
  tempDirs.push(dir);
  return dir;
}

function write(dir, file, text) {
  const full = path.join(dir, file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, text);
}

const VALID_CONFIG = [
  'schema: 1',
  '',
  'campaign:',
  '  name: "Le ceneri della valle"',
  '  slug: ceneri-della-valle',
  '  created: 2026-11-07',
  '',
  'language:',
  '  main: it',
  '  other: []',
  '',
  'prose:',
  '  register: plain',
  '',
  'system:',
  '  adapter: none',
  '',
  'structure:',
  '  - id: trama',
  '    folder: Trama',
  '    type: plot',
  '',
].join('\n');

const INVALID_CONFIG = 'schema: 1\nlanguage:\n  main: it\n';

/**
 * Campaign folder with a valid config, generated instructions and one world
 * card, no git. The card keeps it from counting as unfinished.
 */
function campaign(config = VALID_CONFIG) {
  const root = tempDir();
  write(root, 'campaign.yaml', config);
  write(root, 'Trama/Scena di apertura.md', '# Scena di apertura\n');
  generateInstructions(root);
  return root;
}

/** Same as campaign(), made a git repo with one saved version. */
function savedCampaign() {
  const root = campaign();
  ensureRepo(root);
  saveVersion(root, { message: 'Creata la campagna «Le ceneri della valle»', kind: 'framework' });
  return root;
}

describe('folder detection', () => {
  test('a folder with only dot entries is empty', () => {
    const root = tempDir();
    write(root, '.gitkeep', '');
    write(root, '.claude/settings.json', '{}');
    assert.equal(sessionCheck(root).folder, 'empty');
  });

  test('a completely empty folder is empty', () => {
    assert.equal(sessionCheck(tempDir()).folder, 'empty');
  });

  test('a folder with a visible file is other', () => {
    const root = tempDir();
    write(root, 'notes.txt', 'appunti');
    const result = sessionCheck(root);
    assert.equal(result.folder, 'other');
    assert.equal(result.versions, null);
    assert.equal(result.unsaved, null);
    assert.equal(result.settings, null);
    assert.equal(result.instructions, null);
    assert.equal(result.campaign_framework_version, null);
    assert.equal(result.topics, null);
  });

  test('a nonexistent root is other and does not throw', () => {
    const missing = path.join(tempDir(), 'missing');
    const result = sessionCheck(missing);
    assert.equal(result.folder, 'other');
    assert.equal(result.root, path.resolve(missing));
    assert.equal(result.framework_version, FRAMEWORK_VERSION);
  });

  test('the root is the real path of the campaign folder', () => {
    const root = campaign();
    assert.equal(sessionCheck(root).root, fs.realpathSync(root));
  });
});

describe('campaign checks', () => {
  test('a campaign without a git repository counts all its files as unsaved', () => {
    const root = campaign();
    const result = sessionCheck(root);
    assert.equal(result.folder, 'campaign');
    assert.deepEqual(result.versions, { count: 0, last: null });
    // Scena di apertura.md, campaign.yaml, CLAUDE.md, AGENTS.md, agent.md, customizations.md, version.yaml, settings.json
    assert.equal(result.unsaved, 8);
    assert.equal(result.settings.ok, true);
    assert.equal(result.instructions, 'up-to-date');
    assert.equal(result.campaign_framework_version, FRAMEWORK_VERSION);
    assert.deepEqual(result.topics, { active: null, open: 0 });
  });

  test('a saved campaign reports one version, nothing unsaved and up-to-date instructions', () => {
    const root = savedCampaign();
    const result = sessionCheck(root);
    assert.equal(result.versions.count, 1);
    assert.equal(result.versions.last.message, 'Creata la campagna «Le ceneri della valle»');
    assert.match(result.versions.last.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(result.unsaved, 0);
    assert.deepEqual(result.settings, { ok: true, codes: [] });
    assert.equal(result.instructions, 'up-to-date');
  });

  test('a pending post-update conversion is reported even when framework versions match', () => {
    const root = campaign();
    write(root, '.campaign/state/update.yaml', [
      'status: completed',
      'sheet_migration: pending',
      'sheet_pending:',
      '  - Creature/Guardiano.md',
      '',
    ].join('\n'));

    const result = sessionCheck(root);
    assert.equal(result.framework_version, FRAMEWORK_VERSION);
    assert.equal(result.campaign_framework_version, FRAMEWORK_VERSION);
    assert.equal(result.post_update, 'needed');
    assert.match(formatCheck(result), /^post-update: needed$/m);
  });

  test('a completed post-update conversion is not reported', () => {
    const root = campaign();
    write(root, '.campaign/state/update.yaml', 'status: completed\nsheet_migration: complete\n');
    const result = sessionCheck(root);
    assert.equal(result.post_update, null);
    assert.doesNotMatch(formatCheck(result), /^post-update:/m);
  });

  test('a hand edit of CLAUDE.md is reported as changed by hand and as unsaved', () => {
    const root = savedCampaign();
    fs.appendFileSync(path.join(root, 'CLAUDE.md'), 'mia nota\n');
    const result = sessionCheck(root);
    assert.deepEqual(result.instructions, { changed: ['CLAUDE.md'] });
    assert.equal(result.unsaved, 1);
    assert.match(formatCheck(result), /^instructions: changed by hand: CLAUDE\.md$/m);
  });

  test('an invalid campaign.yaml is reported with its error codes', () => {
    const root = campaign(INVALID_CONFIG);
    const result = sessionCheck(root);
    assert.equal(result.settings.ok, false);
    assert.ok(result.settings.codes.length > 0);
    assert.match(formatCheck(result), /^settings: problems: \S/m);
  });

  test('a campaign without instructions reports them as missing', () => {
    const root = tempDir();
    write(root, 'campaign.yaml', VALID_CONFIG);
    write(root, 'Trama/Scena di apertura.md', '# Scena di apertura\n');
    assert.equal(sessionCheck(root).instructions, 'missing');
  });

  test('a missing git executable gives git missing and null version data', () => {
    const root = savedCampaign();
    const saved = process.env.PATH;
    process.env.PATH = path.join(tempDir(), 'no-bin');
    try {
      const result = sessionCheck(root);
      assert.equal(result.git, 'missing');
      assert.equal(result.versions, null);
      assert.equal(result.unsaved, null);
      assert.equal(result.settings.ok, true);
    } finally {
      process.env.PATH = saved;
    }
  });
});

describe('unfinished campaigns', () => {
  test('campaign.yaml only, no git repository, is unfinished', () => {
    const root = tempDir();
    write(root, 'campaign.yaml', VALID_CONFIG);
    const result = sessionCheck(root);
    assert.equal(result.folder, 'unfinished');
    assert.equal(result.versions, null);
    assert.equal(result.settings, null);
    assert.equal(result.instructions, null);
    assert.match(formatCheck(result), /^folder: unfinished$/m);
  });

  test('campaign.yaml in a git repository with one saved version is a campaign', () => {
    const root = tempDir();
    write(root, 'campaign.yaml', VALID_CONFIG);
    ensureRepo(root);
    saveVersion(root, { message: 'Creata la campagna', kind: 'framework' });
    assert.equal(sessionCheck(root).folder, 'campaign');
  });

  test('campaign.yaml with a world card and no commits is a campaign', () => {
    const root = tempDir();
    write(root, 'campaign.yaml', VALID_CONFIG);
    write(root, 'Mondo/X.md', '# X\n');
    assert.equal(sessionCheck(root).folder, 'campaign');
  });

  test('campaign.yaml with only CLAUDE.md is unfinished', () => {
    const root = tempDir();
    write(root, 'campaign.yaml', VALID_CONFIG);
    write(root, 'CLAUDE.md', '# istruzioni\n');
    assert.equal(sessionCheck(root).folder, 'unfinished');
  });
});

describe('topics', () => {
  test('an active topic and a paused one are reported with the resume file and the open count', () => {
    const root = campaign();
    newTopic(root, { process: 'ricerca', goal: 'Il mercato delle ceneri', now: new Date('2026-11-07T10:00:00Z') });
    newTopic(root, { process: 'scena', goal: 'Il porto di Morvalle', now: new Date('2026-11-06T10:00:00Z') });
    const result = sessionCheck(root);
    assert.equal(result.topics.active.goal, 'Il porto di Morvalle');
    assert.equal(result.topics.open, 2);
    assert.equal(
      formatCheck(result),
      [
        'YLLIR SESSION CHECK (for the assistant, not for the master)',
        `campaign root: ${fs.realpathSync(root)}`,
        'folder: campaign',
        'git: ok',
        'saved versions: 0',
        'changes not yet saved: 8 files',
        'settings: valid',
        'instructions: up to date',
        'framework version: ' + FRAMEWORK_VERSION + ' (campaign made with ' + FRAMEWORK_VERSION + ')',
        `active topic: ${result.topics.active.id} (scena) — Il porto di Morvalle`,
        `resume from: .campaign/state/topics/${result.topics.active.id}.md`,
        'open topics: 2',
        'next: invoke the skill yllir:yllir before answering the master.',
      ].join('\n'),
    );
  });
});

describe('formatCheck', () => {
  test('prints the exact layout for a full campaign', () => {
    const text = formatCheck({
      root: '/campagne/le-isole-dambra',
      folder: 'campaign',
      git: 'ok',
      versions: { count: 3, last: { message: 'Creata la campagna «Le isole d\'ambra»', date: '2026-11-07' } },
      unsaved: 0,
      settings: { ok: true, codes: [] },
      instructions: 'up-to-date',
      framework_version: '0.1.0',
      campaign_framework_version: '0.1.0',
      topics: null,
    });
    assert.equal(
      text,
      [
        'YLLIR SESSION CHECK (for the assistant, not for the master)',
        'campaign root: /campagne/le-isole-dambra',
        'folder: campaign',
        'git: ok',
        'saved versions: 3 (last: "Creata la campagna «Le isole d\'ambra»" on 2026-11-07)',
        'changes not yet saved: 0 files',
        'settings: valid',
        'instructions: up to date',
        'framework version: 0.1.0 (campaign made with 0.1.0)',
        'next: invoke the skill yllir:yllir before answering the master.',
      ].join('\n'),
    );
  });

  test('omits null lines and prints problems, zero versions and changed files', () => {
    const text = formatCheck({
      root: '/tmp/cartella',
      folder: 'other',
      git: 'missing',
      versions: { count: 0, last: null },
      unsaved: null,
      settings: { ok: false, codes: ['yaml', 'missing-key'] },
      instructions: { changed: ['CLAUDE.md', '.campaign/instructions/agent.md'] },
      framework_version: '0.1.0',
      campaign_framework_version: null,
      topics: null,
    });
    assert.equal(
      text,
      [
        'YLLIR SESSION CHECK (for the assistant, not for the master)',
        'campaign root: /tmp/cartella',
        'folder: other',
        'git: missing',
        'saved versions: 0',
        'settings: problems: yaml, missing-key',
        'instructions: changed by hand: CLAUDE.md, .campaign/instructions/agent.md',
        'framework version: 0.1.0',
        'next: invoke the skill yllir:yllir before answering the master.',
      ].join('\n'),
    );
  });

  test('a different campaign version adds the alignment line right after the version line', () => {
    const text = formatCheck({
      root: '/campagne/le-isole-dambra',
      folder: 'campaign',
      git: 'ok',
      versions: null,
      unsaved: null,
      settings: null,
      instructions: 'up-to-date',
      framework_version: '0.2.0',
      campaign_framework_version: '0.1.0',
      topics: null,
    });
    assert.match(text, /^framework version: 0\.2\.0 \(campaign made with 0\.1\.0\)\ncampaign alignment: needed\nnext: /m);
  });

  test('equal campaign and framework versions add no alignment line', () => {
    const text = formatCheck({
      root: '/campagne/le-isole-dambra',
      folder: 'campaign',
      git: 'ok',
      versions: null,
      unsaved: null,
      settings: null,
      instructions: 'up-to-date',
      framework_version: '0.2.0',
      campaign_framework_version: '0.2.0',
      topics: null,
    });
    assert.doesNotMatch(text, /campaign alignment/);
  });

  test('a pending post-update conversion is printed independently of version alignment', () => {
    const text = formatCheck({
      root: '/campagne/le-isole-dambra',
      folder: 'campaign',
      git: 'ok',
      versions: null,
      unsaved: null,
      settings: null,
      instructions: 'up-to-date',
      framework_version: '0.2.0',
      campaign_framework_version: '0.2.0',
      post_update: 'needed',
      topics: null,
    });
    assert.match(text, /^post-update: needed$/m);
    assert.doesNotMatch(text, /campaign alignment/);
  });

  test('a null campaign version adds no alignment line', () => {
    const text = formatCheck({
      root: '/campagne/le-isole-dambra',
      folder: 'campaign',
      git: 'ok',
      versions: null,
      unsaved: null,
      settings: null,
      instructions: 'up-to-date',
      framework_version: '0.2.0',
      campaign_framework_version: null,
      topics: null,
    });
    assert.doesNotMatch(text, /campaign alignment/);
  });

  test('prints instructions missing', () => {
    const text = formatCheck({
      root: '/tmp/campagna',
      folder: 'campaign',
      git: 'ok',
      versions: null,
      unsaved: null,
      settings: null,
      instructions: 'missing',
      framework_version: null,
      campaign_framework_version: null,
      topics: null,
    });
    assert.match(text, /^instructions: missing$/m);
    assert.match(text, /\nnext: invoke the skill yllir:yllir before answering the master\.$/);
  });
});

describe('session-start CLI', () => {
  test('exits 0 and prints the check for a nonexistent root', () => {
    const output = execFileSync(process.execPath, [CLI, path.join(tempDir(), 'missing')], {
      encoding: 'utf8',
    });
    assert.match(output, /^YLLIR SESSION CHECK \(for the assistant, not for the master\)$/m);
    assert.match(output, /^folder: other$/m);
  });

  test('--json prints the result object', () => {
    const root = savedCampaign();
    const output = execFileSync(process.execPath, [CLI, root, '--json'], { encoding: 'utf8' });
    const parsed = JSON.parse(output);
    assert.equal(parsed.folder, 'campaign');
    assert.equal(parsed.versions.count, 1);
  });

  test('does not write anything into the campaign', () => {
    const root = savedCampaign();
    const before = listFiles(root);
    execFileSync(process.execPath, [CLI, root], { encoding: 'utf8' });
    assert.deepEqual(listFiles(root), before);
  });
});

describe('update notice', () => {
  /** Published plugin folder with one news file for the given version. */
  function publishedSource(version, news) {
    const dir = tempDir();
    write(dir, '.claude-plugin/plugin.json', JSON.stringify({ name: 'yllir', version }));
    for (const [file, text] of Object.entries(news)) {
      write(dir, `news/${file}`, text);
    }
    return dir;
  }

  /** Runs fn with YLLIR_PUBLISHED_SOURCE set to value (undefined removes it). */
  function withPublishedSource(value, fn) {
    const saved = process.env.YLLIR_PUBLISHED_SOURCE;
    if (value === undefined) {
      delete process.env.YLLIR_PUBLISHED_SOURCE;
    } else {
      process.env.YLLIR_PUBLISHED_SOURCE = value;
    }
    try {
      return fn();
    } finally {
      if (saved === undefined) {
        delete process.env.YLLIR_PUBLISHED_SOURCE;
      } else {
        process.env.YLLIR_PUBLISHED_SOURCE = saved;
      }
    }
  }

  test('without YLLIR_PUBLISHED_SOURCE the update field is null and the output ends at the next step', () => {
    withPublishedSource(undefined, () => {
      const root = campaign();
      const result = sessionCheck(root);
      assert.equal(result.update, null);
      const text = formatCheck(result);
      assert.doesNotMatch(text, /YLLIR UPDATE AVAILABLE/);
      assert.ok(text.endsWith('\nnext: invoke the skill yllir:yllir before answering the master.'));
    });
  });

  test('a newer published version adds the update block after the next step, with a blank line', () => {
    const source = publishedSource('9.9.9', { '9.9.9.it.md': 'Nuove regole per i dadi.' });
    withPublishedSource(source, () => {
      const root = campaign();
      const result = sessionCheck(root);
      assert.deepEqual(result.update, { installed: FRAMEWORK_VERSION, published: '9.9.9', news: 'Nuove regole per i dadi.' });
      const text = formatCheck(result);
      assert.ok(
        text.endsWith(
          [
            '',
            'next: invoke the skill yllir:yllir before answering the master.',
            '',
            'YLLIR UPDATE AVAILABLE (for the assistant, not for the master)',
            `installed: ${FRAMEWORK_VERSION}`,
            'published: 9.9.9',
            'news for the master:',
            '  Nuove regole per i dadi.',
            "next: after answering the master's first request, tell the master in plain words, with no technical terms, " +
              'that a newer version exists and what it changes (use the news), and ask whether to update now. ' +
              'The master decides. Do not update without a yes. Right after telling the master, run the update script with --postpone once, so the notice is not repeated until tomorrow.',
          ].join('\n'),
        ),
      );
    });
  });

  test('sessionCheck does not write the notice memory', () => {
    const source = publishedSource('9.9.9', { '9.9.9.it.md': 'news' });
    withPublishedSource(source, () => {
      const root = campaign();
      const before = listFiles(root);
      sessionCheck(root);
      assert.deepEqual(listFiles(root), before);
      assert.equal(fs.existsSync(path.join(root, '.campaign', 'state')), false);
    });
  });
});

function listFiles(dir) {
  const out = [];
  const walk = (current, rel) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const relPath = rel === '' ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(path.join(current, entry.name), relPath);
      } else {
        out.push(`${relPath}:${fs.readFileSync(path.join(current, entry.name), 'utf8').length}`);
      }
    }
  };
  walk(dir, '');
  return out.sort();
}
