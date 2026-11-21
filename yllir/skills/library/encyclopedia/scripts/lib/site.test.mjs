import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nameKey, cardHtml, placeholderSrc, renderIndex, renderEntry } from './site.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SITE_JS = path.resolve(HERE, '../../site/site.js');

const TITLES = ['Lanterna di Morvalle', "Chiave d'Ébano", 'Porto di Selce', 'Ilde Varno', '  Vettore   NERO '];

/** The nameKey of site.js, taken from the marked block of the file and run in its own context. */
function browserNameKey() {
  const source = fs.readFileSync(SITE_JS, 'utf8');
  const match = /NAMEKEY-BEGIN[\s\S]*?\*\/([\s\S]*?)\/\* NAMEKEY-END \*\//.exec(source);
  assert.ok(match, 'the NAMEKEY block is in site.js');
  return vm.runInContext(`${match[1]}\nnameKey;`, vm.createContext({ TextEncoder }));
}

test('nameKey is 16 lower-case hex characters and ignores case, accents and extra spaces', () => {
  const key = nameKey('Lanterna di Morvalle');
  assert.match(key, /^[0-9a-f]{16}$/);
  assert.equal(nameKey('  LANTERNA   di  morvalle '), key);
  assert.equal(nameKey("Chiave d'Ébano"), nameKey("Chiave d'Ébano"), 'composed and decomposed accents');
  assert.equal(nameKey("Chiave d'Ébano"), nameKey("chiave d'ebano"));
  assert.notEqual(nameKey('Porto di Selce'), nameKey('Ilde Varno'));
});

test('the site.js nameKey gives the same value as the build for the same titles', () => {
  const browser = browserNameKey();
  for (const title of TITLES) {
    assert.equal(browser(title), nameKey(title), JSON.stringify(title));
  }
});

test('cardHtml uses the placeholder without artwork, escapes the title, and leaves out the summary when it is empty', () => {
  const base = { id: 'porto-di-selce', title: 'Porto & "Selce" <b>', category: 'luoghi', summary: 'A grey harbour.', artwork: null, placeholder: 'place' };
  const html = cardHtml(base, '');
  assert.equal(placeholderSrc(base), 'assets/placeholders/place.svg');
  assert.match(html, /<img class="card-placeholder" src="assets\/placeholders\/place\.svg" alt="">/);
  assert.match(html, /<span class="card-title">Porto &amp; &quot;Selce&quot; &lt;b&gt;<\/span>/);
  assert.match(html, /<a class="card-link" href="e\/porto-di-selce\/">/);
  assert.match(html, /<p class="card-text">A grey harbour\.<\/p>/);
  assert.equal(html.includes('<b>'), false);

  const noText = cardHtml({ ...base, summary: '' }, '');
  assert.equal(noText.includes('card-text'), false);
});

test('cardHtml uses the artwork with the prefix and an escaped alt text when there is one', () => {
  const base = { id: 'porto-di-selce', title: 'Porto di Selce', summary: '', artwork: { src: 'assets/img/abc.png', alt: 'Lamp "red"' }, placeholder: 'place' };
  const html = cardHtml(base, '../');
  assert.match(html, /<img src="\.\.\/assets\/img\/abc\.png" alt="Lamp &quot;red&quot;" loading="lazy">/);
  assert.equal(html.includes('card-placeholder'), false);
});

