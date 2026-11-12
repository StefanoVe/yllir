// Tests for the safe image downloader. The network is always a stub; files go to temp folders.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { downloadImage } from './fetch.mjs';

const PNG_HEADER = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_HEADER = [0xff, 0xd8, 0xff, 0xe0];
const WEBP_HEADER = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x24, 0x10, 0, 0]), Buffer.from('WEBP')]);

function imageBytes(header, size = 4096) {
  const body = Buffer.alloc(size - header.length, 7);
  return Buffer.concat([Buffer.from(header), body]);
}

function imageResponse(bytes, contentType = 'image/png') {
  return new Response(bytes, { status: 200, headers: { 'content-type': contentType } });
}

function redirectResponse(location, status = 301) {
  return new Response(null, { status, headers: { location } });
}

/** Stub fetch that answers each call with the next item of a list (a function is called with the URL). */
function stubFetch(answers) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const answer = answers.shift();
    if (answer === undefined) throw new Error('unexpected extra call');
    return typeof answer === 'function' ? answer(url) : answer;
  };
  return { fetchImpl, calls };
}

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'artwork-fetch-test-'));
}

const URL_OK = 'https://images.example.org/a.png';

test('saves a PNG with the real extension and the requested stem', async () => {
  const dest = path.join(tempDir(), 'job');
  const bytes = imageBytes(PNG_HEADER);
  const { fetchImpl, calls } = stubFetch([imageResponse(bytes, 'image/png')]);
  const result = await downloadImage({ url: URL_OK, destDir: dest, stem: 'cand-1', fetchImpl });
  assert.equal(result.ok, true);
  assert.equal(result.ext, '.png');
  assert.equal(result.file, path.join(dest, 'cand-1.png'));
  assert.equal(result.bytes, bytes.length);
  assert.deepEqual(fs.readFileSync(result.file), bytes);
  assert.equal(calls[0].init.redirect, 'manual');
});

test('saves a JPEG as .jpg and a WEBP as .webp', async () => {
  const dest = path.join(tempDir(), 'job');
  const jpeg = stubFetch([imageResponse(imageBytes(JPEG_HEADER), 'image/jpeg')]);
  const jpegResult = await downloadImage({ url: URL_OK, destDir: dest, stem: 'cand-1', fetchImpl: jpeg.fetchImpl });
  assert.equal(jpegResult.ok, true);
  assert.equal(jpegResult.ext, '.jpg');
  assert.ok(fs.existsSync(path.join(dest, 'cand-1.jpg')));

  const webp = stubFetch([imageResponse(imageBytes([...WEBP_HEADER]), 'image/webp; charset=binary')]);
  const webpResult = await downloadImage({ url: URL_OK, destDir: dest, stem: 'cand-2', fetchImpl: webp.fetchImpl });
  assert.equal(webpResult.ok, true);
  assert.equal(webpResult.ext, '.webp');
  assert.ok(fs.existsSync(path.join(dest, 'cand-2.webp')));
});

test('creates the destination folder when it is missing', async () => {
  const dest = path.join(tempDir(), 'deep', 'nested', 'job');
  const { fetchImpl } = stubFetch([imageResponse(imageBytes(PNG_HEADER))]);
  const result = await downloadImage({ url: URL_OK, destDir: dest, stem: 'cand-1', fetchImpl });
  assert.equal(result.ok, true);
  assert.ok(fs.existsSync(path.join(dest, 'cand-1.png')));
});

test('rejects http, localhost, IP literals and local host names before any request', async () => {
  const bad = [
    'http://images.example.org/a.png',
    'https://localhost/a.png',
    'https://sub.localhost/a.png',
    'https://127.0.0.1/a.png',
    'https://10.0.0.5/a.png',
    'https://0x7f.1/a.png',
    'https://[::1]/a.png',
    'https://printer.local/a.png',
    'https://service.internal/a.png',
    'ftp://images.example.org/a.png',
    'not a url',
  ];
  for (const url of bad) {
    const { fetchImpl, calls } = stubFetch([]);
    const result = await downloadImage({ url, destDir: tempDir(), stem: 'cand-1', fetchImpl });
    assert.equal(result.ok, false, url);
    assert.equal(result.error, 'bad-url', url);
    assert.equal(calls.length, 0, url);
  }
});

test('rejects a redirect to http', async () => {
  const { fetchImpl } = stubFetch([redirectResponse('http://images.example.org/b.png')]);
  const result = await downloadImage({ url: URL_OK, destDir: tempDir(), stem: 'cand-1', fetchImpl });
  assert.deepEqual([result.ok, result.error], [false, 'bad-redirect']);
});

test('rejects a redirect to a local host', async () => {
  const { fetchImpl } = stubFetch([redirectResponse('https://192.168.1.10/b.png')]);
  const result = await downloadImage({ url: URL_OK, destDir: tempDir(), stem: 'cand-1', fetchImpl });
  assert.deepEqual([result.ok, result.error], [false, 'bad-redirect']);
});

test('follows up to three redirects', async () => {
  const dest = tempDir();
  const { fetchImpl, calls } = stubFetch([
    redirectResponse('https://images.example.org/r1'),
    redirectResponse('https://images.example.org/r2', 302),
    redirectResponse('/r3', 307),
    imageResponse(imageBytes(PNG_HEADER)),
  ]);
  const result = await downloadImage({ url: URL_OK, destDir: dest, stem: 'cand-1', fetchImpl });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 4);
  assert.equal(calls[3].url, 'https://images.example.org/r3');
});

