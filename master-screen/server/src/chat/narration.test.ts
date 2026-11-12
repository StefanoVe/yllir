import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { narrationActivity } from './activity.js';
import { TEXTS } from './text.js';

const T = TEXTS.en;

describe('narrationActivity', () => {
  it('returns an empty string for empty text', () => {
    assert.equal(narrationActivity('   ', 'en'), '');
  });

  it('keeps a plain sentence on one line', () => {
    assert.equal(narrationActivity('Let me look at the chapter.', 'en'), 'Let me look at the chapter.');
  });

  it('takes only the first non-empty line', () => {
    assert.equal(narrationActivity('\nFirst part\nSecond part', 'en'), 'First part');
  });

  it('shortens to at most 80 characters', () => {
    const long = `${'word '.repeat(40)}end`;
    const line = narrationActivity(long, 'en');
    assert.ok(line.length <= 80, `length ${line.length}`);
    assert.ok(line.endsWith('…'));
  });

  it('uses the generic text for a path, a backtick or a file name', () => {
    assert.equal(narrationActivity('Look in sheets/rovine.md', 'en'), T.working);
    assert.equal(narrationActivity('Open `rovine`', 'en'), T.working);
    assert.equal(narrationActivity('Check post-update.md now', 'en'), T.working);
  });

  it('uses the generic text for internal words', () => {
    assert.equal(narrationActivity('Running the migration now', 'en'), T.working);
    assert.equal(narrationActivity('Calling the hook', 'en'), T.working);
    assert.equal(narrationActivity('Reading the script', 'en'), T.working);
    assert.equal(narrationActivity('Parsing json data', 'en'), T.working);
  });

  it('uses the Italian generic text for Italian campaigns', () => {
    assert.equal(narrationActivity('Controllo la migrazione', 'it'), TEXTS.it.working);
  });
});
