import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkUpdate, compareVersions, formatUpdateNotice, recordNotice } from './update-check.mjs';
import { parseYamlLite } from './yaml-lite.mjs';

const PLUGIN_JSON = path.resolve(import.meta.dirname, '../../.claude-plugin/plugin.json');
const FRAMEWORK_VERSION = JSON.parse(fs.readFileSync(PLUGIN_JSON, 'utf8')).version;
const TODAY = '2026-11-09';
const NEXT_STEP =
  "next: after answering the master's first request, tell the master in plain words, with no technical terms, " +
  'that a newer version exists and what it changes (use the news), and ask whether to update now. ' +
  'The master decides. Do not update without a yes. Right after telling the master, run the update script with --postpone once, so the notice is not repeated until tomorrow.';

const tempDirs = [];
after(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-update-'));
  tempDirs.push(dir);
  return dir;
}

function write(dir, file, text) {
  const full = path.join(dir, file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, text);
}

/** A published plugin folder: plugin.json plus news files keyed by their path under news/. */
function publishedSource(version, news = {}) {
  const dir = tempDir();
  write(dir, '.claude-plugin/plugin.json', JSON.stringify({ name: 'yllir', version }));
  for (const [file, text] of Object.entries(news)) {
    write(dir, `news/${file}`, text);
  }
  return dir;
}

/** Campaign folder with an optional notice memory file. */
function campaignWithMemory(memoryText) {
  const root = tempDir();
  if (memoryText !== undefined) {
    write(root, '.campaign/state/update-notice.yaml', memoryText);
  }
  return root;
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

function listFiles(dir) {
  const out = [];
  const walk = (current, rel) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const relPath = rel === '' ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(path.join(current, entry.name), relPath);
      } else {
        out.push(relPath);
      }
    }
  };
  walk(dir, '');
  return out.sort();
}

describe('compareVersions', () => {
  test('equal versions compare as 0', () => {
    assert.equal(compareVersions('1.2.3', '1.2.3'), 0);
  });

  test('a higher major, minor or patch compares as 1 and the reverse as -1', () => {
    assert.equal(compareVersions('2.0.0', '1.9.9'), 1);
    assert.equal(compareVersions('1.2.0', '1.3.0'), -1);
    assert.equal(compareVersions('1.2.4', '1.2.3'), 1);
    assert.equal(compareVersions('1.2.3', '1.2.4'), -1);
  });

  test('numbers are compared as numbers, not as text', () => {
    assert.equal(compareVersions('1.10.0', '1.9.0'), 1);
  });

  test('strings that are not strictly MAJOR.MINOR.PATCH give null', () => {
    assert.equal(compareVersions('1.2', '1.2.0'), null);
    assert.equal(compareVersions('v1.2.0', '1.2.0'), null);
    assert.equal(compareVersions('1.2.0-beta', '1.2.0'), null);
    assert.equal(compareVersions('01.2.0', '1.2.0'), null);
    assert.equal(compareVersions('1.2.0', ' 1.2.0'), null);
    assert.equal(compareVersions('1.2.0', null), null);
    assert.equal(compareVersions(undefined, '1.2.0'), null);
  });
});

