// Viewer of the atlas site: pan and zoom of the inline map, the infinite sea, the layer switches,
// the search and the place card. Vanilla browser JavaScript, no libraries. The page data is read from
// #atlas-data; every piece of text on screen comes from its `strings`, so the viewer chooses no language.
(function () {
  'use strict';

  const MIN_Z = 1 / 1.5; // zoom relative to fit-to-window
  const MAX_Z = 12;
  const URBAN_ZOOM = 8; // an urban map zooms in about 8 times further than a geographic one
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
  // The scale of the atlas (set by export.mjs): 'urban' is a purely urban map, with no infinite sea, and it zooms in
  // further; 'mixed' is a geographic map with urban layers, so it has the sea, the notable-place markers and the
  // high zoom; 'geo' is a geographic map. Markers are for the places that have a kind (buildings and districts).
  const urban = data.scale === 'urban';
  const mixed = data.scale === 'mixed';
  const hasSea = !urban;
  // A baked map (data.bake, see export.mjs) has no place icons: every place with a point gets a marker, the urban one,
  // so the places stay findable. Without a bake nothing changes.
  const bake = data.bake === true;
  const hasMarkers = urban || mixed || bake;
  const maxZ = urban || mixed ? MAX_Z * URBAN_ZOOM : MAX_Z;

  if (hasSea) sea.style.backgroundImage = `url("${ASSET_BASE}${data.seaTexture}")`;
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
  const clampZ = (z) => Math.min(maxZ, Math.max(MIN_Z, z));
  const mapSize = () => ({ w: map.clientWidth, h: map.clientHeight });

  function render() {
    frame = null;
    const s = scale();
    stage.style.transform = `translate(${view.x}px, ${view.y}px) scale(${s})`;
    if (hasSea) {
      const tile = data.seaTile * s;
      sea.style.backgroundSize = `${tile}px ${tile}px`;
      sea.style.backgroundPosition = `${view.x}px ${view.y}px`;
    }
    if (hasMarkers) placeMarkers(s);
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
    // A duration of zero (reduced motion) jumps to the place at once.
    if (ms <= 0) {
      view.z = to.z;
      view.x = to.x;
      view.y = to.y;
      schedule();
      return;
    }
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
    // A press on a marker is left to the marker's own click; a drag that starts there still pans the map.
    const onMarker = Boolean(e.target && e.target.closest && e.target.closest('.marker'));
    if (!onMarker) {
      try {
        map.setPointerCapture(e.pointerId);
      } catch (err) {
        // Capture is an aid for drags that leave the map; a failure changes nothing else.
      }
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
    const hit = document.elementFromPoint(e.clientX, e.clientY);
    // A marker opens its own card on click, so a tap on it is not a map tap (and not a double tap either).
    if (hit && hit.closest && hit.closest('.marker')) return;
    const now = performance.now();
    if (lastTap && now - lastTap.t < TAP_MS && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < TAP_PX) {
      lastTap = null;
      const rect = map.getBoundingClientRect();
      zoomAt(e.clientX - rect.left, e.clientY - rect.top, view.z * 2);
      return;
    }
    lastTap = { t: now, x: e.clientX, y: e.clientY };
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
    const scopes = markerBox ? [svg, markerBox] : [svg];
    for (const scope of scopes) {
      scope.querySelectorAll(`[data-layer="${name}"]`).forEach((node) => node.classList.toggle('is-off', !on));
    }
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
    markPressed(id);
    title.focus({ preventScroll: true });
  }

  function closeCard(returnFocus) {
    const wasOpen = card.classList.contains('is-open');
    card.classList.remove('is-open');
    markPressed(null);
    if (returnFocus && wasOpen && origin && typeof origin.focus === 'function') {
      origin.focus({ preventScroll: true });
    }
  }

  // ---- Urban markers --------------------------------------------------------------------------

  // One button per notable place (a place record with an anchor and a kind: a building or a district), drawn over
  // the map. Its size and symbol are the same at every zoom: only its position follows the map. A symbol is a few
  // stroked paths on a 24-unit grid; a kind without one is a plain dot.
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const TOWER = 'M8 20V8h8v12 M6 8h12 M8 8V5h2v3 M14 8V5h2v3 M11 20v-4h2v4';
  const MUG = 'M5 7h10v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z M15 9h2a2 2 0 0 1 0 4h-2';
  const CROSS = 'M12 5v14 M7 10h10';
  const SYMBOLS = new Map([
    ['tavern', MUG],
    ['inn', MUG],
    ['temple', CROSS],
    ['shrine', CROSS],
    ['palace', 'M4 17L3.5 8 8 11l4-6 4 6 4.5-3L20 17z'],
    ['castle', TOWER],
    ['keep', TOWER],
    ['tower', TOWER],
    ['mill', 'M12 6a6 6 0 1 0 0 12 6 6 0 1 0 0-12z M12 6v12 M6 12h12'],
    ['market', 'M4 9h16 M5 9v10h14V9 M4 9l2-4h12l2 4 M9 19v-5h6v5'],
    ['warehouse', 'M4 8l8-4 8 4v10H4z M4 8l8 4 8-4 M12 12v8'],
    ['guildhall', 'M6 5h12v7c0 3.5-3 6-6 7-3-1-6-3.5-6-7z'],
    ['smithy', 'M3 8h13 M16 8h4 M6 8v3h7V8 M9 11v4 M6 15h7'],
    ['gatehouse', 'M6 20V11a6 6 0 0 1 12 0v9 M10 20v-5a2 2 0 0 1 4 0v5'],
    ['district', 'M6 20V4 M6 5h11l-2.5 3.5L17 12H6'],
  ]);
  const DOT = 'M12 12h.01';

  let markerBox = null;
  let markerList = []; // { id, at, node } for each marker

  function symbolNode(kind) {
    const icon = document.createElementNS(SVG_NS, 'svg');
    icon.setAttribute('class', 'marker-icon');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('aria-hidden', 'true');
    icon.setAttribute('focusable', 'false');
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', SYMBOLS.get(kind) || DOT);
    icon.append(path);
    return icon;
  }

  function markerNode(place) {
    const district = place.kind === 'district';
    const button = el('button', district ? 'marker is-district' : 'marker', {
      type: 'button',
      'aria-label': place.title,
      'aria-pressed': 'false',
      'data-place': place.id,
      'data-layer': district ? 'districts' : 'buildings',
    });
    const disc = el('span', 'marker-disc');
    disc.append(symbolNode(place.kind));
    // The name is shown on hover and focus only; the button's aria-label already names it for a screen reader.
    button.append(disc, el('span', 'marker-name', { 'aria-hidden': 'true' }, place.title));
    button.addEventListener('click', () => openFromMarker(place, button));
    return button;
  }

  function buildMarkers() {
    markerBox = el('div', 'markers', { role: 'group', 'aria-label': S.notablePlaces });
    for (const place of data.places) {
      if (!Array.isArray(place.at) || (!place.kind && !bake)) continue;
      const node = markerNode(place);
      markerBox.append(node);
      markerList.push({ id: place.id, at: place.at, node });
    }
    map.append(markerBox);
  }

  // Positions every marker at its canvas point under the current pan and zoom (the stage's own transform).
  function placeMarkers(s) {
    for (const marker of markerList) {
      const x = view.x + marker.at[0] * s;
      const y = view.y + marker.at[1] * s;
      marker.node.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    }
  }

  // The card of the marker's place opens and the map centres softly on it; reduced motion means no glide.
  function openFromMarker(place, button) {
    const reduce = Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    animateCentre(Math.max(view.z, FOCUS_Z), place.at[0], place.at[1], reduce ? 0 : 600);
    openPlace(place.id, button);
  }

  // The marker of the open card reports aria-pressed; every other marker reports it released.
  function markPressed(id) {
    for (const marker of markerList) marker.node.setAttribute('aria-pressed', String(marker.id === id));
  }

  // ---- Keyboard-------------------------------------------------------------------------------

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
      // A place with a marker (a building or a district, on an urban or a mixed map) is reached through the marker,
      // so the drawn place is not in the tab order. The other places are.
      const marked = urban || Boolean(place && (place.kind || bake));
      if (!marked) {
        node.setAttribute('tabindex', '0');
        node.setAttribute('role', 'button');
      }
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
    if (urban) {
      document.documentElement.classList.add('is-urban');
      document.body.classList.add('is-urban');
    }
    if (hasMarkers) buildMarkers();
    // Panels, zoom buttons and the card sit outside the map, so the map's pointer capture never takes their clicks.
    document.body.append(vignetteNode(), zoom, layersPanel.box, searchPanel.box, card);
    fitToWindow();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
