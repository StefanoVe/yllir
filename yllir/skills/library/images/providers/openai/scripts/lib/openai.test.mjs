import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PNG_SIGNATURE } from '../../../../scripts/lib/png-signature.mjs';
import { OPENAI_MODELS, DEFAULT_MODEL, pickSize, probeOpenai, readOpenaiKey, readOpenaiModel, runOpenai, setOpenaiModel } from './openai.mjs';
import { readTable, writeTable } from '../../../../scripts/lib/providers.mjs';

const PNG = Buffer.concat([PNG_SIGNATURE, Buffer.from('fake-image-bytes')]);
const KEY = 'sk-test-SECRET-0123456789abcdef';

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function makeJob(extra = {}) {
  const jobDir = tempDir('yllir-openai-job-');
  const job = { operation: 'generate', prompt: 'a red fox', negative: 'text', width: 1536, height: 1024, ...extra };
  fs.writeFileSync(path.join(jobDir, 'job.json'), JSON.stringify(job));
  return jobDir;
}

function makeCampaign(keys = null) {
  const root = tempDir('yllir-openai-campaign-');
  if (keys !== null) {
    const dir = path.join(root, '.campaign', 'state');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'keys.json'), JSON.stringify(keys));
  }
  return root;
}

/** Fake fetch: records every call and answers with the given status and body text. */
function fakeFetch(status, body) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { ok: status >= 200 && status < 300, status, text: async () => body };
  };
  return { fetchImpl, calls };
}

const okBody = (bytes = PNG) => JSON.stringify({ data: [{ b64_json: bytes.toString('base64') }] });

test('success writes a valid PNG and run.json without the key', async () => {
  const root = makeCampaign();
  const jobDir = makeJob();
  const { fetchImpl } = fakeFetch(200, okBody());
  const result = await runOpenai({ campaignRoot: root, jobDir, env: { OPENAI_API_KEY: KEY }, fetchImpl });
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(fs.readFileSync(path.join(jobDir, 'result.png')), PNG);
  const runText = fs.readFileSync(path.join(jobDir, 'run.json'), 'utf8');
  assert.ok(!runText.includes(KEY));
  assert.deepEqual(JSON.parse(runText), {
    provider: 'openai',
    parameters: { width: 1536, height: 1024, model: DEFAULT_MODEL, size: '1536x1024' },
  });
});