test('rejects a fourth redirect', async () => {
  const { fetchImpl } = stubFetch([
    redirectResponse('https://images.example.org/r1'),
    redirectResponse('https://images.example.org/r2'),
    redirectResponse('https://images.example.org/r3'),
    redirectResponse('https://images.example.org/r4'),
    imageResponse(imageBytes(PNG_HEADER)),
  ]);
  const result = await downloadImage({ url: URL_OK, destDir: tempDir(), stem: 'cand-1', fetchImpl });
  assert.deepEqual([result.ok, result.error], [false, 'bad-redirect']);
});

test('rejects a content type that is not png, jpeg or webp', async () => {
  const { fetchImpl } = stubFetch([imageResponse(imageBytes(PNG_HEADER), 'text/html')]);
  const result = await downloadImage({ url: URL_OK, destDir: tempDir(), stem: 'cand-1', fetchImpl });
  assert.deepEqual([result.ok, result.error], [false, 'bad-type']);
});

test('rejects bytes that do not match the declared type', async () => {
  const jpegAsPng = stubFetch([imageResponse(imageBytes(JPEG_HEADER), 'image/png')]);
  const mismatch = await downloadImage({ url: URL_OK, destDir: tempDir(), stem: 'cand-1', fetchImpl: jpegAsPng.fetchImpl });
  assert.deepEqual([mismatch.ok, mismatch.error], [false, 'bad-bytes']);

  const garbage = stubFetch([imageResponse(Buffer.alloc(4096, 0x41), 'image/jpeg')]);
  const unknown = await downloadImage({ url: URL_OK, destDir: tempDir(), stem: 'cand-1', fetchImpl: garbage.fetchImpl });
  assert.deepEqual([unknown.ok, unknown.error], [false, 'bad-bytes']);
});

test('rejects a body larger than the limit while reading', async () => {
  const dest = tempDir();
  const { fetchImpl } = stubFetch([imageResponse(imageBytes(PNG_HEADER, 6000))]);
  const result = await downloadImage({ url: URL_OK, destDir: dest, stem: 'cand-1', maxBytes: 5000, fetchImpl });
  assert.deepEqual([result.ok, result.error], [false, 'too-big']);
  assert.equal(fs.existsSync(path.join(dest, 'cand-1.png')), false);
});

test('rejects a declared content-length larger than the limit', async () => {
  const response = new Response(imageBytes(PNG_HEADER, 4096), {
    status: 200,
    headers: { 'content-type': 'image/png', 'content-length': '999999' },
  });
  const { fetchImpl } = stubFetch([response]);
  const result = await downloadImage({ url: URL_OK, destDir: tempDir(), stem: 'cand-1', maxBytes: 5000, fetchImpl });
  assert.deepEqual([result.ok, result.error], [false, 'too-big']);
});

test('rejects an image under 2 KB', async () => {
  const { fetchImpl } = stubFetch([imageResponse(imageBytes(PNG_HEADER, 1500))]);
  const result = await downloadImage({ url: URL_OK, destDir: tempDir(), stem: 'cand-1', fetchImpl });
  assert.deepEqual([result.ok, result.error], [false, 'too-small']);
});

test('gives timeout when the server never answers', async () => {
  const fetchImpl = () => new Promise(() => {});
  const started = Date.now();
  const result = await downloadImage({ url: URL_OK, destDir: tempDir(), stem: 'cand-1', fetchImpl, timeoutMs: 50 });
  assert.deepEqual([result.ok, result.error], [false, 'timeout']);
  assert.ok(Date.now() - started < 5000);
});

test('gives timeout when the body never arrives', async () => {
  const stalled = new ReadableStream({ pull() {} });
  const fetchImpl = async () => new Response(stalled, { status: 200, headers: { 'content-type': 'image/png' } });
  const result = await downloadImage({ url: URL_OK, destDir: tempDir(), stem: 'cand-1', fetchImpl, timeoutMs: 50 });
  assert.deepEqual([result.ok, result.error], [false, 'timeout']);
});

test('gives failed on a network error', async () => {
  const fetchImpl = async () => {
    throw new TypeError('fetch failed');
  };
  const result = await downloadImage({ url: URL_OK, destDir: tempDir(), stem: 'cand-1', fetchImpl });
  assert.deepEqual([result.ok, result.error], [false, 'failed']);
});

test('gives failed on a non-success HTTP status', async () => {
  const { fetchImpl } = stubFetch([new Response('missing', { status: 404 })]);
  const result = await downloadImage({ url: URL_OK, destDir: tempDir(), stem: 'cand-1', fetchImpl });
  assert.deepEqual([result.ok, result.error], [false, 'failed']);
});

test('never overwrites an existing file', async () => {
  const dest = tempDir();
  const existing = path.join(dest, 'cand-1.png');
  fs.writeFileSync(existing, 'original');
  const { fetchImpl } = stubFetch([imageResponse(imageBytes(PNG_HEADER))]);
  const result = await downloadImage({ url: URL_OK, destDir: dest, stem: 'cand-1', fetchImpl });
  assert.deepEqual([result.ok, result.error], [false, 'exists']);
  assert.equal(fs.readFileSync(existing, 'utf8'), 'original');
});

test('rejects a stem that is not a plain file name', async () => {
  for (const stem of ['../cand-1', 'a/b', '', '.hidden']) {
    const { fetchImpl, calls } = stubFetch([]);
    const result = await downloadImage({ url: URL_OK, destDir: tempDir(), stem, fetchImpl });
    assert.deepEqual([result.ok, result.error], [false, 'bad-stem'], stem);
    assert.equal(calls.length, 0);
  }
});
