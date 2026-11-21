// Pages of the public site: the index, one page per entry, the redirect pages of
// merged ids, the "no longer available" pages, the 404 page and the search index.
// Every page links only the local stylesheet and the local script (CSP script-src
// 'self'); there are no inline scripts and no style attributes.

import { renderMarkdown, escapeHtml } from './render.mjs';
import { encryptLocked, MIN_CODE_LENGTH } from './locked.mjs';
import { siteText, langOf } from './strings.mjs';

/** Lower-case text without accents, used for the filter attribute and the filter script. */
export function foldForSearch(text) {
  return String(text).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

// NAME KEY: the key of a title in discovered mode. site.js implements the same steps
// (between the NAMEKEY markers); site.test.mjs checks that both give the same value.
// The marks removed here are the combining diacritics U+0300 to U+036F, on both sides.
// NAMEKEY-BEGIN
const COMBINING_MARKS = /[̀-ͯ]/g;
const FNV_PRIME = 0x01000193;
const FNV_BASIS_A = 0x811c9dc5;
const FNV_BASIS_B = (0x01000193 ^ 0x9e3779b9) >>> 0;

function fnv1a(bytes, basis) {
  let hash = basis >>> 0;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash >>> 0;
}

/** The key of a title: 16 lower-case hex characters, two FNV-1a hashes of the folded title. */
export function nameKey(title) {
  const folded = String(title).normalize('NFD').replace(COMBINING_MARKS, '').toLowerCase().trim().replace(/\s+/g, ' ');
  const bytes = new TextEncoder().encode(folded);
  return fnv1a(bytes, FNV_BASIS_A).toString(16).padStart(8, '0') + fnv1a(bytes, FNV_BASIS_B).toString(16).padStart(8, '0');
}
// NAMEKEY-END

/** The file of the placeholder picture of an entry, relative to the site root. */
export function placeholderSrc(entry) {
  return `assets/placeholders/${entry.placeholder}.svg`;
}

/** The markup of one card of the grid: picture, title and, when there is one, the summary. */
export function cardHtml(entry, prefix) {
  const art = entry.artwork
    ? `<img src="${prefix}${escapeHtml(entry.artwork.src)}" alt="${escapeHtml(entry.artwork.alt)}" loading="lazy">`
    : `<img class="card-placeholder" src="${prefix}${escapeHtml(placeholderSrc(entry))}" alt="">`;
  const text = entry.summary ? `<p class="card-text">${escapeHtml(entry.summary)}</p>` : '';
  return `<li class="card" data-s="${escapeHtml(foldForSearch(entry.title))}"><a class="card-link" href="${prefix}e/${escapeHtml(entry.id)}/">
<figure class="card-art">${art}</figure>
<span class="card-title">${escapeHtml(entry.title)}</span>${text}
</a></li>`;
}

/** The first image line of the body that is the artwork of the entry is shown above the body, not in it. */
function withoutArtworkLine(markdown, state, entry) {
  if (state.artDone || !entry.artwork) return markdown;
  const want = `../../${entry.artwork.src}`;
  const lines = markdown.split('\n');
  let fence = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^ {0,3}(```|~~~)/.test(line)) fence = !fence;
    if (fence) continue;
    if (/^ {0,3}#{2,6}[ \t]/.test(line)) {
      state.artDone = true;
      return markdown;
    }
    const match = /^ {0,3}!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)\s*$/.exec(line);
    if (match && entry.imageSrc.get(match[1]) === want) {
      state.artDone = true;
      lines.splice(i, 1);
      return lines.join('\n');
    }
  }
  return markdown;
}

/**
 * Removes the first top-level heading of the body (the page already shows the title).
 * `state.done` carries over between the segments of one entry.
 */
function withoutFirstHeading(markdown, state) {
  let fence = false;
  return markdown
    .split('\n')
    .filter((line) => {
      if (/^ {0,3}(```|~~~)/.test(line)) fence = !fence;
      if (!state.done && !fence && /^ {0,3}#[ \t]+/.test(line)) {
        state.done = true;
        return false;
      }
      return true;
    })
    .join('\n');
}

/**
 * The page skeleton. `prefix` is the relative path back to the site root.
 * @returns {string} the whole document
 */
