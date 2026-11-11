import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { campaignProvidersDir } from './campaign-providers.mjs';
import { getPath, placeholderValues, runCommandProvider, runHttpProvider } from './custom-run.mjs';

const roots = [];
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const PNG_B64 = PNG.toString('base64');
const KEY = 'k-123';
const ADDED = '2026-11-11T10:00:00Z';

after(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

function newRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-custom-run-'));
  roots.push(root);
  return root;
}

function writeFiles(dir, files) {
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
}

function providerDir(root, id) {
  return path.join(campaignProvidersDir(root), id);
}

function newJob(root, overrides = {}) {
  const jobDir = path.join(root, 'jobs', `job-${Math.random().toString(36).slice(2)}`);
  const job = {
    id: 'job-1',
    operation: 'generate',
    document: 'npc-test',
    style: 'plain',
    prompt: 'a red fox in the snow',
    negative: 'text',
    width: 512,
    height: 512,
    seed: 7,
    input: null,
    ...overrides,
  };
  writeFiles(jobDir, { 'job.json': JSON.stringify(job) });
  return jobDir;
}

// The fake program lives in the job folder and is named relatively, so the
// absolute temp path never appears in provider.yaml (the secret check flags long paths).
function commandProvider(root, id, { script, operations = ['generate'] }) {
  const exec = process.execPath;
  writeFiles(providerDir(root, id), {
    'provider.yaml': [
      `id: ${id}`,
      'name: "Test command"',
      'kind: command',
      'operations:',
      ...operations.map((op) => `  - "${op}"`),
      'external: true',
      `added: "${ADDED}"`,
      'command:',
      `  - "${exec}"`,
      `  - "${script}"`,
      '  - "{PROMPT}"',
      '  - "{OUTPUT}"',
      'probe:',
      `  - "${exec}"`,
      '  - "--version"',
      '',
    ].join('\n'),
  });
}

function httpProvider(root, id, { request, keyEnv = 'TEST_IMG_KEY', operations = ['generate'] }) {
  writeFiles(providerDir(root, id), {
    'provider.yaml': [
      `id: ${id}`,
      'name: "Test http"',
      'kind: http',
      'operations:',
      ...operations.map((op) => `  - "${op}"`),
      'external: true',
      `added: "${ADDED}"`,
      `key_env: ${keyEnv}`,
      '',
    ].join('\n'),
    'request.json': JSON.stringify(request),
  });
}

const HTTP_REQUEST_BASE64 = {
  method: 'POST',
  url: 'https://img.example.test/v1/generate',
  headers: { 'x-api-key': '{KEY}', 'content-type': 'application/json' },
  body: { prompt: '{PROMPT}', size: '{WIDTH}x{HEIGHT}' },
  response: { base64: 'data.0.b64' },
};

const HTTP_REQUEST_URL = {
  ...HTTP_REQUEST_BASE64,
  response: { url: 'data.0.url' },
};

function fakeScript(body) {
  return `import fs from 'node:fs';\nconst prompt = process.argv[2];\nconst output = process.argv[3];\n${body}\n`;
}

test('command provider writes a PNG and run.json', async () => {
  const root = newRoot();
  commandProvider(root, 'test-png', { script: 'fake-png.mjs' });
  const jobDir = newJob(root);
  writeFiles(jobDir, {
    'fake-png.mjs': fakeScript(`fs.writeFileSync('prompt.txt', prompt);
fs.writeFileSync(output, Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]), Buffer.from('data')]));`),
  });

  const result = await runCommandProvider({ root, jobDir, id: 'test-png' });
  assert.deepEqual(result, { ok: true });
  assert.equal(fs.readFileSync(path.join(jobDir, 'prompt.txt'), 'utf8'), 'a red fox in the snow');
  const run = JSON.parse(fs.readFileSync(path.join(jobDir, 'run.json'), 'utf8'));
  assert.deepEqual(run, { provider: 'test-png', parameters: { width: 512, height: 512 } });
  assert.equal(fs.existsSync(path.join(jobDir, 'result.png')), true);
});

test('command provider output that is not a PNG fails', async () => {
  const root = newRoot();
  commandProvider(root, 'test-jpeg', { script: 'fake-jpeg.mjs' });
  const jobDir = newJob(root);
  writeFiles(jobDir, {
    'fake-jpeg.mjs': fakeScript(`fs.writeFileSync(output, Buffer.from([0xff,0xd8,0xff,0xe0,0x00,0x10]));`),
  });
  const result = await runCommandProvider({ root, jobDir, id: 'test-jpeg' });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'failed');
  assert.equal(result.message, 'output is not a PNG');
  assert.equal(fs.existsSync(path.join(jobDir, 'run.json')), false);
});

test('command provider exit with an error keeps the last log line', async () => {
  const root = newRoot();
  commandProvider(root, 'test-quota', { script: 'fake-quota.mjs' });
  const jobDir = newJob(root);
  writeFiles(jobDir, {
    'fake-quota.mjs': fakeScript(`process.stderr.write('quota exhausted\\n'); process.exit(2);`),
  });
  const result = await runCommandProvider({ root, jobDir, id: 'test-quota' });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'failed');
  assert.ok(result.message.includes('quota'), result.message);
});

test('command provider that prints nothing times out', async () => {
  const root = newRoot();
  commandProvider(root, 'test-hang', { script: 'fake-hang.mjs' });
  const jobDir = newJob(root);
  writeFiles(jobDir, {
    'fake-hang.mjs': fakeScript(`setInterval(() => {}, 1000);`),
  });
  const result = await runCommandProvider({ root, jobDir, id: 'test-hang', stallMs: 200 });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'timeout');
});