describe('checkUpdate', () => {
  test('without a source folder there is nothing to show', () => {
    const root = campaignWithMemory();
    withPublishedSource(undefined, () => {
      assert.equal(checkUpdate(root, { installed: '1.0.0', today: TODAY }), null);
    });
    assert.equal(checkUpdate(root, { sourceDir: '', installed: '1.0.0', today: TODAY }), null);
  });

  test('a source folder that does not exist gives no notice and does not throw', () => {
    const root = campaignWithMemory();
    const missing = path.join(tempDir(), 'missing');
    assert.equal(checkUpdate(root, { sourceDir: missing, installed: '1.0.0', today: TODAY }), null);
  });

  test('a source path that is a file gives no notice', () => {
    const root = campaignWithMemory();
    const file = path.join(tempDir(), 'file.txt');
    fs.writeFileSync(file, 'non una cartella');
    assert.equal(checkUpdate(root, { sourceDir: file, installed: '1.0.0', today: TODAY }), null);
  });

  test('a published plugin.json that is invalid gives no notice', () => {
    const root = campaignWithMemory();
    const source = tempDir();
    write(source, '.claude-plugin/plugin.json', '{ non json');
    assert.equal(checkUpdate(root, { sourceDir: source, installed: '1.0.0', today: TODAY }), null);
  });

  test('a published version equal to the installed one gives no notice', () => {
    const root = campaignWithMemory();
    const source = publishedSource('1.0.0');
    assert.equal(checkUpdate(root, { sourceDir: source, installed: '1.0.0', today: TODAY }), null);
  });

  test('a published version older than the installed one gives no notice', () => {
    const root = campaignWithMemory();
    const source = publishedSource('0.9.0');
    assert.equal(checkUpdate(root, { sourceDir: source, installed: '1.0.0', today: TODAY }), null);
  });

  test('a newer published version with no memory gives the notice with its news', () => {
    const root = campaignWithMemory();
    const source = publishedSource('1.1.0', { '1.1.0.md': 'Nuove regole per i dadi.\n' });
    assert.deepEqual(checkUpdate(root, { sourceDir: source, installed: '1.0.0', today: TODAY, language: 'it' }), {
      installed: '1.0.0',
      published: '1.1.0',
      news: 'Nuove regole per i dadi.',
    });
  });

  test('the installed version defaults to plugin.json', () => {
    const root = campaignWithMemory();
    const source = publishedSource('99.0.0');
    const result = checkUpdate(root, { sourceDir: source, today: TODAY, language: 'it' });
    assert.equal(result.installed, FRAMEWORK_VERSION);
    assert.equal(result.published, '99.0.0');
  });

  test('the language variant of the news is preferred when it exists', () => {
    const root = campaignWithMemory();
    const source = publishedSource('1.1.0', {
      '1.1.0.md': 'English news',
      '1.1.0.it.md': 'Notizie in italiano',
    });
    const italian = checkUpdate(root, { sourceDir: source, installed: '1.0.0', today: TODAY, language: 'it' });
    assert.equal(italian.news, 'Notizie in italiano');
    const german = checkUpdate(root, { sourceDir: source, installed: '1.0.0', today: TODAY, language: 'de' });
    assert.equal(german.news, 'English news');
  });

  test('without a language option the language comes from campaign.yaml', () => {
    const root = campaignWithMemory();
    write(root, 'campaign.yaml', 'schema: 1\n\nlanguage:\n  main: it\n  other: []\n');
    const source = publishedSource('1.1.0', { '1.1.0.md': 'English', '1.1.0.it.md': 'Italiano' });
    assert.equal(checkUpdate(root, { sourceDir: source, installed: '1.0.0', today: TODAY }).news, 'Italiano');
  });

  test('a missing news file gives news null and the notice is still shown', () => {
    const root = campaignWithMemory();
    const source = publishedSource('1.1.0');
    assert.deepEqual(checkUpdate(root, { sourceDir: source, installed: '1.0.0', today: TODAY, language: 'it' }), {
      installed: '1.0.0',
      published: '1.1.0',
      news: null,
    });
  });

  test('news is trimmed and cut to 4000 characters', () => {
    const root = campaignWithMemory();
    const source = publishedSource('1.1.0', { '1.1.0.md': `  ${'a'.repeat(5000)}  \n` });
    const news = checkUpdate(root, { sourceDir: source, installed: '1.0.0', today: TODAY, language: 'it' }).news;
    assert.equal(news.length, 4000);
    assert.equal(news, 'a'.repeat(4000));
  });

  test('a notice already shown today gives null', () => {
    const root = campaignWithMemory(`last_notified_version: "1.1.0"\nlast_notified_on: "${TODAY}"\n`);
    const source = publishedSource('1.1.0', { '1.1.0.md': 'news' });
    assert.equal(checkUpdate(root, { sourceDir: source, installed: '1.0.0', today: TODAY }), null);
  });

  test('a notice shown yesterday is shown again today', () => {
    const root = campaignWithMemory('last_notified_version: "1.1.0"\nlast_notified_on: "2026-11-08"\n');
    const source = publishedSource('1.1.0', { '1.1.0.md': 'news' });
    assert.notEqual(checkUpdate(root, { sourceDir: source, installed: '1.0.0', today: TODAY }), null);
  });

  test('a snooze that ends after today gives null', () => {
    const root = campaignWithMemory('last_notified_on: "2026-11-07"\nsnoozed_until: "2026-11-12"\n');
    const source = publishedSource('1.1.0', { '1.1.0.md': 'news' });
    assert.equal(checkUpdate(root, { sourceDir: source, installed: '1.0.0', today: TODAY }), null);
  });

  test('a snooze that ends today shows the notice', () => {
    const root = campaignWithMemory('last_notified_on: "2026-11-02"\nsnoozed_until: "2026-11-09"\n');
    const source = publishedSource('1.1.0', { '1.1.0.md': 'news' });
    assert.notEqual(checkUpdate(root, { sourceDir: source, installed: '1.0.0', today: TODAY }), null);
  });

  test('a snooze that ended before today shows the notice', () => {
    const root = campaignWithMemory('last_notified_on: "2026-11-01"\nsnoozed_until: "2026-11-05"\n');
    const source = publishedSource('1.1.0', { '1.1.0.md': 'news' });
    assert.notEqual(checkUpdate(root, { sourceDir: source, installed: '1.0.0', today: TODAY }), null);
  });

  test('a corrupt memory file is treated as no memory', () => {
    const root = campaignWithMemory('last_notified_on: [non chiuso\n  - : :\n');
    const source = publishedSource('1.1.0', { '1.1.0.md': 'news' });
    const result = checkUpdate(root, { sourceDir: source, installed: '1.0.0', today: TODAY });
    assert.deepEqual(result, { installed: '1.0.0', published: '1.1.0', news: 'news' });
  });

  test('a memory file that is not a mapping is treated as no memory', () => {
    const root = campaignWithMemory('- uno\n- due\n');
    const source = publishedSource('1.1.0', { '1.1.0.md': 'news' });
    assert.notEqual(checkUpdate(root, { sourceDir: source, installed: '1.0.0', today: TODAY }), null);
  });

  test('recordNotice then checkUpdate on the same day gives null', () => {
    const root = campaignWithMemory();
    const source = publishedSource('1.1.0', { '1.1.0.md': 'news' });
    recordNotice(root, { version: '1.1.0', today: TODAY });
    assert.equal(checkUpdate(root, { sourceDir: source, installed: '1.0.0', today: TODAY }), null);
    assert.notEqual(checkUpdate(root, { sourceDir: source, installed: '1.0.0', today: '2026-11-10' }), null);
  });

  test('checkUpdate only reads: it does not create or change files', () => {
    const root = campaignWithMemory();
    const source = publishedSource('1.1.0', { '1.1.0.md': 'news' });
    const before = listFiles(root);
    checkUpdate(root, { sourceDir: source, installed: '1.0.0', today: TODAY });
    assert.deepEqual(listFiles(root), before);
  });
});

