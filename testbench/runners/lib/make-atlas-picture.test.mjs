// Offline tests of the atlas test pictures and of the fake Codex script: the pictures are deterministic,
// they round-trip through PNG, the fake script is executable and it copies the picture where a job asks,
// through the real codex client of the images skill.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  GREEN,
  LAKE,
  MORVALLE_SIZE,
  SEA,
  TOWN_SIZE,
  makeMorvallePicture,
  makeTownPicture,
  writeFakeCodex,
  writePictures,
} from './make-atlas-picture.mjs';
import { decodePng, encodePngRgba } from '../../../yllir/skills/library/atlas/scripts/lib/image.mjs';
import { runCodex } from '../../../yllir/skills/library/images/providers/codex/scripts/lib/codex.mjs';

function pixel(image, x, y) {
  const p = (y * image.width + x) * 4;
  return [...image.data.subarray(p, p + 3)];
}

function scratch() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-picture-test-'));
}

test('the Morvalle picture has its size, the sea, the island, the lake and the second island', () => {
  const image = makeMorvallePicture();
  assert.equal(image.width, MORVALLE_SIZE.width);
  assert.equal(image.height, MORVALLE_SIZE.height);
  assert.deepEqual(pixel(image, 0, 0), SEA.slice(0, 3));
  assert.deepEqual(pixel(image, 200, 215), GREEN.slice(0, 3));
  assert.deepEqual(pixel(image, 205, 135), LAKE.slice(0, 3));
  assert.deepEqual(pixel(image, 330, 250), GREEN.slice(0, 3));
  assert.deepEqual(pixel(image, 120, 160), GREEN.slice(0, 3));
});

test('the town picture has its size, the sea and one green island and nothing else', () => {
  const image = makeTownPicture();
  assert.equal(image.width, TOWN_SIZE.width);
  assert.equal(image.height, TOWN_SIZE.height);
  assert.deepEqual(pixel(image, 0, 0), SEA.slice(0, 3));
  assert.deepEqual(pixel(image, 180, 150), GREEN.slice(0, 3));
  const colours = new Set();
  for (let p = 0; p < image.data.length; p += 4) colours.add(`${image.data[p]},${image.data[p + 1]},${image.data[p + 2]}`);
  assert.equal(colours.size, 2);
});

test('the pictures are deterministic and round-trip through PNG', () => {
  const first = encodePngRgba(makeMorvallePicture());
  const second = encodePngRgba(makeMorvallePicture());
  assert.ok(first.equals(second));
  const back = decodePng(first);
  assert.equal(back.width, MORVALLE_SIZE.width);
  assert.equal(back.height, MORVALLE_SIZE.height);
  assert.deepEqual(Buffer.from(back.data), Buffer.from(makeMorvallePicture().data));
  const town = decodePng(encodePngRgba(makeTownPicture()));
  assert.equal(town.width, TOWN_SIZE.width);
});

test('writePictures writes morvalle.png and town.png that decode to the picture sizes', () => {
  const dir = scratch();
  try {
    const files = writePictures(path.join(dir, 'pictures'));
    assert.ok(fs.readFileSync(files.morvalle).subarray(1, 4).toString() === 'PNG');
    assert.equal(decodePng(fs.readFileSync(files.morvalle)).width, MORVALLE_SIZE.width);
    assert.equal(decodePng(fs.readFileSync(files.town)).height, TOWN_SIZE.height);
    assert.ok(fs.readFileSync(files.town).equals(encodePngRgba(makeTownPicture())));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the fake codex is executable, answers --version and copies the picture to the job path', async () => {
  const dir = scratch();
  try {
    const picture = writePictures(path.join(dir, 'pictures')).morvalle;
    const bin = writeFakeCodex(path.join(dir, 'bin'), picture);
    assert.ok((fs.statSync(bin).mode & 0o111) !== 0, 'the script is executable');
    assert.match(execFileSync(bin, ['--version'], { encoding: 'utf8' }), /fake-codex/);

    const jobDir = path.join(dir, 'job');
    fs.mkdirSync(jobDir);
    fs.writeFileSync(path.join(jobDir, 'job.json'), JSON.stringify({ operation: 'generate', prompt: 'una mappa', negative: '', width: 400, height: 300 }));
    const result = await runCodex({ jobDir, command: bin, timeoutMs: 20000, stallMs: 20000 });
    assert.deepEqual(result, { ok: true });
    assert.ok(fs.readFileSync(path.join(jobDir, 'result.png')).equals(fs.readFileSync(picture)));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