test('command provider that does not support the operation is unsupported', async () => {
  const root = newRoot();
  commandProvider(root, 'test-generate-only', { script: 'fake-png.mjs' });
  const jobDir = newJob(root, { operation: 'remove_background' });
  const result = await runCommandProvider({ root, jobDir, id: 'test-generate-only' });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'unsupported');
});

test('command provider with a missing program is unavailable', async () => {
  const root = newRoot();
  writeFiles(providerDir(root, 'test-missing'), {
    'provider.yaml': [
      'id: test-missing', 'name: "Missing"', 'kind: command', 'operations:', '  - "generate"',
      'external: true', `added: "${ADDED}"`, 'command:', '  - "yllir-no-such-program-xyz"', '  - "{OUTPUT}"',
      'probe:', '  - "yllir-no-such-program-xyz"', '',
    ].join('\n'),
  });
  const jobDir = newJob(root);
  const result = await runCommandProvider({ root, jobDir, id: 'test-missing' });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'unavailable');
});

test('http provider reads the key and returns base64 output', async () => {
  const root = newRoot();
  httpProvider(root, 'test-http', { request: HTTP_REQUEST_BASE64 });
  const jobDir = newJob(root);
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ data: [{ b64: PNG_B64 }] }), { status: 200 });
  };
  const result = await runHttpProvider({
    root, jobDir, id: 'test-http', env: { TEST_IMG_KEY: KEY }, fetchImpl,
  });
  assert.deepEqual(result, { ok: true });
  assert.equal(calls.length, 1);
  assert.ok(calls[0].init.headers['x-api-key'].includes(KEY));
  assert.ok(calls[0].init.body.includes('a red fox in the snow'));
  assert.deepEqual(fs.readFileSync(path.join(jobDir, 'result.png')), PNG);
  const runText = fs.readFileSync(path.join(jobDir, 'run.json'), 'utf8');
  assert.equal(runText.includes(KEY), false);
  assert.deepEqual(JSON.parse(runText), { provider: 'test-http', parameters: { width: 512, height: 512 } });
});

test('http provider without the key is unavailable and makes no call', async () => {
  const root = newRoot();
  httpProvider(root, 'test-http', { request: HTTP_REQUEST_BASE64 });
  const jobDir = newJob(root);
  let called = false;
  const result = await runHttpProvider({
    root, jobDir, id: 'test-http', env: {},
    fetchImpl: async () => { called = true; return new Response('', { status: 200 }); },
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'unavailable');
  assert.equal(called, false);
});

test('http provider 403 fails without the key in the message', async () => {
  const root = newRoot();
  httpProvider(root, 'test-http', { request: HTTP_REQUEST_BASE64 });
  const jobDir = newJob(root);
  const result = await runHttpProvider({
    root, jobDir, id: 'test-http', env: { TEST_IMG_KEY: KEY },
    fetchImpl: async () => new Response(`denied for ${KEY}`, { status: 403 }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'failed');
  assert.equal(result.message, 'the service refused the key');
  assert.equal(result.message.includes(KEY), false);
});

test('http provider 500 hides the key echoed in the response', async () => {
  const root = newRoot();
  httpProvider(root, 'test-http', { request: HTTP_REQUEST_BASE64 });
  const jobDir = newJob(root);
  const result = await runHttpProvider({
    root, jobDir, id: 'test-http', env: { TEST_IMG_KEY: KEY },
    fetchImpl: async () => new Response(`server error while using ${KEY}`, { status: 500 }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'failed');
  assert.ok(result.message.includes('HTTP 500'), result.message);
  assert.ok(result.message.includes('***'), result.message);
  assert.equal(result.message.includes(KEY), false);
});

test('http provider with a URL in the response downloads the image', async () => {
  const root = newRoot();
  httpProvider(root, 'test-http-url', { request: HTTP_REQUEST_URL });
  const jobDir = newJob(root);
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    if (url === 'https://img.example.test/v1/generate') {
      return new Response(JSON.stringify({ data: [{ url: 'https://cdn.example.test/out.png' }] }), { status: 200 });
    }
    return new Response(PNG, { status: 200 });
  };
  const result = await runHttpProvider({
    root, jobDir, id: 'test-http-url', env: { TEST_IMG_KEY: KEY }, fetchImpl,
  });
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(urls, ['https://img.example.test/v1/generate', 'https://cdn.example.test/out.png']);
  assert.deepEqual(fs.readFileSync(path.join(jobDir, 'result.png')), PNG);
});

test('placeholderValues fills the job fields and reads the input file', () => {
  const root = newRoot();
  const input = path.join(root, 'in.bin');
  fs.writeFileSync(input, 'abc');
  const jobDir = path.join(root, 'job');
  const values = placeholderValues({ prompt: 'p', negative: null, width: 64, height: 32, input }, jobDir, 'kk');
  assert.equal(values.PROMPT, 'p');
  assert.equal(values.NEGATIVE, '');
  assert.equal(values.OUTPUT, path.join(jobDir, 'result.png'));
  assert.equal(values.INPUT_BASE64, Buffer.from('abc').toString('base64'));
  assert.equal(values.WIDTH, '64');
  assert.equal(values.HEIGHT, '32');
  assert.equal(values.KEY, 'kk');
  assert.equal(placeholderValues({ prompt: 'p', width: 1, height: 1 }, jobDir).INPUT_BASE64, '');
});

test('getPath walks objects and array indexes', () => {
  const data = { a: { 0: 'zero' }, list: [{ b: 'deep' }] };
  assert.equal(getPath({ x: [{ y: 'v' }] }, 'x.0.y'), 'v');
  assert.equal(getPath(data, 'list.0.b'), 'deep');
  assert.equal(getPath(data, 'a.0'), 'zero');
  assert.equal(getPath(data, 'missing.0'), undefined);
});