export function page({ lang, title, prefix, siteTitle, body, head = '' }) {
  const t = siteText(lang);
  return `<!doctype html>
<html lang="${escapeHtml(langOf(lang))}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${escapeHtml(title)}</title>
${head}<link rel="stylesheet" href="${prefix}assets/site.css">
</head>
<body>
<a class="skip-link" href="#main">${escapeHtml(t.skip)}</a>
<header class="site-header">
<p class="site-name"><a href="${prefix}">${escapeHtml(t.title)}</a></p>
</header>
${body}
<footer class="site-footer">
<p>${escapeHtml(siteTitle)}</p>
</footer>
<script src="${prefix}assets/site.js" defer></script>
</body>
</html>
`;
}

/**
 * The page of one entry, with its locked texts encrypted.
 * @returns {{ html: string, locks: Array<{label: string, code: string, salt: string, iv: string, cipher: string, plain: string}> }}
 */
export function renderEntry(entry, { lang, siteTitle, listMode = 'full' }) {
  const t = siteText(lang);
  const discovered = listMode === 'discovered';
  const locks = [];
  let lockNo = 0;
  const resolveImage = (url) => entry.imageSrc.get(url) ?? null;
  const options = { resolveLink: (url) => entry.linkHref(url), resolveImage, minHeading: 2 };

  const headingState = { done: false, artDone: false };
  const parts = [];
  for (const segment of entry.segments) {
    if (segment.type === 'md') {
      const text = withoutFirstHeading(withoutArtworkLine(segment.text, headingState, entry), headingState);
      parts.push(renderMarkdown(text, options));
      continue;
    }
    lockNo += 1;
    const plain = renderMarkdown(segment.text, options);
    const code = entry.codes[segment.label];
    if (typeof code !== 'string' || code.length < MIN_CODE_LENGTH) {
      // Not buildable: the check fails and nothing is published. The text is never written.
      parts.push(`<div class="locked locked-missing"><p class="locked-note">${escapeHtml(t.lockedNote)}</p></div>`);
      continue;
    }
    const encrypted = encryptLocked({ code, label: segment.label, text: plain });
    locks.push({ label: segment.label, code, ...encrypted, plain });
    parts.push(lockedBlock(segment.label, encrypted, lockNo, t));
  }
  const artHtml = entry.artwork
    ? `<figure class="entry-art"><img src="../../${escapeHtml(entry.artwork.src)}" alt="${escapeHtml(entry.artwork.alt)}"></figure>\n`
    : '';
  const mapHtml = (entry.maps ?? [])
    .map((map) => `<figure class="entry-map"><img src="../../${escapeHtml(map.src)}" alt="${escapeHtml(map.alt)}" loading="lazy"><figcaption>${escapeHtml(map.label === 'battleMap' ? t.battleMap : t.plan)}</figcaption></figure>`)
    .join('\n');
  const keyAttrs = `data-entry="${escapeHtml(entry.id)}" data-key="${nameKey(entry.title)}"${discovered ? ' data-mode="discovered"' : ''}`;
  const body = `<main id="main" class="entry-main" ${keyAttrs}>
<article class="entry" aria-labelledby="entry-title">
<p class="crumb"><a href="../../">${escapeHtml(t.home)}</a> <span aria-hidden="true">/</span> ${escapeHtml(entry.categoryTitle)}</p>
<h1 id="entry-title">${escapeHtml(entry.title)}</h1>
${artHtml}<div class="entry-body">
${parts.filter((p) => p !== '').join('\n')}
</div>
${mapHtml}
</article>
</main>`;

  return {
    html: page({ lang, title: `${entry.title} · ${t.title}`, prefix: '../../', siteTitle, body }),
    locks,
  };
}

function lockedBlock(label, { salt, iv, cipher }, n, t) {
  return `<div class="locked" data-label="${escapeHtml(label)}" data-salt="${salt}" data-iv="${iv}" data-cipher="${cipher}">
<p class="locked-note">${escapeHtml(t.lockedNote)}</p>
<form class="locked-form" autocomplete="off">
<label for="lock-${n}">${escapeHtml(t.codeLabel)}</label>
<input id="lock-${n}" name="code" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" required>
<button type="submit">${escapeHtml(t.unlock)}</button>
</form>
<p class="locked-msg" role="status"></p>
<noscript><p class="locked-note">${escapeHtml(t.noScript)}</p></noscript>
</div>`;
}

/**
 * The index. Full mode: entries grouped by category, as a grid of cards, with a filter box.
 * Discovered mode: no entry at all; the page is filled by site.js with the entries the
 * player has opened, and an undiscovered entry shows up only when its exact name is typed.
 */