test('key from the environment is used in the Authorization header', async () => {
  const root = makeCampaign();
  const { fetchImpl, calls } = fakeFetch(200, okBody());
  await runOpenai({ campaignRoot: root, jobDir: makeJob(), env: { OPENAI_API_KEY: KEY }, fetchImpl });
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${KEY}`);
});

test('key from keys.json entry openai is used when the environment has none', async () => {
  const root = makeCampaign({ openai: 'key-from-file' });
  const { fetchImpl, calls } = fakeFetch(200, okBody());
  const result = await runOpenai({ campaignRoot: root, jobDir: makeJob(), env: {}, fetchImpl });
  assert.equal(result.ok, true);
  assert.equal(calls[0].init.headers.Authorization, 'Bearer key-from-file');
});

test('readOpenaiKey accepts the legacy generate2dmedia entry and ignores bad files', () => {
  const legacy = makeCampaign({ generate2dmedia: { OPENAI_API_KEY: 'legacy-key' } });
  assert.equal(readOpenaiKey(legacy, {}), 'legacy-key');
  assert.equal(readOpenaiKey(makeCampaign(), {}), null);
  const broken = makeCampaign();
  fs.mkdirSync(path.join(broken, '.campaign', 'state'), { recursive: true });
  fs.writeFileSync(path.join(broken, '.campaign', 'state', 'keys.json'), '{ not json');
  assert.equal(readOpenaiKey(broken, {}), null);
});

test('no key gives unavailable and makes no network call', async () => {
  const root = makeCampaign();
  const { fetchImpl, calls } = fakeFetch(200, okBody());
  const result = await runOpenai({ campaignRoot: root, jobDir: makeJob(), env: {}, fetchImpl });
  assert.deepEqual(result, { ok: false, error: 'unavailable', message: 'no-key: set OPENAI_API_KEY in the environment' });
  assert.equal(calls.length, 0);
});

test('401 gives failed and the key never appears in the message', async () => {
  const root = makeCampaign();
  const { fetchImpl } = fakeFetch(401, `invalid key ${KEY}`);
  const result = await runOpenai({ campaignRoot: root, jobDir: makeJob(), env: { OPENAI_API_KEY: KEY }, fetchImpl });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'failed');
  assert.equal(result.message, 'the service refused the key');
  assert.ok(!result.message.includes(KEY));
});

test('HTTP 500 with the key echoed in the body hides the key as ***', async () => {
  const root = makeCampaign();
  const { fetchImpl } = fakeFetch(500, `server error for ${KEY}\nplease retry`);
  const result = await runOpenai({ campaignRoot: root, jobDir: makeJob(), env: { OPENAI_API_KEY: KEY }, fetchImpl });
  assert.equal(result.error, 'failed');
  assert.equal(result.message, 'HTTP 500: server error for *** please retry');
  assert.ok(!result.message.includes(KEY));
});

test('a response without b64_json gives failed', async () => {
  const root = makeCampaign();
  const { fetchImpl } = fakeFetch(200, JSON.stringify({ data: [{ url: 'https://example.invalid/x.png' }] }));
  const jobDir = makeJob();
  const result = await runOpenai({ campaignRoot: root, jobDir, env: { OPENAI_API_KEY: KEY }, fetchImpl });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'failed');
  assert.match(result.message, /b64_json/);
  assert.equal(fs.existsSync(path.join(jobDir, 'result.png')), false);
});

test('non-PNG bytes give failed and no result file', async () => {
  const root = makeCampaign();
  const { fetchImpl } = fakeFetch(200, okBody(Buffer.from('not an image at all')));
  const jobDir = makeJob();
  const result = await runOpenai({ campaignRoot: root, jobDir, env: { OPENAI_API_KEY: KEY }, fetchImpl });
  assert.deepEqual(result, { ok: false, error: 'failed', message: 'output is not a PNG' });
  assert.equal(fs.existsSync(path.join(jobDir, 'result.png')), false);
});

test('request body has model, size, output_format png and the Authorization header', async () => {
  const root = makeCampaign();
  const { fetchImpl, calls } = fakeFetch(200, okBody());
  await runOpenai({
    campaignRoot: root,
    jobDir: makeJob({ prompt: 'a castle', negative: null, width: 512, height: 768 }),
    env: { OPENAI_API_KEY: KEY },
    fetchImpl,
    model: 'gpt-image-custom',
  });
  const { url, init } = calls[0];
  assert.equal(url, 'https://api.openai.com/v1/images/generations');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers.Authorization, `Bearer ${KEY}`);
  assert.equal(init.headers['Content-Type'], 'application/json');
  const body = JSON.parse(init.body);
  assert.deepEqual(body, {
    model: 'gpt-image-custom',
    prompt: 'a castle',
    size: '1024x1536',
    n: 1,
    output_format: 'png',
  });
  assert.equal(body.response_format, undefined);
});

test('negative text is added to the prompt as an avoid line', async () => {
  const root = makeCampaign();
  const { fetchImpl, calls } = fakeFetch(200, okBody());
  await runOpenai({ campaignRoot: root, jobDir: makeJob({ prompt: 'a fox', negative: 'text' }), env: { OPENAI_API_KEY: KEY }, fetchImpl });
  assert.equal(JSON.parse(calls[0].init.body).prompt, 'a fox\n\nAvoid: text');
});

test('pickSize: square within 10%, landscape, portrait', () => {
  assert.equal(pickSize(1024, 1024), '1024x1024');
  assert.equal(pickSize(1000, 1050), '1024x1024');
  assert.equal(pickSize(1100, 1000), '1024x1024');
  assert.equal(pickSize(1536, 1024), '1536x1024');
  assert.equal(pickSize(1920, 1000), '1536x1024');
  assert.equal(pickSize(512, 768), '1024x1536');
  assert.equal(pickSize(800, 1200), '1024x1536');
});

test('probeOpenai is available with a key and reports no-key without one, with no network call', () => {
  const root = makeCampaign();
  assert.deepEqual(probeOpenai({ campaignRoot: root, env: { OPENAI_API_KEY: KEY } }), { available: true, reason: null });
  assert.deepEqual(probeOpenai({ campaignRoot: makeCampaign(), env: {} }), { available: false, reason: 'no-key' });
  assert.deepEqual(probeOpenai({ campaignRoot: makeCampaign({ openai: 'k' }), env: {} }), { available: true, reason: null });
});

test('an unsupported operation gives unsupported without a call', async () => {
  const root = makeCampaign();
  const { fetchImpl, calls } = fakeFetch(200, okBody());
  const result = await runOpenai({
    campaignRoot: root,
    jobDir: makeJob({ operation: 'remove_background' }),
    env: { OPENAI_API_KEY: KEY },
    fetchImpl,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'unsupported');
  assert.equal(calls.length, 0);
});

test('a network error gives unavailable and a stalled call gives timeout', async () => {
  const root = makeCampaign();
  const unreachable = async () => {
    throw new TypeError('fetch failed');
  };
  const down = await runOpenai({ campaignRoot: root, jobDir: makeJob(), env: { OPENAI_API_KEY: KEY }, fetchImpl: unreachable });
  assert.equal(down.error, 'unavailable');

  const stalled = (url, init) =>
    new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => {
        const err = new Error('aborted');
        err.name = 'AbortError';
        reject(err);
      });
    });
  const slow = await runOpenai({
    campaignRoot: root,
    jobDir: makeJob(),
    env: { OPENAI_API_KEY: KEY },
    fetchImpl: stalled,
    timeoutMs: 20,
  });
  assert.deepEqual(slow, { ok: false, error: 'timeout', message: 'the service did not answer in time' });
});

test('the stored model is used in the request body when no model option is given', async () => {
  const root = makeCampaign();
  setOpenaiModel(root, 'gpt-image-1-mini');
  const { fetchImpl, calls } = fakeFetch(200, okBody());
  const result = await runOpenai({ campaignRoot: root, jobDir: makeJob(), env: { OPENAI_API_KEY: KEY }, fetchImpl });
  assert.equal(result.ok, true);
  assert.equal(JSON.parse(calls[0].init.body).model, 'gpt-image-1-mini');
});

test('an explicit model option wins over the stored model', async () => {
  const root = makeCampaign();
  setOpenaiModel(root, 'gpt-image-1-mini');
  const { fetchImpl, calls } = fakeFetch(200, okBody());
  await runOpenai({ campaignRoot: root, jobDir: makeJob(), env: { OPENAI_API_KEY: KEY }, fetchImpl, model: 'gpt-image-1.5' });
  assert.equal(JSON.parse(calls[0].init.body).model, 'gpt-image-1.5');
});

test('with nothing stored the default model is used', async () => {
  const root = makeCampaign();
  const { fetchImpl, calls } = fakeFetch(200, okBody());
  await runOpenai({ campaignRoot: root, jobDir: makeJob(), env: { OPENAI_API_KEY: KEY }, fetchImpl });
  assert.equal(JSON.parse(calls[0].init.body).model, DEFAULT_MODEL);
});

test('setOpenaiModel keeps the consent and the other fields of the openai entry', () => {
  const root = makeCampaign();
  writeTable(root, { checked: 'old', providers: { openai: { available: true, reason: null, consent: true } } });
  setOpenaiModel(root, 'gpt-image-1.5');
  assert.deepEqual(readTable(root).providers.openai, { available: true, reason: null, consent: true, model: 'gpt-image-1.5' });
  assert.equal(readTable(root).checked, 'old');
  assert.equal(readOpenaiModel(root), 'gpt-image-1.5');
});

test('setOpenaiModel creates the openai entry and rejects an unknown id without changing the table', () => {
  const root = makeCampaign();
  setOpenaiModel(root, OPENAI_MODELS[0].id);
  assert.equal(readOpenaiModel(root), OPENAI_MODELS[0].id);
  assert.throws(() => setOpenaiModel(root, 'dall-e-9'), /unknown model/);
  assert.equal(readOpenaiModel(root), OPENAI_MODELS[0].id);
});

test('readOpenaiModel is null without a table, without a model, or with a bad model value', () => {
  assert.equal(readOpenaiModel(makeCampaign()), null);

  const noModel = makeCampaign();
  writeTable(noModel, { providers: { openai: { available: false, reason: 'no-key' } } });
  assert.equal(readOpenaiModel(noModel), null);

  const empty = makeCampaign();
  writeTable(empty, { providers: { openai: { model: '' } } });
  assert.equal(readOpenaiModel(empty), null);

  const notText = makeCampaign();
  writeTable(notText, { providers: { openai: { model: 5 } } });
  assert.equal(readOpenaiModel(notText), null);

  const broken = makeCampaign();
  fs.mkdirSync(path.join(broken, '.campaign', 'state'), { recursive: true });
  fs.writeFileSync(path.join(broken, '.campaign', 'state', 'image-providers.json'), '{ not json');
  assert.equal(readOpenaiModel(broken), null);
});