describe('recordNotice', () => {
  test('writes the memory file inside .campaign/state and nothing else', () => {
    const root = campaignWithMemory();
    recordNotice(root, { version: '1.1.0', today: TODAY });
    assert.deepEqual(listFiles(root), ['.campaign/state/update-notice.yaml']);
    const parsed = parseYamlLite(fs.readFileSync(path.join(root, '.campaign/state/update-notice.yaml'), 'utf8'));
    assert.deepEqual(parsed.data, { last_notified_version: '1.1.0', last_notified_on: TODAY });
  });

  test('a snooze writes snoozed_until as today plus the days', () => {
    const root = campaignWithMemory();
    recordNotice(root, { version: '1.1.0', today: TODAY, snoozeDays: 3 });
    const parsed = parseYamlLite(fs.readFileSync(path.join(root, '.campaign/state/update-notice.yaml'), 'utf8'));
    assert.equal(parsed.data.snoozed_until, '2026-11-12');
  });

  test('a snooze across the end of the month is computed as a calendar date', () => {
    const root = campaignWithMemory();
    recordNotice(root, { version: '1.1.0', today: '2026-11-29', snoozeDays: 5 });
    const parsed = parseYamlLite(fs.readFileSync(path.join(root, '.campaign/state/update-notice.yaml'), 'utf8'));
    assert.equal(parsed.data.snoozed_until, '2026-12-04');
  });

  test('a snooze holds the notice back until its date', () => {
    const root = campaignWithMemory();
    const source = publishedSource('1.1.0', { '1.1.0.md': 'news' });
    recordNotice(root, { version: '1.1.0', today: '2026-11-07', snoozeDays: 3 });
    assert.equal(checkUpdate(root, { sourceDir: source, installed: '1.0.0', today: '2026-11-09' }), null);
    assert.notEqual(checkUpdate(root, { sourceDir: source, installed: '1.0.0', today: '2026-11-10' }), null);
  });

  test('invalid arguments throw', () => {
    const root = campaignWithMemory();
    assert.throws(() => recordNotice(root, { version: '1.1', today: TODAY }), TypeError);
    assert.throws(() => recordNotice(root, { version: '1.1.0', today: '09/11/2026' }), TypeError);
    assert.throws(() => recordNotice(root, { version: '1.1.0', today: TODAY, snoozeDays: -1 }), TypeError);
    assert.throws(() => recordNotice(root, { version: '1.1.0', today: TODAY, snoozeDays: 1.5 }), TypeError);
  });
});

describe('formatUpdateNotice', () => {
  test('prints the exact text with the news indented', () => {
    const text = formatUpdateNotice({
      installed: '1.0.0',
      published: '1.1.0',
      news: 'Prima riga\n\nSeconda riga',
    });
    assert.equal(
      text,
      [
        'YLLIR UPDATE AVAILABLE (for the assistant, not for the master)',
        'installed: 1.0.0',
        'published: 1.1.0',
        'news for the master:',
        '  Prima riga',
        '',
        '  Seconda riga',
        NEXT_STEP,
      ].join('\n'),
    );
  });

  test('omits the news block when news is null', () => {
    const text = formatUpdateNotice({ installed: '1.0.0', published: '1.1.0', news: null });
    assert.equal(
      text,
      [
        'YLLIR UPDATE AVAILABLE (for the assistant, not for the master)',
        'installed: 1.0.0',
        'published: 1.1.0',
        NEXT_STEP,
      ].join('\n'),
    );
  });
});
