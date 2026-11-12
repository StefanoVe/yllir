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
      ok: 'Testo sbloccato.'
    },
    en: {
      shown: function (n) { return n === 1 ? '1 entry shown' : n + ' entries shown'; },
      none: 'No entry matches.',
      wrong: 'The code is not valid.',
      nocrypto: 'This browser cannot check the code.',
      ok: 'Text unlocked.'
    }
  }[lang];

  var ITERATIONS = 200000;

  function fold(text) {
    return String(text).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  }

  /* Index filter: shows the entries whose title contains the typed text. */
  function setupFilter() {
    var input = document.getElementById('filter');
    if (!input) return;
    var status = document.querySelector('.filter-status');
    var none = document.querySelector('.none');
    var initial = status ? status.textContent : '';
    var sections = Array.prototype.slice.call(document.querySelectorAll('.category'));

    input.addEventListener('input', function () {
      var query = fold(input.value.trim());
      var visible = 0;
      sections.forEach(function (section) {
        var shown = 0;
        Array.prototype.forEach.call(section.querySelectorAll('li[data-s]'), function (item) {
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
  setupLocked();
})();
