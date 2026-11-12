// Tests for the ComfyUI client. The fetch implementation is always injected: no real server is called.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_URL, fillTemplate, probeComfyui, runComfyui } from './comfyui.mjs';

const TEMPLATES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const unreachableFetch = async () => {
  throw new TypeError('fetch failed');
};

function makeJobDir(job) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-comfyui-'));
  fs.writeFileSync(path.join(dir, 'job.json'), JSON.stringify(job));
  return dir;
}

const generateJob = (overrides = {}) => ({
  id: 'job-1',
  operation: 'generate',
  document: 'places/tower.md',
  prompt: 'a tower at dusk',
  negative: '',
  width: 512,
  height: 768,
  seed: 42,
  input: null,
  ...overrides,
});

test('templates are valid API-format workflows', () => {
  for (const name of ['generate.json', 'remove-background.json']) {
    const workflow = JSON.parse(fs.readFileSync(path.join(TEMPLATES_DIR, name), 'utf8'));
    for (const node of Object.values(workflow)) {
      assert.equal(typeof node.class_type, 'string');
      assert.equal(typeof node.inputs, 'object');
    }
  }
});

test('fillTemplate keeps the type of numbers and leaves longer strings alone', () => {
  const template = { a: { inputs: { width: '{{WIDTH}}', text: '{{PROMPT}}', label: 'size {{WIDTH}}', steps: 25 } } };
  const filled = fillTemplate(template, { WIDTH: 512, PROMPT: 'tower' });
  assert.deepEqual(filled, { a: { inputs: { width: 512, text: 'tower', label: 'size {{WIDTH}}', steps: 25 } } });
  assert.equal(typeof filled.a.inputs.width, 'number');
  assert.deepEqual(template.a.inputs.width, '{{WIDTH}}', 'template is not modified');
});

test('fillTemplate throws when a placeholder has no value', () => {
  assert.throws(() => fillTemplate({ a: { x: '{{MISSING}}' } }, {}), /MISSING/);
});

test('probe reports unreachable when fetch throws', async () => {
  const result = await probeComfyui({ fetchImpl: unreachableFetch });
  assert.equal(result.available, false);
  assert.equal(result.reason, 'unreachable');
  assert.equal(result.url, DEFAULT_URL);
  assert.equal(result.checkpoint, null);
});

test('probe reports unreachable on a non-200 status', async () => {
  const result = await probeComfyui({ fetchImpl: async () => new Response('no', { status: 500 }) });
  assert.equal(result.available, false);
  assert.equal(result.reason, 'unreachable');
});

test('probe lists checkpoints and detects the background removal node', async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith('/system_stats')) return json({ system: {} });
    if (url.endsWith('/object_info/CheckpointLoaderSimple')) {
      return json({ CheckpointLoaderSimple: { input: { required: { ckpt_name: [['a.safetensors', 'b.ckpt']] } } } });
    }
    if (url.endsWith('/object_info/InspyrenetRembg')) return json({ InspyrenetRembg: { input: {} } });
    return new Response('', { status: 404 });
  };
  const result = await probeComfyui({ fetchImpl });
  assert.equal(result.available, true);
  assert.equal(result.reason, null);
  assert.deepEqual(result.checkpoints, ['a.safetensors', 'b.ckpt']);
  assert.equal(result.checkpoint, 'a.safetensors');
  assert.equal(result.removeBackground, true);
});

test('probe reports no background removal when the node is missing', async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith('/system_stats')) return json({});
    if (url.endsWith('/object_info/CheckpointLoaderSimple')) {
      return json({ CheckpointLoaderSimple: { input: { required: { ckpt_name: [['a.safetensors']] } } } });
    }
    return new Response('{}', { status: 404 });
  };
  const result = await probeComfyui({ fetchImpl });
  assert.equal(result.available, true);
  assert.equal(result.removeBackground, false);
});

test('probe reports no-checkpoint when the server has no checkpoint', async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith('/system_stats')) return json({});
    return json({ CheckpointLoaderSimple: { input: { required: { ckpt_name: [[]] } } } });
  };
  const result = await probeComfyui({ fetchImpl });
  assert.equal(result.available, false);
  assert.equal(result.reason, 'no-checkpoint');
  assert.equal(result.checkpoint, null);
});

