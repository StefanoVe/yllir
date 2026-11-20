import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SIZES, defaultSize, lotSvg, buildingSvg, namedSize, towerSvg, gateSvg } from './urban-assets.mjs';
import { loadStyle } from './styles.mjs';

const LOT_KINDS = ['house', 'rowhouse', 'shop', 'barn'];
const BUILDING_KINDS = ['tavern', 'inn', 'temple', 'shrine', 'palace', 'castle', 'keep', 'tower', 'mill', 'warehouse', 'market', 'guildhall', 'smithy', 'house', 'shop', 'gatehouse', 'landmark'];
const STYLES = ['fantasy-color', 'antique-parchment', 'dark-fantasy'];

const urbanOf = (id) => loadStyle(id).style.urban;
const urban = urbanOf('fantasy-color');
const AT = [120.25, 80];

test('DEFAULT_SIZES covers every building and lot kind with a positive size', () => {
  for (const kind of [...BUILDING_KINDS, ...LOT_KINDS]) {
    const [w, h] = DEFAULT_SIZES[kind];
    assert.ok(w > 0 && h > 0, `${kind} has a size`);
  }
  assert.deepEqual(defaultSize('house'), [10, 8]);
  assert.deepEqual(defaultSize('temple'), [26, 34]);
  assert.deepEqual(defaultSize('keep'), [30, 30]);
  assert.deepEqual(defaultSize('tower'), [14, 14]);
});

test('defaultSize returns a copy and falls back to the house size for an unknown kind', () => {
  const size = defaultSize('temple');
  size[0] = 999;
  assert.equal(defaultSize('temple')[0], 26);
  assert.deepEqual(defaultSize('no-such-kind'), [10, 8]);
});

test('lotSvg is a non-empty group in the roof colour of its kind, and deterministic', () => {
  for (const kind of LOT_KINDS) {
    const svg = lotSvg({ kind, at: AT, angle: 0.5, urban });
    assert.ok(svg.length > 0);
    assert.ok(svg.includes(urban.roof[kind]), `${kind} uses its roof colour`);
    assert.ok(svg.includes(urban.outline), 'the ridge and outline use the outline colour');
    assert.equal(svg, lotSvg({ kind, at: AT, angle: 0.5, urban }));
  }
  assert.ok(lotSvg({ kind: 'no-such-kind', at: AT, urban }).includes(urban.roof.house), 'unknown kind uses the house roof');
});

test('buildingSvg has a mark for each named kind and the roof colour, and is deterministic', () => {
  for (const kind of BUILDING_KINDS) {
    const svg = buildingSvg({ kind, at: AT, angle: 0, urban });
    assert.ok(svg.length > 0);
    assert.ok(svg.includes(urban.roof[kind]), `${kind} uses its roof colour`);
    assert.equal(svg, buildingSvg({ kind, at: AT, angle: 0, urban }));
  }
  const plain = buildingSvg({ kind: 'no-such-kind', at: AT, urban });
  assert.ok(plain.includes(urban.roof.house), 'unknown kind is the base in the house roof colour');
  assert.ok(!plain.includes('<circle') && !plain.includes('<path'), 'unknown kind has no mark');
});

test('a temple is cross-shaped, a castle has four turrets, a mill has four blades', () => {
  assert.ok(buildingSvg({ kind: 'temple', at: AT, urban }).includes('<path'));
  assert.equal((buildingSvg({ kind: 'castle', at: AT, urban }).match(/<rect/g) ?? []).length, 1 + 4);
  assert.ok(buildingSvg({ kind: 'mill', at: AT, urban }).includes('<circle'));
});

test('towerSvg is a stone circle with the wall colours, and is deterministic', () => {
  const svg = towerSvg({ at: AT, radius: 4, urban });
  assert.ok(svg.startsWith('<circle'));
  assert.ok(svg.includes(urban.wall.stone) && svg.includes(urban.wall.outline));
  assert.equal(svg, towerSvg({ at: AT, radius: 4, urban }));
});

test('gateSvg has posts and a gap line in the wall colours, and is deterministic', () => {
  const svg = gateSvg({ at: AT, angle: 1.2, width: 6, urban });
  assert.ok(svg.length > 0);
  assert.equal((svg.match(/<rect/g) ?? []).length, 2, 'two posts');
  assert.ok(svg.includes(urban.wall.stone) && svg.includes(urban.wall.outline));
  assert.equal(svg, gateSvg({ at: AT, angle: 1.2, width: 6, urban }));
  assert.ok(gateSvg({ at: AT, urban }).length > 0, 'angle and width have defaults');
});

test('every symbol rounds its numbers to one decimal and carries no ids', () => {
  const samples = [
    lotSvg({ kind: 'barn', at: [1.2345, 9.87], angle: 0.7, urban }),
    buildingSvg({ kind: 'keep', at: [3.14159, 2.71828], angle: 0.3, urban }),
    towerSvg({ at: [5.55555, 6.66666], radius: 2.22222, urban }),
    gateSvg({ at: [7.77777, 8.88888], angle: 2.1, width: 5.55, urban }),
  ];
  for (const svg of samples) {
    // Fixed style literals (stroke widths and opacities) are not coordinates, so they are left out.
    const geometry = svg.replace(/(stroke-width|opacity)="[^"]*"/g, '');
    assert.equal(/\d\.\d{2,}/.test(geometry), false, `no more than one decimal in ${svg}`);
    assert.equal(/\sid=/.test(svg), false, 'no ids');
  }
});

test('each symbol takes the colours of the style it is given', () => {
  for (const id of STYLES) {
    const style = urbanOf(id);
    assert.ok(lotSvg({ kind: 'house', at: AT, urban: style }).includes(style.roof.house), `${id} lot`);
    assert.ok(buildingSvg({ kind: 'castle', at: AT, urban: style }).includes(style.roof.castle), `${id} building`);
    assert.ok(towerSvg({ at: AT, radius: 3, urban: style }).includes(style.wall.stone), `${id} tower`);
    assert.ok(gateSvg({ at: AT, urban: style }).includes(style.wall.outline), `${id} gate`);
  }
});

test('a named building is drawn at least 1.6 times its default size', () => {
  assert.deepEqual(namedSize('temple'), [41.6, 54.4]);
  assert.deepEqual(namedSize('tavern'), [25.6, 19.2]);
  assert.deepEqual(namedSize('house', [30, 20]), [30, 20], 'a larger given size is kept');
});

test('a named building with a given size is never below 14 x 14', () => {
  assert.deepEqual(namedSize('shrine', [5, 5]), [14, 14]);
  assert.deepEqual(namedSize('house', [5, 40]), [16, 40]);
  assert.deepEqual(namedSize('house', undefined), [16, 12.8], 'without a given size only the 1.6 rule applies');
  assert.deepEqual(namedSize('house', [-3, 'x']), [16, 12.8], 'invalid sizes are ignored');
});
