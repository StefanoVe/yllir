// Viewer of the atlas site: pan and zoom of the inline map, the infinite sea, the layer switches,
// the search and the place card. Vanilla browser JavaScript, no libraries. The page data is read from
// #atlas-data; every piece of text on screen comes from its `strings`, so the viewer chooses no language.
(function () {
  'use strict';

  const MIN_Z = 1 / 1.5; // zoom relative to fit-to-window
  const MAX_Z = 12;
  const FOCUS_Z = 3;
  const DRAG_PX = 6;
  const TAP_MS = 300;
  const TAP_PX = 25;
  const ASSET_BASE = 'assets/';
  const LAYERS_KEY = 'yllir-atlas-layers-open';

  const dataEl = document.getElementById('atlas-data');
  let data;
  try {
    data = JSON.parse(dataEl.textContent);
  } catch (err) {
    return;
  }
  const S = data.strings;
  const W = data.canvas.width;
  const H = data.canvas.height;
  const map = document.getElementById('map');
  const stage = document.getElementById('stage');
  const sea = document.getElementById('sea');
  const svg = stage.querySelector('svg');
  const places = new Map(data.places.map((p) => [p.id, p]));
  const nodes = new Map();

  sea.style.backgroundImage = `url("${ASSET_BASE}${data.seaTexture}")`;
  stage.style.width = `${W}px`;
  stage.style.height = `${H}px`;

  // ---- Helpers --------------------------------------------------------------------------------

  function el(tag, className, attrs, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    for (const key of Object.keys(attrs || {})) node.setAttribute(key, attrs[key]);
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  // Lowercase, without accents: the search ignores case and accents.
  const norm = (text) => String(text).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const layerName = (name) => (S.layerNames && S.layerNames[name]) || name;

  // ---- Pan and zoom ---------------------------------------------------------------------------

  // view.z is the zoom relative to the fit; the scale in pixels per canvas unit is fit * z.
  const view = { z: 1, x: 0, y: 0, fit: 1 };
  let frame = null;
  let anim = null;
  let lastSize = null;
  const scale = () => view.fit * view.z;
  const clampZ = (z) => Math.min(MAX_Z, Math.max(MIN_Z, z));
  const mapSize = () => ({ w: map.clientWidth, h: map.clientHeight });

  function render() {
    frame = null;
    const s = scale();
    stage.style.transform = `translate(${view.x}px, ${view.y}px) scale(${s})`;
    const tile = data.seaTile * s;
    sea.style.backgroundSize = `${tile}px ${tile}px`;
    sea.style.backgroundPosition = `${view.x}px ${view.y}px`;
  }

  function schedule() {
    if (frame === null) frame = requestAnimationFrame(render);
  }

  function stopAnimation() {
    if (anim !== null) cancelAnimationFrame(anim);
    anim = null;
  }

  // Keeps the canvas point under the screen point (sx, sy) where it is while the zoom changes.
  function zoomAt(sx, sy, z) {
    const before = scale();
    const cx = (sx - view.x) / before;
    const cy = (sy - view.y) / before;
    view.z = clampZ(z);
    const after = scale();
    view.x = sx - cx * after;
    view.y = sy - cy * after;
    schedule();
  }

  function panBy(dx, dy) {
    view.x += dx;
    view.y += dy;
    schedule();
  }

  function computeFit() {
    const s = mapSize();
    view.fit = Math.min(s.w / W, s.h / H) || 1;
  }

  function fitToWindow() {
    stopAnimation();
    computeFit();
    view.z = 1;
    const s = mapSize();
    view.x = (s.w - W * view.fit) / 2;
    view.y = (s.h - H * view.fit) / 2;
    lastSize = s;
    schedule();
  }

  // Animates to zoom z with the canvas point (cx, cy) in the middle of the map.
  function animateCentre(z, cx, cy, ms) {
    stopAnimation();
    const target = clampZ(z);
    const s = mapSize();
    const to = { z: target, x: s.w / 2 - cx * view.fit * target, y: s.h / 2 - cy * view.fit * target };
    const from = { z: view.z, x: view.x, y: view.y };
    const started = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - started) / ms);
      const e = t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2;
      view.z = from.z + (to.z - from.z) * e;
      view.x = from.x + (to.x - from.x) * e;
      view.y = from.y + (to.y - from.y) * e;
      schedule();
      anim = t < 1 ? requestAnimationFrame(step) : null;
    };
    anim = requestAnimationFrame(step);
  }

  function zoomCentre(factor) {
    const s = mapSize();
    zoomAt(s.w / 2, s.h / 2, view.z * factor);
  }

  // Gestures: one pointer pans, two pinch-zoom at their midpoint. A short press without movement is a tap.
  const pointers = new Map();
  let gesture = null;
  let moved = false;
  let lastTap = null;
  let wheelTimer = null;

  function onDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    stopAnimation();
    try {
      map.setPointerCapture(e.pointerId);
    } catch (err) {
      // Capture is an aid for drags that leave the map; a failure changes nothing else.
    }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY });
    if (pointers.size > 1) {
      moved = true;
      gesture = null;
    } else {
      moved = false;
    }
    stage.classList.add('is-moving');
  }

  function onMove(e) {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    if (pointers.size === 1) {
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      if (!moved && Math.hypot(e.clientX - p.sx, e.clientY - p.sy) > DRAG_PX) {
        moved = true;
        map.classList.add('dragging');
      }
      p.x = e.clientX;
      p.y = e.clientY;
      if (moved) panBy(dx, dy);
      return;
    }
    p.x = e.clientX;
    p.y = e.clientY;
    const [a, b] = [...pointers.values()];
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    if (gesture === null) {
      gesture = { dist0: dist, z0: view.z, mx, my };
      return;
    }
    panBy(mx - gesture.mx, my - gesture.my);
    gesture.mx = mx;
    gesture.my = my;
    if (gesture.dist0 > 0) zoomAt(mx, my, (gesture.z0 * dist) / gesture.dist0);
  }

  function onUp(e) {
    if (!pointers.has(e.pointerId)) return;
    const wasSingle = pointers.size === 1;
    pointers.delete(e.pointerId);
    if (pointers.size < 2) gesture = null;
    if (pointers.size === 0) {
      stage.classList.remove('is-moving');
      map.classList.remove('dragging');
    }
    if (wasSingle && !moved && e.type === 'pointerup') tap(e);
  }

  function tap(e) {
    const now = performance.now();
    if (lastTap && now - lastTap.t < TAP_MS && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < TAP_PX) {
      lastTap = null;
      const rect = map.getBoundingClientRect();
      zoomAt(e.clientX - rect.left, e.clientY - rect.top, view.z * 2);
      return;
    }
    lastTap = { t: now, x: e.clientX, y: e.clientY };
    const hit = document.elementFromPoint(e.clientX, e.clientY);
    const place = hit && hit.closest ? hit.closest('g.place') : null;
    if (place) openPlace(place.getAttribute('data-place'), place);
  }

  map.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    gesture = null;
    if (pointers.size === 0) {
      stage.classList.remove('is-moving');
      map.classList.remove('dragging');
    }
  });
  map.addEventListener('dragstart', (e) => e.preventDefault());

  map.addEventListener('wheel', (e) => {
    e.preventDefault();
    stopAnimation();
    const unit = e.deltaMode === 1 ? 16 : 1;
    const rect = map.getBoundingClientRect();
    zoomAt(e.clientX - rect.left, e.clientY - rect.top, view.z * Math.exp(-e.deltaY * unit * 0.0015));
    stage.classList.add('is-moving');
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => stage.classList.remove('is-moving'), 150);
  }, { passive: false });

  window.addEventListener('resize', () => {
    const s = mapSize();
    if (lastSize === null) {
      fitToWindow();
      return;
    }
    // Keep the middle of the map where it was, at the same zoom.
    const oldScale = scale();
    const cx = (lastSize.w / 2 - view.x) / oldScale;
    const cy = (lastSize.h / 2 - view.y) / oldScale;
    computeFit();
    view.x = s.w / 2 - cx * scale();
    view.y = s.h / 2 - cy * scale();
    lastSize = s;
    schedule();
  });

  // ---- Panels ---------------------------------------------------------------------------------

  // A panel is a toggle button and a body. The body shows only while the panel is open.
  // onChange, when given, hears each choice the master makes with the toggle.
  function panel(className, label, toggleLabel, onChange) {
    const box = el('div', `panel ${className}`);
    const toggle = el('button', 'panel-toggle', { type: 'button', 'aria-label': toggleLabel, 'aria-expanded': 'false' }, label);
    const body = el('div', 'panel-body');
    const setOpen = (open) => {
      box.classList.toggle('open', open);
      toggle.setAttribute('aria-expanded', String(open));
    };
    toggle.addEventListener('click', () => {
      const open = !box.classList.contains('open');
      setOpen(open);
      if (onChange) onChange(open);
    });
    box.append(toggle, body);
    return { box, body, setOpen, isOpen: () => box.classList.contains('open') };
  }

  // The layers panel remembers whether the master left it open. Storage can be blocked: then the choice lasts one visit.
  function rememberedOpen() {
    try {
      return window.localStorage.getItem(LAYERS_KEY) === '1';
    } catch (err) {
      return false;
    }
  }

  function rememberOpen(open) {
    try {
      window.localStorage.setItem(LAYERS_KEY, open ? '1' : '0');
    } catch (err) {
      // Nothing to do: the panel still works for this visit.
    }
  }

  // Layers: one switch per layer present. Terrain is always shown. Stamps carry their layer, so they follow.
  function setLayer(name, on) {
    svg.querySelectorAll(`[data-layer="${name}"]`).forEach((node) => node.classList.toggle('is-off', !on));
  }

  function setLayersOpen(open) {
    layersPanel.setOpen(open);
    rememberOpen(open);
  }

  const layersPanel = panel('panel-layers', '☰', S.layersToggle, rememberOpen);
  layersPanel.setOpen(rememberedOpen());
  layersPanel.body.append(el('p', 'panel-title', null, S.layers));
  for (const name of data.layers) {
    const input = el('input', '', { type: 'checkbox', id: `layer-${name}`, 'aria-label': layerName(name) });
    input.checked = true;
    if (name === 'terrain') input.disabled = true;
    input.addEventListener('change', () => setLayer(name, input.checked));
    const row = el('label', 'row');
    row.append(input, document.createTextNode(` ${layerName(name)}`));
    if (name === 'terrain') row.append(el('span', 'note', null, ` (${S.alwaysOn})`));
    layersPanel.body.append(row);
  }

  // Search: up to eight places whose title contains the text, ignoring case and accents.
  const searchPanel = panel('panel-search', '⌕', S.searchToggle, (open) => {
    if (open) searchInput.focus({ preventScroll: true });
  });
  const searchInput = el('input', 'search-input', {
    type: 'search', 'aria-label': S.search, placeholder: S.search, autocomplete: 'off', spellcheck: 'false',
  });
  const results = el('ul', 'results', { role: 'list' });
  searchPanel.body.append(searchInput, results);

  function chooseFirstOrNone() {
    const first = results.querySelector('button.result');
    if (first) first.click();
  }

  function showResults() {
    results.replaceChildren();
    const query = norm(searchInput.value.trim());
    if (query === '') return;
    const hits = data.places.filter((p) => norm(p.title).includes(query)).slice(0, 8);
    if (hits.length === 0) {
      results.append(el('li', 'none', null, S.searchNone));
      return;
    }
    for (const place of hits) {
      const button = el('button', 'result', { type: 'button', 'aria-label': place.title }, place.title);
      button.addEventListener('click', () => choosePlace(place));
      const item = el('li');
      item.append(button);
      results.append(item);
    }
  }

  function choosePlace(place) {
    results.replaceChildren();
    searchInput.value = '';
    searchPanel.setOpen(false);
    animateCentre(Math.max(view.z, FOCUS_Z), place.at[0], place.at[1], 600);
    openPlace(place.id, nodes.get(place.id) || null);
  }

  searchInput.addEventListener('input', showResults);
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      chooseFirstOrNone();
    }
  });

  // Zoom buttons, for touch screens without a keyboard.
  const zoom = el('div', 'zoom');
  const zoomButton = (label, text, action) => {
    const button = el('button', '', { type: 'button', 'aria-label': label, title: label }, text);
    button.addEventListener('click', action);
    return button;
  };
  zoom.append(
    zoomButton(S.zoomIn, '+', () => zoomCentre(1.25)),
    zoomButton(S.zoomOut, '−', () => zoomCentre(1 / 1.25)),
    zoomButton(S.zoomFit, '⤢', fitToWindow),
  );

  // The vignette is drawn here, over the map and under the panels, so it follows the viewport, not the map.
  function vignetteNode() {
    const v = data.vignette;
    const node = el('div', 'vignette', { 'aria-hidden': 'true' });
    if (v && typeof v.color === 'string') {
      node.style.background = `radial-gradient(farthest-corner, ${rgba(v.color, 0)} 60%, ${rgba(v.color, v.opacity)} 100%)`;
    }
    return node;
  }

  // A hex colour with an alpha, for the gradient. A colour that is not hex becomes black.
  function rgba(hex, alpha) {
    const match = /^#([0-9a-f]{6})$/i.exec(String(hex));
    const n = match ? Number.parseInt(match[1], 16) : 0;
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  }

  // ---- Place card -----------------------------------------------------------------------------

  const card = el('section', 'card', { role: 'dialog', 'aria-labelledby': 'card-title' });
  let origin = null;

  function linkNode(place) {
    const link = place.link;
    if (!link) return null;
    const line = el('p', 'card-link');
    if (link.kind === 'url') {
      line.append(el('a', '', { href: link.href, rel: 'noopener' }, S.openEncyclopedia));
      return line;
    }
    if (window.parent !== window) {
      const button = el('button', 'card-action', { type: 'button', 'aria-label': S.openDocument }, S.openDocument);
      button.addEventListener('click', () => {
        window.parent.postMessage({ type: 'yllir-atlas-open', path: link.path }, '*');
      });
      line.append(button);
      return line;
    }
    line.append(el('span', 'note', null, `${S.documentPath}: `), el('code', '', null, link.path));
    return line;
  }

  function openPlace(id, node) {
    const place = places.get(id);
    if (!place) return;
    origin = node || null;
    card.replaceChildren();
    const head = el('div', 'card-head');
    const title = el('h2', 'card-title', { id: 'card-title', tabindex: '-1' }, place.title);
    const close = el('button', 'card-close', { type: 'button', 'aria-label': S.close, title: S.close }, '×');
    close.addEventListener('click', () => closeCard(true));
    head.append(title, close);
    card.append(head);
    if (place.summary) card.append(el('p', 'card-summary', null, place.summary));
    const link = linkNode(place);
    if (link) card.append(link);
    card.classList.add('is-open');
    title.focus({ preventScroll: true });
  }

  function closeCard(returnFocus) {
    const wasOpen = card.classList.contains('is-open');
    card.classList.remove('is-open');
    if (returnFocus && wasOpen && origin && typeof origin.focus === 'function') {
      origin.focus({ preventScroll: true });
    }
  }

  // ---- Keyboard -------------------------------------------------------------------------------

  // A click or tap outside an open panel closes it. The layers panel remembers that choice.
  document.addEventListener('pointerdown', (e) => {
    if (layersPanel.isOpen() && !layersPanel.box.contains(e.target)) setLayersOpen(false);
    if (searchPanel.isOpen() && !searchPanel.box.contains(e.target)) searchPanel.setOpen(false);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeCard(true);
      if (layersPanel.isOpen()) setLayersOpen(false);
      searchPanel.setOpen(false);
      return;
    }
    const typing = e.target && e.target.matches && e.target.matches('input, textarea');
    if (typing) return;
    const step = 60;
    if (e.key === '+' || e.key === '=') zoomCentre(1.25);
    else if (e.key === '-' || e.key === '_') zoomCentre(1 / 1.25);
    else if (e.key === '0') fitToWindow();
    else if (e.key === 'ArrowLeft') panBy(step, 0);
    else if (e.key === 'ArrowRight') panBy(-step, 0);
    else if (e.key === 'ArrowUp') panBy(0, step);
    else if (e.key === 'ArrowDown') panBy(0, -step);
    else return;
    e.preventDefault();
  });

  // ---- Start ----------------------------------------------------------------------------------

  function setUpPlaces() {
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', S.mapLabel);
    svg.querySelectorAll('g.place').forEach((node) => {
      const id = node.getAttribute('data-place');
      const place = places.get(id);
      nodes.set(id, node);
      node.setAttribute('tabindex', '0');
      node.setAttribute('role', 'button');
      node.setAttribute('aria-label', place ? place.title : id);
      node.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openPlace(id, node);
        }
      });
    });
  }

  function start() {
    setUpPlaces();
    // Panels, zoom buttons and the card sit outside the map, so the map's pointer capture never takes their clicks.
    document.body.append(vignetteNode(), zoom, layersPanel.box, searchPanel.box, card);
    fitToWindow();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