export function renderIndex({ lang, siteTitle, entries, categories, listMode = 'full' }) {
  const t = siteText(lang);
  if (listMode === 'discovered') {
    const body = `<main id="main" class="index-main" data-mode="discovered">
<h1>${escapeHtml(t.title)}</h1>
<p class="site-subtitle">${escapeHtml(siteTitle)}</p>
<form class="filter" role="search" action="" method="get">
<label for="filter">${escapeHtml(t.search)}</label>
<input id="filter" name="q" type="search" placeholder="${escapeHtml(t.discoverHint)}" autocomplete="off">
</form>
<p class="filter-status" role="status" aria-live="polite"></p>
<ul class="card-grid" id="discovered-grid"></ul>
<p class="empty" id="none-discovered" hidden>${escapeHtml(t.noneDiscovered)}</p>
<noscript><p class="empty">${escapeHtml(t.needScript)}</p></noscript>
</main>`;
    return page({ lang, title: `${t.title} · ${siteTitle}`, prefix: '', siteTitle, body });
  }

  const groups = categories
    .map((category, index) => {
      const items = entries
        .filter((entry) => entry.category === category.id)
        .map((entry) => cardHtml(entry, ''))
        .join('\n');
      if (items === '') return '';
      return `<section class="category" aria-labelledby="cat-${index}">
<h2 id="cat-${index}">${escapeHtml(category.title)}</h2>
<ul class="card-grid">
${items}
</ul>
</section>`;
    })
    .filter((g) => g !== '')
    .join('\n');

  const count = t.count(entries.length);
  const body = `<main id="main" class="index-main">
<h1>${escapeHtml(t.title)}</h1>
<p class="site-subtitle">${escapeHtml(siteTitle)}</p>
<form class="filter" role="search" action="" method="get">
<label for="filter">${escapeHtml(t.search)}</label>
<input id="filter" name="q" type="search" placeholder="${escapeHtml(t.searchHint)}" autocomplete="off">
</form>
<p class="filter-status" role="status" aria-live="polite" data-count="${entries.length}">${escapeHtml(count)}</p>
${entries.length === 0 ? `<p class="empty">${escapeHtml(t.empty)}</p>` : groups}
<p class="none" hidden>${escapeHtml(t.noResults)}</p>
</main>`;
  return page({ lang, title: `${t.title} · ${siteTitle}`, prefix: '', siteTitle, body });
}

/** A page for a merged id: a meta refresh to the surviving entry and a plain link. */
export function renderRedirect({ lang, siteTitle, target }) {
  const t = siteText(lang);
  const head = `<meta http-equiv="refresh" content="0; url=../../e/${target.id}/">\n`;
  const body = `<main id="main" class="notice-main">
<h1>${escapeHtml(target.title)}</h1>
<p>${escapeHtml(t.redirected)} <a href="../../e/${target.id}/">${escapeHtml(target.title)}</a>.</p>
</main>`;
  return page({ lang, title: target.title, prefix: '../../', siteTitle, body, head });
}

/** A page for a retired id with no survivor. */
export function renderGone({ lang, siteTitle }) {
  const t = siteText(lang);
  const body = `<main id="main" class="notice-main">
<h1>${escapeHtml(t.title)}</h1>
<p>${escapeHtml(t.gone)}</p>
<p><a href="../../">${escapeHtml(t.home)}</a></p>
</main>`;
  return page({ lang, title: `${t.notFound} · ${t.title}`, prefix: '../../', siteTitle, body });
}

/** The 404 page at the root of the site. */
export function render404({ lang, siteTitle }) {
  const t = siteText(lang);
  const body = `<main id="main" class="notice-main">
<h1>${escapeHtml(t.notFound)}</h1>
<p>${escapeHtml(t.notFoundText)}</p>
<p><a href="./">${escapeHtml(t.home)}</a></p>
</main>`;
  return page({ lang, title: `${t.notFound} · ${t.title}`, prefix: '', siteTitle, body });
}

/** The search index: id, title, category and plain text of each entry (locked texts are never in it). */
export function searchIndex(entries) {
  return entries.map((entry) => ({
    id: entry.id,
    title: entry.title,
    category: entry.category,
    path: `e/${entry.id}/`,
    text: entry.plain,
  }));
}

