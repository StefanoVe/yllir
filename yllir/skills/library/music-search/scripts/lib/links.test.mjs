import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatMusicLine, masterBlockLines, readMusicItems } from './links.mjs';

const SHEET = `<!-- yllir
id: x-y
kind: place
provenance: master
location: []
-->

# Place

Public text with a - [Fake](https://youtu.be/public) — not music.

<!-- master -->
## Master

### Master notes

Notes.

### Musica

- [Taverna rumori](https://youtube.com/watch?v=1) — caldo, affollato; scena della taverna
- [Notte di pioggia](https://youtu.be/2) — pioggia, lunga, senza voci
- una riga senza link
- [Titolo](http://youtube.com/no) — http non valido

### Other

- [Not music](https://youtube.com/3) — altro
<!-- /master -->
`;

test('masterBlockLines returns only the lines of the master-only block', () => {
  const lines = masterBlockLines(SHEET);
  assert.equal(lines[0], '## Master');
  assert.ok(!lines.some((l) => l.includes('Fake')));
  assert.equal(masterBlockLines('# no block\n'), null);
});

test('readMusicItems reads the links under the music heading only', () => {
  const { items, skipped } = readMusicItems(SHEET);
  assert.deepEqual(items.map((i) => i.url), ['https://youtube.com/watch?v=1', 'https://youtu.be/2']);
  assert.equal(items[0].title, 'Taverna rumori');
  assert.equal(items[0].mood, 'caldo, affollato; scena della taverna');
  assert.equal(skipped, 2);
});

test('the English heading is read too, and a sheet without it has no items', () => {
  const en = SHEET.replace('### Musica', '### Music');
  assert.equal(readMusicItems(en).items.length, 2);
  assert.deepEqual(readMusicItems('# x\n<!-- master -->\n## Master\n### A\n-\n<!-- /master -->\n'), { items: [], skipped: 0 });
  assert.deepEqual(readMusicItems('# x\n'), { items: [], skipped: 0 });
});

test('formatMusicLine writes the fixed line and the parser reads it back', () => {
  const made = formatMusicLine({ title: 'Night Tavern', url: 'https://youtu.be/abc', mood: 'warm; the inn scene' });
  assert.equal(made.line, '- [Night Tavern](https://youtu.be/abc) — warm; the inn scene');
  const back = readMusicItems(`<!-- master -->\n## Master\n### Music\n${made.line}\n<!-- /master -->\n`);
  assert.deepEqual(back.items, [{ title: 'Night Tavern', url: 'https://youtu.be/abc', mood: 'warm; the inn scene' }]);
});

test('formatMusicLine refuses bad titles, links, moods and comment markers', () => {
  assert.equal(formatMusicLine({ title: 'a]b', url: 'https://youtu.be/x', mood: 'm' }).error, 'bad-title');
  assert.equal(formatMusicLine({ title: '', url: 'https://youtu.be/x', mood: 'm' }).error, 'bad-title');
  assert.equal(formatMusicLine({ title: 'T', url: 'http://youtu.be/x', mood: 'm' }).error, 'bad-url');
  assert.equal(formatMusicLine({ title: 'T', url: 'https://youtu.be/x )', mood: 'm' }).error, 'bad-url');
  assert.equal(formatMusicLine({ title: 'T', url: 'https://youtu.be/x', mood: '' }).error, 'bad-mood');
  assert.equal(formatMusicLine({ title: 'T', url: 'https://youtu.be/x', mood: 'a\nb' }).error, 'bad-mood');
  assert.equal(formatMusicLine({ title: 'T', url: 'https://youtu.be/x', mood: 'a --> b' }).error, 'bad-mood');
});
