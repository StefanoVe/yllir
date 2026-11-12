import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { stripLeadingNarration } from './answer.js';

describe('stripLeadingNarration', () => {
  it('drops a leading "Pending migration" line and the blank lines after it', () => {
    assert.equal(
      stripLeadingNarration('Pending migration: read post-update.md.\n\nThe real answer.'),
      'The real answer.',
    );
  });

  it('matches the prefixes case-insensitively', () => {
    assert.equal(stripLeadingNarration('post-UPDATE check\nAnswer'), 'Answer');
    assert.equal(stripLeadingNarration('migration done\nAnswer'), 'Answer');
  });

  it('keeps text that only mentions the words later in the answer', () => {
    const text = 'The answer.\nMigration is later.';
    assert.equal(stripLeadingNarration(text), text);
  });

  it('does not strip a single line with no line break', () => {
    assert.equal(stripLeadingNarration('Migration only.'), 'Migration only.');
  });

  it('leaves an answer without narration unchanged', () => {
    assert.equal(stripLeadingNarration('Plain answer.'), 'Plain answer.');
  });
});
