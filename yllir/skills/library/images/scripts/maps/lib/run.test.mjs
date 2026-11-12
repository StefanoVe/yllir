import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import {
  ALLOWED_TOOLS,
  INSTALL_COMMIT,
  READY_SCHEMA,
  checkArgs,
  readReadyFile,
  resolveScript,
  runTool,
} from './run.mjs';

const MAPS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maps-run-'));
  const campaignRoot = path.join(root, 'campaign');
  const jobDir = path.join(campaignRoot, '.campaign', 'state', 'maps', 'job-1');
  fs.mkdirSync(jobDir, { recursive: true });
  const dataDir = path.join(root, 'data');
  const installDir = path.join(dataDir, 'third-party', 'agent-sprite-forge', INSTALL_COMMIT);
  const python = path.join(installDir, 'venv', 'bin', 'python');
  const generate2dmap = path.join(installDir, 'repo', 'skills', 'generate2dmap');
  fs.mkdirSync(path.dirname(python), { recursive: true });
  fs.writeFileSync(python, '');
  fs.mkdirSync(generate2dmap, { recursive: true });
  fs.writeFileSync(path.join(installDir, 'ready.json'), JSON.stringify({
    schema: READY_SCHEMA,
    commit: INSTALL_COMMIT,
    python,
    generate2dmap,
    generate2dmedia: path.join(installDir, 'repo', 'skills', 'generate2dmedia'),
    installed: '2026-11-11T00:00:00Z',
  }));
  return { root, campaignRoot, jobDir, dataDir, python, generate2dmap };
}

function fakeSpawn(calls, code = 0) {
  return (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    setImmediate(() => child.emit('close', code));
    return child;
  };
}

test('a tool outside the list is refused and nothing runs', async () => {
  const fx = makeFixture();
  try {
    for (const tool of ['route_media', 'forge_doctor', '../x']) {
      const calls = [];
      const result = await runTool({
        campaignRoot: fx.campaignRoot, jobId: 'job-1', dataDir: fx.dataDir,
        tool, args: [], spawnImpl: fakeSpawn(calls),
      });
      assert.deepEqual(result, { ok: false, error: 'tool-not-allowed' });
      assert.equal(calls.length, 0);
    }
    assert.equal(ALLOWED_TOOLS.includes('route_media'), false);
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});

test('an argument that points outside the job folder is refused', async () => {
  const fx = makeFixture();
  try {
    const calls = [];
    const result = await runTool({
      campaignRoot: fx.campaignRoot, jobId: 'job-1', dataDir: fx.dataDir,
      tool: 'map_bundle', args: ['--output-dir', '../../escape'], spawnImpl: fakeSpawn(calls),
    });
    assert.deepEqual(result, { ok: false, error: 'path-outside-job' });
    assert.equal(calls.length, 0);
    assert.equal(checkArgs(fx.jobDir, ['--output-dir', '../../escape']), '../../escape');
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});

test('a missing ready.json means the tools are not installed', async () => {
  const fx = makeFixture();
  try {
    const calls = [];
    const emptyData = path.join(fx.root, 'empty-data');
    const result = await runTool({
      campaignRoot: fx.campaignRoot, jobId: 'job-1', dataDir: emptyData,
      tool: 'map_nav', args: [], spawnImpl: fakeSpawn(calls),
    });
    assert.deepEqual(result, { ok: false, error: 'not-installed' });
    assert.equal(readReadyFile(emptyData), null);
    assert.equal(calls.length, 0);
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});

test('an allowed tool runs its generate2dmap script in the job folder with UTF-8 Python', async () => {
  const fx = makeFixture();
  try {
    const calls = [];
    const result = await runTool({
      campaignRoot: fx.campaignRoot, jobId: 'job-1', dataDir: fx.dataDir,
      tool: 'map_nav', args: ['--input', 'scene.png'], spawnImpl: fakeSpawn(calls),
    });
    assert.deepEqual(result, { ok: true });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].cmd, fx.python);
    assert.deepEqual(calls[0].args, [
      path.join(fx.generate2dmap, 'scripts', 'map_nav.py'),
      '--input',
      'scene.png',
    ]);
    assert.equal(calls[0].opts.cwd, fx.jobDir);
    assert.equal(calls[0].opts.env.PYTHONUTF8, '1');
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});

test('a non-zero exit code is reported as failed with the code', async () => {
  const fx = makeFixture();
  try {
    const result = await runTool({
      campaignRoot: fx.campaignRoot, jobId: 'job-1', dataDir: fx.dataDir,
      tool: 'map_nav', args: [], spawnImpl: fakeSpawn([], 3),
    });
    assert.deepEqual(result, { ok: false, code: 3 });
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});

test('map_grid resolves to map-grid.py beside maps-run.mjs', async () => {
  const fx = makeFixture();
  try {
    const ready = readReadyFile(fx.dataDir);
    const expected = path.join(MAPS_DIR, 'map-grid.py');
    assert.equal(resolveScript('map_grid', ready, MAPS_DIR), expected);
    assert.equal(fs.existsSync(expected), true);

    const calls = [];
    const result = await runTool({
      campaignRoot: fx.campaignRoot, jobId: 'job-1', dataDir: fx.dataDir,
      tool: 'map_grid', args: ['--input', 'scene.png'], spawnImpl: fakeSpawn(calls),
    });
    assert.deepEqual(result, { ok: true });
    assert.equal(calls[0].args[0], expected);
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});

test('a bad job id is refused', async () => {
  const fx = makeFixture();
  try {
    const calls = [];
    const result = await runTool({
      campaignRoot: fx.campaignRoot, jobId: 'A/B', dataDir: fx.dataDir,
      tool: 'map_nav', args: [], spawnImpl: fakeSpawn(calls),
    });
    assert.deepEqual(result, { ok: false, error: 'bad-job-id' });
    assert.equal(calls.length, 0);
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});
