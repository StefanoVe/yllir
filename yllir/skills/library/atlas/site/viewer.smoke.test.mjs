// Smoke test of viewer.js in a minimal fake DOM: the script runs without errors and creates one marker per place.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { STRINGS } from '../scripts/lib/strings.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, 'viewer.js'), 'utf8');

class FakeNode {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.attributes = {};
    this.classes = new Set();
    this.style = {};
    this.listeners = {};
    this.textContent = '';
  }

  get className() {
    return [...this.classes].join(' ');
  }

  set className(value) {
    this.classes = new Set(String(value).split(/\s+/).filter(Boolean));
  }

  get classList() {
    const self = this;
    return {
      add: (...names) => names.forEach((n) => self.classes.add(n)),
      remove: (...names) => names.forEach((n) => self.classes.delete(n)),
      contains: (n) => self.classes.has(n),
      toggle(n, force) {
        const on = force === undefined ? !self.classes.has(n) : Boolean(force);
        if (on) self.classes.add(n);
        else self.classes.delete(n);
        return on;
      },
    };
  }

  setAttribute(key, value) {
    this.attributes[key] = String(value);
  }

  getAttribute(key) {
    return key in this.attributes ? this.attributes[key] : null;
  }

  append(...nodes) {
    this.children.push(...nodes);
  }

  replaceChildren() {
    this.children = [];
  }

  addEventListener(type, fn) {
    (this.listeners[type] ||= []).push(fn);
  }

  querySelectorAll(tag) {
    const out = [];
    const walk = (node) => {
      for (const child of node.children) {
        if (child.tag === tag) out.push(child);
        walk(child);
      }
    };
    walk(this);
    return out;
  }

  querySelector(tag) {
    return this.querySelectorAll(tag)[0] || null;
  }

  focus() {}
  closest() {
    return null;
  }
  matches() {
    return false;
  }
  contains() {
    return false;
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 0, height: 0 };
  }
}

const DATA = {
  canvas: { width: 1000, height: 800 },
  lang: 'en',
  strings: STRINGS.en,
  layers: ['borders', 'labels', 'places'],
  places: [
    { id: 'p1', name: 'Borgo', x: 810, y: 640, kind: 'village', summary: 'A village.', sources: [{ file: 'World/Borgo.md' }], url: null, parent: 'Region' },
    { id: 'p2', name: 'Città', x: 300, y: 200, kind: 'city', summary: null, sources: [], url: 'https://example.test/entry', parent: null },
    { id: 'p3', name: 'Rovine', x: 500, y: 400, kind: 'ruin', summary: '', sources: [], url: null, parent: null },
  ],
  audience: 'master',
};

function installFakeDom(dataJson) {
  const created = [];
  const byId = {};
  const doc = {
    readyState: 'complete',
    documentElement: new FakeNode('html'),
    body: new FakeNode('body'),
    createElement(tag) {
      const node = new FakeNode(tag);
      created.push(node);
      return node;
    },
    createTextNode(text) {
      const node = new FakeNode('#text');
      node.textContent = text;
      return node;
    },
    getElementById(id) {
      return byId[id] || null;
    },
    addEventListener() {},
    elementFromPoint() {
      return null;
    },
  };

  const script = new FakeNode('script');
  script.textContent = dataJson;
  byId['atlas-data'] = script;
  const map = new FakeNode('div');
  map.clientWidth = 800;
  map.clientHeight = 600;
  const stage = new FakeNode('div');
  stage.append(new FakeNode('svg'));
  map.append(stage);
  byId.map = map;
  byId.stage = stage;

  const frames = [];
  const window = {
    addEventListener() {},
    localStorage: { getItem: () => null, setItem() {} },
  };
  globalThis.document = doc;
  globalThis.window = window;
  globalThis.requestAnimationFrame = (cb) => frames.push(cb);
  globalThis.cancelAnimationFrame = () => {};
  return {
    created,
    flushFrames() {
      while (frames.length) frames.shift()(0);
    },
  };
}

function removeFakeDom() {
  delete globalThis.document;
  delete globalThis.window;
  delete globalThis.requestAnimationFrame;
  delete globalThis.cancelAnimationFrame;
}

test('viewer creates one marker per place without errors', () => {
  const dom = installFakeDom(JSON.stringify(DATA));
  try {
    assert.doesNotThrow(() => vm.runInThisContext(source, { filename: 'viewer.js' }));
    dom.flushFrames();
    const markers = dom.created.filter((n) => n.tag === 'button' && n.classes.has('marker'));
    assert.equal(markers.length, 3);
    assert.match(markers[0].style.transform, /^translate\(/);
    for (const marker of markers) {
      const place = DATA.places.find((p) => p.id === marker.getAttribute('data-place'));
      assert.equal(marker.getAttribute('data-kind'), place.kind);
    }
  } finally {
    removeFakeDom();
  }
});

test('viewer source has no removed modes and compiles', () => {
  for (const word of ['urban', 'mixed', 'seaTexture', 'bake']) {
    assert.ok(!source.includes(word), `viewer.js must not mention "${word}"`);
  }
  assert.doesNotThrow(() => new vm.Script(source));
});