test('renderIndex in discovered mode holds no entry title and no entry link', () => {
  const entries = [
    { id: 'porto-di-selce', title: 'Porto di Selce', category: 'luoghi', categoryTitle: 'Luoghi', summary: 'A harbour.', artwork: null, placeholder: 'place' },
    { id: 'ilde-varno', title: 'Ilde Varno', category: 'personaggi', categoryTitle: 'Personaggi', summary: '', artwork: null, placeholder: 'character' },
  ];
  const categories = [{ id: 'luoghi', title: 'Luoghi' }, { id: 'personaggi', title: 'Personaggi' }];
  const html = renderIndex({ lang: 'en', siteTitle: 'Atlas', entries, categories, listMode: 'discovered' });
  for (const entry of entries) {
    assert.equal(html.includes(entry.title), false, entry.title);
    assert.equal(html.includes(`e/${entry.id}/`), false, entry.id);
    assert.equal(html.includes(entry.id), false, entry.id);
  }
  assert.equal(html.includes('Luoghi'), false, 'category titles are not shown either');
  assert.match(html, /<main id="main" class="index-main" data-mode="discovered">/);
  assert.match(html, /<ul class="card-grid" id="discovered-grid"><\/ul>/);
  assert.match(html, /<p class="empty" id="none-discovered" hidden>/);
  assert.match(html, /<noscript><p class="empty">/);
  assert.match(html, /placeholder="Type the exact name of an entry to discover it\."/);

  const full = renderIndex({ lang: 'en', siteTitle: 'Atlas', entries, categories, listMode: 'full' });
  assert.match(full, /<span class="card-title">Porto di Selce<\/span>/);
  assert.equal(full.includes('data-mode'), false);
});

test('renderEntry shows the artwork under the title once, and the maps after the body with their labels', () => {
  const linkHref = (url) => url;
  const entry = {
    id: 'lamp',
    title: 'Lamp',
    categoryTitle: 'Items',
    segments: [{ type: 'md', text: '# Lamp\n\n![Lamp](img/l.png)\n\nA brass lamp.\n\n## Notes\n\nIt hums.' }],
    codes: {},
    imageSrc: new Map([['img/l.png', '../../assets/img/abc.png']]),
    linkHref,
    artwork: { src: 'assets/img/abc.png', alt: 'Lamp' },
    maps: [{ src: 'assets/img/plan1.png', alt: 'Town', label: 'plan' }],
    summary: 'A brass lamp.',
    placeholder: 'other',
  };
  const { html } = renderEntry(entry, { lang: 'en', siteTitle: 'Atlas', listMode: 'discovered' });
  assert.match(html, /<figure class="entry-art"><img src="\.\.\/\.\.\/assets\/img\/abc\.png" alt="Lamp"><\/figure>/);
  assert.equal(html.split('abc.png').length - 1, 1, 'the artwork is not repeated in the body');
  assert.match(html, /<figure class="entry-map"><img src="\.\.\/\.\.\/assets\/img\/plan1\.png" alt="Town" loading="lazy"><figcaption>Plan<\/figcaption><\/figure>/);
  assert.match(html, /<main id="main" class="entry-main" data-entry="lamp" data-key="[0-9a-f]{16}" data-mode="discovered">/);
  assert.equal(html.includes('<h2>Notes</h2>'), true);
});

test('renderEntry in full mode has the key but no discovered mode', () => {
  const entry = {
    id: 'lamp', title: 'Lamp', categoryTitle: 'Items', segments: [{ type: 'md', text: '# Lamp\n\nText.' }],
    codes: {}, imageSrc: new Map(), linkHref: (u) => u, artwork: null, maps: [], summary: '', placeholder: 'other',
  };
  const { html } = renderEntry(entry, { lang: 'en', siteTitle: 'Atlas', listMode: 'full' });
  assert.match(html, /<main id="main" class="entry-main" data-entry="lamp" data-key="[0-9a-f]{16}">/);
  assert.equal(html.includes('figure class="entry-art"'), false);
});

test('every placeholder SVG is self-contained: no currentColor, no <style and no <script', () => {
  const dir = path.resolve(HERE, '../../site/placeholders');
  const files = fs.readdirSync(dir).filter((n) => n.endsWith('.svg'));
  assert.ok(files.length > 0);
  for (const name of files) {
    const text = fs.readFileSync(path.join(dir, name), 'utf8');
    assert.equal(text.includes('currentColor'), false, `${name} uses currentColor`);
    assert.equal(text.includes('<style'), false, `${name} has a <style>`);
    assert.equal(text.includes('<script'), false, `${name} has a <script>`);
  }
});
