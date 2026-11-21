// Public encyclopedia script: the index filter, and the unlock of locked texts.
// Loaded with a same-origin src only (CSP script-src 'self'). Nothing here is
// sent anywhere: the code is checked in the browser by decrypting the text.
(function () {
  'use strict';

  var lang = (document.documentElement.lang || 'en').slice(0, 2) === 'it' ? 'it' : 'en';
  var T = {
    it: {
      shown: function (n) { return n === 1 ? '1 voce mostrata' : n + ' voci mostrate'; },
      none: 'Nessuna voce corrisponde.',
      wrong: 'Codice non valido.',
      nocrypto: 'Questo browser non può verificare il codice.',
      ok: 'Testo sbloccato.',
      discovered: function (n) { return n === 1 ? '1 voce scoperta' : n + ' voci scoperte'; },
      discoveredNow: 'Voce scoperta.'
    },
    en: {
      shown: function (n) { return n === 1 ? '1 entry shown' : n + ' entries shown'; },
      none: 'No entry matches.',
      wrong: 'The code is not valid.',
      nocrypto: 'This browser cannot check the code.',
      ok: 'Text unlocked.',
      discovered: function (n) { return n === 1 ? '1 entry discovered' : n + ' entries discovered'; },
      discoveredNow: 'Entry discovered.'
    }
  }[lang];

  var ITERATIONS = 200000;

  function fold(text) {
    return String(text).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  }

  /* NAMEKEY-BEGIN (same steps as nameKey in scripts/lib/site.mjs; the test compares them) */
  var COMBINING_MARKS = /[̀-ͯ]/g;
  var FNV_PRIME = 0x01000193;
  var FNV_BASIS_A = 0x811c9dc5;
  var FNV_BASIS_B = (0x01000193 ^ 0x9e3779b9) >>> 0;

  function fnv1a(bytes, basis) {
    var hash = basis >>> 0;
    for (var i = 0; i < bytes.length; i += 1) {
      hash ^= bytes[i];
      hash = Math.imul(hash, FNV_PRIME) >>> 0;
    }
    return hash >>> 0;
  }

  function nameKey(title) {
    var folded = String(title).normalize('NFD').replace(COMBINING_MARKS, '').toLowerCase().trim().replace(/\s+/g, ' ');
    var bytes = new TextEncoder().encode(folded);
    return fnv1a(bytes, FNV_BASIS_A).toString(16).padStart(8, '0') + fnv1a(bytes, FNV_BASIS_B).toString(16).padStart(8, '0');
  }
  /* NAMEKEY-END */

  /* Storage of the discovered entries: { "<key>": "<id>" } in localStorage. Every access is guarded,
     and the page keeps the same map in memory, so a browser that refuses storage still works. */
  var STORE_KEY = 'codex-discovered';
  var discoveredMemory = null;

  function readDiscovered() {
    if (discoveredMemory !== null) return discoveredMemory;
    try {
      var parsed = JSON.parse(window.localStorage.getItem(STORE_KEY) || '{}');
      discoveredMemory = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (error) {
      discoveredMemory = {};
    }
    return discoveredMemory;
  }

  function recordDiscovered(key, id) {
    var map = readDiscovered();
    map[key] = id;
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify(map));
    } catch (error) {
      /* storage refused: the page keeps the entry in memory only */
    }
  }

  function isDiscovered(key) {
    return Object.prototype.hasOwnProperty.call(readDiscovered(), key);
  }

  /* Card of the grid, built with DOM methods only (the data is never parsed as markup). */
  function buildCard(card) {
    var item = document.createElement('li');
    item.className = 'card';
    item.setAttribute('data-s', fold(card.title));
    var link = document.createElement('a');
    link.className = 'card-link';
    link.href = 'e/' + card.id + '/';
    var figure = document.createElement('figure');
    figure.className = 'card-art';
    var image = document.createElement('img');
    image.setAttribute('loading', 'lazy');
    if (card.artwork) {
      image.src = card.artwork;
      image.alt = '';
    } else {
      image.className = 'card-placeholder';
      image.src = 'assets/placeholders/' + card.placeholder + '.svg';
      image.alt = '';
    }
    figure.appendChild(image);
    var title = document.createElement('span');
    title.className = 'card-title';
    title.textContent = card.title;
    link.appendChild(figure);
    link.appendChild(title);
    if (card.summary) {
      var text = document.createElement('p');
      text.className = 'card-text';
      text.textContent = card.summary;
      link.appendChild(text);
    }
    item.appendChild(link);
    return item;
  }

  function fetchCard(key) {
    return fetch('c/' + key + '.json', { cache: 'no-cache' }).then(function (response) {
      if (!response.ok) throw new Error('card');
      return response.json();
    });
  }

  /* On an entry page: the entry is discovered, and links to entries not yet discovered become plain text. */
  function setupEntryPage() {
    var main = document.querySelector('main[data-entry]');
    if (!main) return;
    if (main.getAttribute('data-mode') !== 'discovered') return;
    var key = main.getAttribute('data-key');
    var id = main.getAttribute('data-entry');
    if (key && id) recordDiscovered(key, id);
    var known = readDiscovered();
    var found = {};
    Object.keys(known).forEach(function (k) { found[known[k]] = true; });
    found[id] = true;
    Array.prototype.forEach.call(document.querySelectorAll('.entry-body a[href^="../"]'), function (link) {
      var target = link.getAttribute('href').slice(3).split('/')[0];
      if (target === '' || target === '..' || found[target]) return;
      var span = document.createElement('span');
      span.textContent = link.textContent;
      link.parentNode.replaceChild(span, link);
    });
  }

  /* On the index in discovered mode: the discovered cards, and the search that can discover one more. */
  function setupDiscovered() {
    var main = document.querySelector('main[data-mode="discovered"]');
    if (!main) return;
    var input = document.getElementById('filter');
    var status = document.querySelector('.filter-status');
    var grid = document.getElementById('discovered-grid');
    var none = document.getElementById('none-discovered');
    if (!input || !grid) return;
    var keys = Object.keys(readDiscovered());
    var discoverList = null;

    function countText() {
      return T.discovered(grid.querySelectorAll('li.card').length);
    }

    function showCount() {
      var count = grid.querySelectorAll('li.card').length;
      if (status) status.textContent = countText();
      if (none) none.hidden = count !== 0;
    }

    function addCard(card, atStart) {
      var item = buildCard(card);
      if (atStart && grid.firstChild) grid.insertBefore(item, grid.firstChild);
      else grid.appendChild(item);
    }

    keys.forEach(function (key) {
      fetchCard(key).then(function (card) {
        if (card && card.id) addCard(card, false);
        showCount();
      }).catch(function () {
        /* a card that cannot be read is left out; the count stays honest */
        showCount();
      });
    });
    showCount();

    function discoverListLoaded() {
      if (discoverList !== null) return Promise.resolve(discoverList);
      return fetch('discover.json', { cache: 'no-cache' }).then(function (response) {
        if (!response.ok) throw new Error('discover');
        return response.json();
      }).then(function (list) {
        discoverList = Array.isArray(list) ? list : [];
        return discoverList;
      }).catch(function () {
        discoverList = [];
        return discoverList;
      });
    }

    input.addEventListener('input', function () {
      var value = input.value.trim();
      var key = value === '' ? '' : nameKey(value);
      var query = fold(value);
      var visible = 0;
      Array.prototype.forEach.call(grid.querySelectorAll('li.card[data-s]'), function (item) {
        var match = query === '' || item.getAttribute('data-s').indexOf(query) !== -1;
        item.hidden = !match;
        if (match) visible += 1;
      });
      if (key === '') {
        showCount();
        return;
      }
      if (!isDiscovered(key)) {
        discoverListLoaded().then(function (list) {
          if (list.indexOf(key) === -1 || isDiscovered(key) || input.value.trim() !== value) return;
          fetchCard(key).then(function (card) {
            if (!card || !card.id || isDiscovered(key)) return;
            recordDiscovered(key, card.id);
            addCard(card, true);
            if (none) none.hidden = true;
            if (status) status.textContent = T.discoveredNow;
          }).catch(function () { /* nothing is shown for a card that cannot be read */ });
        });
      }
      if (status && !isDiscovered(key)) status.textContent = visible === 0 ? T.none : T.shown(visible);
    });

    var form = input.form;
    if (form) form.addEventListener('submit', function (event) { event.preventDefault(); });
  }

  /* Index filter: shows the entries whose title contains the typed text. */
  function setupFilter() {
    var input = document.getElementById('filter');
    if (!input) return;
    if (document.querySelector('main[data-mode="discovered"]')) return;
    var status = document.querySelector('.filter-status');
    var none = document.querySelector('.none');
    var initial = status ? status.textContent : '';
    var sections = Array.prototype.slice.call(document.querySelectorAll('.category'));

    input.addEventListener('input', function () {
      var query = fold(input.value.trim());
      var visible = 0;
      sections.forEach(function (section) {
        var shown = 0;
        Array.prototype.forEach.call(section.querySelectorAll('li.card[data-s]'), function (item) {
          var match = query === '' || item.getAttribute('data-s').indexOf(query) !== -1;
          item.hidden = !match;
          if (match) shown += 1;
        });
        section.hidden = shown === 0;
        visible += shown;
      });
      if (status) status.textContent = query === '' ? initial : T.shown(visible);
      if (none) none.hidden = visible !== 0;
    });

    var form = input.form;
    if (form) form.addEventListener('submit', function (event) { event.preventDefault(); });
  }

  function b64(text) {
    var binary = atob(text);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  /* Decrypts one locked text with the typed code (PBKDF2-SHA256, then AES-256-GCM). */
  function unlock(box, code) {
    var subtle = window.crypto && window.crypto.subtle;
    if (!subtle) return Promise.reject(new Error('no-crypto'));
    var encoder = new TextEncoder();
    return subtle.importKey('raw', encoder.encode(code), 'PBKDF2', false, ['deriveKey']).then(function (base) {
      return subtle.deriveKey(
        { name: 'PBKDF2', salt: b64(box.getAttribute('data-salt')), iterations: ITERATIONS, hash: 'SHA-256' },
        base,
        { name: 'AES-GCM', length: 256 },
        false,
        ['decrypt']
      );
    }).then(function (key) {
      return subtle.decrypt(
        { name: 'AES-GCM', iv: b64(box.getAttribute('data-iv')) },
        key,
        b64(box.getAttribute('data-cipher'))
      );
    }).then(function (plain) {
      return new TextDecoder().decode(plain);
    });
  }

  function setupLocked() {
    Array.prototype.forEach.call(document.querySelectorAll('.locked[data-cipher]'), function (box) {
      var form = box.querySelector('.locked-form');
      var field = box.querySelector('input[name="code"]');
      var message = box.querySelector('.locked-msg');
      if (!form || !field) return;
      form.addEventListener('submit', function (event) {
        event.preventDefault();
        var code = field.value.trim();
        if (code === '') return;
        if (message) message.textContent = '';
        unlock(box, code).then(function (html) {
          var body = document.createElement('div');
          body.className = 'locked-open';
          body.innerHTML = html;
          box.parentNode.replaceChild(body, box);
          body.setAttribute('tabindex', '-1');
          body.focus();
          var notice = document.createElement('p');
          notice.className = 'locked-msg';
          notice.setAttribute('role', 'status');
          notice.textContent = T.ok;
          body.insertBefore(notice, body.firstChild);
        }).catch(function (error) {
          if (message) {
            message.className = 'locked-msg is-error';
            message.textContent = error && error.message === 'no-crypto' ? T.nocrypto : T.wrong;
          }
          field.value = '';
          field.focus();
        });
      });
    });
  }

  setupFilter();
  setupDiscovered();
  setupEntryPage();
  setupLocked();
})();