test('run generate writes result.png and run.json', async () => {
  const jobDir = makeJobDir(generateJob());
  const imageBytes = Buffer.from([137, 80, 78, 71, 1, 2, 3]);
  const posted = [];
  let historyCalls = 0;
  const fetchImpl = async (url, init = {}) => {
    if (url.endsWith('/prompt') && init.method === 'POST') {
      posted.push(JSON.parse(init.body));
      return json({ prompt_id: 'p-1' });
    }
    if (url.includes('/history/p-1')) {
      historyCalls++;
      if (historyCalls === 1) return json({});
      return json({
        'p-1': { status: { status_str: 'success', completed: true }, outputs: { 9: { images: [{ filename: 'yllir_00001_.png', subfolder: '', type: 'output' }] } } },
      });
    }
    if (url.includes('/view?')) {
      const query = new URL(url).searchParams;
      assert.equal(query.get('filename'), 'yllir_00001_.png');
      assert.equal(query.get('type'), 'output');
      return new Response(imageBytes, { status: 200 });
    }
    return new Response('', { status: 404 });
  };

  const result = await runComfyui({ jobDir, checkpoint: 'a.safetensors', templatesDir: TEMPLATES_DIR, fetchImpl, pollMs: 1 });
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(fs.readFileSync(path.join(jobDir, 'result.png')), imageBytes);

  const run = JSON.parse(fs.readFileSync(path.join(jobDir, 'run.json'), 'utf8'));
  assert.equal(run.provider, 'comfyui');
  assert.deepEqual(run.parameters, { checkpoint: 'a.safetensors', width: 512, height: 768, seed: 42, workflow: 'generate' });

  const workflow = posted[0].prompt;
  assert.equal(posted[0].client_id, 'yllir');
  assert.equal(workflow['4'].inputs.ckpt_name, 'a.safetensors');
  assert.equal(workflow['5'].inputs.width, 512);
  assert.equal(workflow['3'].inputs.seed, 42);
  assert.equal(workflow['6'].inputs.text, 'a tower at dusk');
});

test('run reports failed when history has an error status', async () => {
  const jobDir = makeJobDir(generateJob());
  const fetchImpl = async (url, init = {}) => {
    if (url.endsWith('/prompt') && init.method === 'POST') return json({ prompt_id: 'p-2' });
    if (url.includes('/history/p-2')) {
      return json({ 'p-2': { status: { status_str: 'error', completed: false }, outputs: {} } });
    }
    return new Response('', { status: 404 });
  };
  const result = await runComfyui({ jobDir, checkpoint: 'a.safetensors', templatesDir: TEMPLATES_DIR, fetchImpl, pollMs: 1 });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'failed');
  assert.equal(fs.existsSync(path.join(jobDir, 'result.png')), false);
});

test('run reports timeout when history never completes', async () => {
  const jobDir = makeJobDir(generateJob());
  const fetchImpl = async (url, init = {}) => {
    if (url.endsWith('/prompt') && init.method === 'POST') return json({ prompt_id: 'p-3' });
    if (url.includes('/history/p-3')) return json({});
    return new Response('', { status: 404 });
  };
  const result = await runComfyui({ jobDir, checkpoint: 'a.safetensors', templatesDir: TEMPLATES_DIR, fetchImpl, timeoutMs: 50, pollMs: 5 });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'timeout');
});

test('run reports unavailable when fetch throws', async () => {
  const jobDir = makeJobDir(generateJob());
  const result = await runComfyui({ jobDir, checkpoint: 'a.safetensors', templatesDir: TEMPLATES_DIR, fetchImpl: unreachableFetch, pollMs: 1 });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'unavailable');
  assert.match(result.message, /unreachable/);
});

test('run reports failed with the server text when the workflow is refused', async () => {
  const jobDir = makeJobDir(generateJob());
  const fetchImpl = async () => new Response('bad workflow', { status: 400 });
  const result = await runComfyui({ jobDir, checkpoint: 'a.safetensors', templatesDir: TEMPLATES_DIR, fetchImpl });
  assert.equal(result.error, 'failed');
  assert.match(result.message, /bad workflow/);
});

test('remove_background uploads the input and uses the returned name', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-comfyui-input-'));
  const input = path.join(dir, 'portrait.png');
  fs.writeFileSync(input, Buffer.from([137, 80, 78, 71]));
  const jobDir = makeJobDir({
    id: 'job-2',
    operation: 'remove_background',
    document: 'characters/a.md',
    prompt: '',
    negative: '',
    width: 512,
    height: 512,
    seed: 7,
    input,
  });

  const calls = [];
  let uploadedForm = null;
  let postedWorkflow = null;
  const fetchImpl = async (url, init = {}) => {
    calls.push(url);
    if (url.endsWith('/upload/image')) {
      uploadedForm = init.body;
      return json({ name: 'portrait-1.png', subfolder: 'uploads' });
    }
    if (url.endsWith('/prompt') && init.method === 'POST') {
      postedWorkflow = JSON.parse(init.body).prompt;
      return json({ prompt_id: 'p-4' });
    }
    if (url.includes('/history/p-4')) {
      return json({ 'p-4': { status: { completed: true }, outputs: { 3: { images: [{ filename: 'yllir_1.png', subfolder: '', type: 'output' }] } } } });
    }
    if (url.includes('/view?')) return new Response(Buffer.from([1, 2, 3]), { status: 200 });
    return new Response('', { status: 404 });
  };

  const result = await runComfyui({ jobDir, checkpoint: 'a.safetensors', templatesDir: TEMPLATES_DIR, fetchImpl, pollMs: 1 });
  assert.deepEqual(result, { ok: true });
  assert.ok(calls.some((url) => url.endsWith('/upload/image')), 'upload URL was called');
  assert.ok(uploadedForm instanceof FormData);
  assert.equal(uploadedForm.get('overwrite'), 'true');
  assert.equal(uploadedForm.get('image').name, 'portrait.png');
  assert.equal(postedWorkflow['1'].inputs.image, 'uploads/portrait-1.png');

  const run = JSON.parse(fs.readFileSync(path.join(jobDir, 'run.json'), 'utf8'));
  assert.equal(run.parameters.workflow, 'remove-background');
});
