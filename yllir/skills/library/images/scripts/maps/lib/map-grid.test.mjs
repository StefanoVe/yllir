import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Runs only when YLLIR_TEST_PYTHON points to a Python with Pillow installed.
const PYTHON = process.env.YLLIR_TEST_PYTHON;
const SKIP = !PYTHON;
const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'map-grid.py');

function runGrid(dir, output, cell) {
  const input = path.join(dir, 'input.png');
  if (!fs.existsSync(input)) {
    const made = spawnSync(PYTHON, [
      '-c',
      'import sys; from PIL import Image; Image.new("RGB", (128, 64), (200, 200, 200)).save(sys.argv[1])',
      input,
    ], { encoding: 'utf8' });
    assert.equal(made.status, 0, made.stderr);
  }
  return spawnSync(PYTHON, [
    SCRIPT, '--input', input, '--output', output, '--cell', String(cell),
  ], { encoding: 'utf8' });
}

test('map-grid counts the cells of a 128x64 map with cell 32', { skip: SKIP }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'map-grid-'));
  try {
    const result = runGrid(dir, path.join(dir, 'out.png'), 32);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const line = result.stdout.trim().split('\n').pop();
    const json = JSON.parse(line);
    assert.equal(json.status, 'pass');
    assert.equal(json.cols, 4);
    assert.equal(json.rows, 2);
    assert.equal(json.cell, 32);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('map-grid gives identical bytes for the same input', { skip: SKIP }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'map-grid-'));
  try {
    const first = path.join(dir, 'first.png');
    const second = path.join(dir, 'second.png');
    assert.equal(runGrid(dir, first, 32).status, 0);
    assert.equal(runGrid(dir, second, 32).status, 0);
    assert.ok(fs.readFileSync(first).equals(fs.readFileSync(second)));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('map-grid creates the missing output folder', { skip: SKIP }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'map-grid-'));
  try {
    const output = path.join(dir, 'grid', 'nested', 'map-grid.png');
    const result = runGrid(dir, output, 32);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(fs.existsSync(output), true);
    assert.equal(JSON.parse(result.stdout.trim().split('\n').pop()).cols, 4);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('map-grid refuses a cell that does not divide the image', { skip: SKIP }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'map-grid-'));
  try {
    const result = runGrid(dir, path.join(dir, 'out.png'), 30);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /^error: /m);
    assert.equal(fs.existsSync(path.join(dir, 'out.png')), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
