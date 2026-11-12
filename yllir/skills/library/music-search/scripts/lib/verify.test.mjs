import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_URL_LENGTH, checkUrl, extractTitle, parseHosts, verifyLink } from './verify.mjs';

const HOSTS = ['youtube.com', 'youtu.be', 'archive.org'];
const OK_HTML = '<html><head><title>Harbor Rain Ambience - YouTube Music</title></head><body></body></html>';

/** A fake fetch that answers from a queue, and records the calls it got. */
function fakeFetch(answers) {
  const calls = [];
  const queue = [...answers];
  const impl = async (url, init) => {
    calls.push({ url, init });
    const next = queue.shift();
    if (next === undefined) throw new Error('no more answers');
    if (next instanceof Error) throw next;
    return typeof next === 'function' ? next(url, init) : next;
  };
  return { impl, calls };
}

const html = (body, status = 200) => new Response(body, { status, headers: { 'content-type': 'text/html' } });
const redirect = (location, status = 302) => new Response('', { status, headers: { location } });

test('checkUrl accepts an https link on an allowed host and its subdomains', () => {
  assert.equal(checkUrl('https://www.youtube.com/watch?v=abc', HOSTS).ok, true);
  assert.equal(checkUrl('https://music.youtube.com/watch?v=abc', HOSTS).ok, true);
  assert.equal(checkUrl('https://youtu.be/abc', HOSTS).ok, true);
  assert.equal(checkUrl('https://youtube.com:443/x', HOSTS).ok, true);
});

test('checkUrl refuses what the rules forbid', () => {
  const cases = [
    ['http://youtube.com/x', 'not-https'],
    ['https://user:pw@youtube.com/x', 'userinfo'],
    ['https://youtube.com:8443/x', 'port'],
    ['https://10.0.0.1/x', 'private-address'],
    ['https://8.8.8.8/x', 'ip-address'],
    ['https://[::1]/x', 'ip-address'],
    ['https://localhost/x', 'local-host'],
    ['https://printer.local/x', 'local-host'],
    ['https://evilyoutube.com/x', 'host-not-allowed'],
    ['https://youtube.com.evil.example/x', 'host-not-allowed'],
    ['https://example.com/x', 'host-not-allowed'],
    ['https://youtube.com/a b', 'bad-url'],
    ['not a url', 'bad-url'],
    ['', 'bad-url'],
    [`https://youtube.com/${'a'.repeat(MAX_URL_LENGTH)}`, 'url-too-long'],
  ];
  for (const [url, reason] of cases) {
    const result = checkUrl(url, HOSTS);
    assert.equal(result.ok, false, url);
    assert.equal(result.reason, reason, url);
  }
});

test('parseHosts accepts a plain list of host names and refuses anything else', () => {
  assert.deepEqual(parseHosts(['YouTube.com', 'youtube.com']), { ok: true, hosts: ['youtube.com'] });
  assert.equal(parseHosts([]).ok, false);
  assert.equal(parseHosts({ a: 1 }).ok, false);
  assert.equal(parseHosts(['https://youtube.com']).ok, false);
  assert.equal(parseHosts([42]).ok, false);
});

test('extractTitle reads the title tag, decodes entities, falls back to og:title', () => {
  assert.equal(extractTitle('<title>Rock &amp; Roll &#39;Night&#39;</title>'), "Rock & Roll 'Night'");
  assert.equal(extractTitle('<meta property="og:title" content="Calm Harbor">'), 'Calm Harbor');
  assert.equal(extractTitle("<meta content='Calm Harbor' property='og:title'>"), 'Calm Harbor');
  assert.equal(extractTitle('<html><body>no title</body></html>'), null);
  assert.equal(extractTitle('<title>   </title>'), null);
});

test('a 200 page with a title is verified', async () => {
  const { impl, calls } = fakeFetch([html(OK_HTML)]);
  const result = await verifyLink('https://www.youtube.com/watch?v=abc', { hosts: HOSTS, fetchImpl: impl });
  assert.deepEqual(result, {
    ok: true,
    finalUrl: 'https://www.youtube.com/watch?v=abc',
    status: 200,
    title: 'Harbor Rain Ambience - YouTube Music',
  });
  assert.equal(calls.length, 1);
});

test('the request is manual-redirect, generic User-Agent, no cookie, no body', async () => {
  const { impl, calls } = fakeFetch([html(OK_HTML)]);
  await verifyLink('https://youtu.be/abc', { hosts: HOSTS, fetchImpl: impl });
  const init = calls[0].init;
  assert.equal(init.redirect, 'manual');
  assert.equal(init.method, 'GET');
  assert.equal(init.headers['User-Agent'], 'yllir-music-check');
  assert.equal(init.headers.Cookie, undefined);
  assert.equal(init.headers.cookie, undefined);
  assert.equal(init.body, undefined);
});

test('redirects are followed within the rules and the final URL is reported', async () => {
  const { impl, calls } = fakeFetch([
    redirect('/watch?v=final'),
    html(OK_HTML),
  ]);
  const result = await verifyLink('https://youtu.be/short', { hosts: HOSTS, fetchImpl: impl });
  assert.equal(result.ok, true);
  assert.equal(result.finalUrl, 'https://youtu.be/watch?v=final');
  assert.equal(calls[1].url, 'https://youtu.be/watch?v=final');
});

test('a redirect to a host outside the list is refused and not followed', async () => {
  const { impl, calls } = fakeFetch([redirect('https://evil.example/x')]);
  const result = await verifyLink('https://youtu.be/short', { hosts: HOSTS, fetchImpl: impl });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'redirect-host-not-allowed');
  assert.equal(calls.length, 1);
});

test('a redirect to http or to a private address is refused', async () => {
  const http = await verifyLink('https://youtu.be/a', {
    hosts: HOSTS,
    fetchImpl: fakeFetch([redirect('http://youtube.com/x')]).impl,
  });
  assert.equal(http.reason, 'redirect-not-https');
  const priv = await verifyLink('https://youtu.be/a', {
    hosts: HOSTS,
    fetchImpl: fakeFetch([redirect('https://192.168.1.1/x')]).impl,
  });
  assert.equal(priv.reason, 'redirect-private-address');
});

test('more than three redirects are refused', async () => {
  const answers = [1, 2, 3, 4].map((i) => redirect(`/hop${i}`));
  const result = await verifyLink('https://youtu.be/start', { hosts: HOSTS, fetchImpl: fakeFetch(answers).impl });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'too-many-redirects');
});

test('exactly three redirects are allowed', async () => {
  const answers = [redirect('/h1'), redirect('/h2'), redirect('/h3'), html(OK_HTML)];
  const result = await verifyLink('https://youtu.be/start', { hosts: HOSTS, fetchImpl: fakeFetch(answers).impl });
  assert.equal(result.ok, true);
});

test('a redirect without a location is refused', async () => {
  const result = await verifyLink('https://youtu.be/a', {
    hosts: HOSTS,
    fetchImpl: fakeFetch([new Response('', { status: 301 })]).impl,
  });
  assert.equal(result.reason, 'bad-redirect');
});

test('a status other than 200 is not verified', async () => {
  const result = await verifyLink('https://youtu.be/a', {
    hosts: HOSTS,
    fetchImpl: fakeFetch([html('gone', 404)]).impl,
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 404);
  assert.equal(result.reason, 'http-404');
});

test('a page without a title, or with only the service name, is not verified', async () => {
  const none = await verifyLink('https://youtu.be/a', { hosts: HOSTS, fetchImpl: fakeFetch([html('<p>x</p>')]).impl });
  assert.equal(none.reason, 'no-title');
  const generic = await verifyLink('https://youtu.be/a', {
    hosts: HOSTS,
    fetchImpl: fakeFetch([html('<title>YouTube</title>')]).impl,
  });
  assert.equal(generic.reason, 'generic-title');
});

test('only the first 200 KB of the page are read', async () => {
  let pulled = 0;
  const chunk = new Uint8Array(16 * 1024).fill(0x20);
  const stream = new ReadableStream({
    pull(controller) {
      pulled += chunk.length;
      controller.enqueue(chunk);
    },
  });
  const endless = new Response(stream, { status: 200 });
  const limit = 64 * 1024;
  const result = await verifyLink('https://youtu.be/a', {
    hosts: HOSTS,
    maxBytes: limit,
    fetchImpl: fakeFetch([endless]).impl,
  });
  assert.equal(result.reason, 'no-title');
  // The reader stops at the limit; the stream may run one or two chunks ahead.
  assert.ok(pulled <= limit + 3 * chunk.length, `pulled ${pulled} bytes`);
});

test('a title that lies beyond 200 KB is not seen', async () => {
  const body = `<html>${'x'.repeat(250 * 1024)}<title>Late</title>`;
  const result = await verifyLink('https://youtu.be/a', { hosts: HOSTS, fetchImpl: fakeFetch([html(body)]).impl });
  assert.equal(result.reason, 'no-title');
});

test('a fetch that never answers times out', async () => {
  const hang = () => new Promise(() => {});
  const result = await verifyLink('https://youtu.be/a', {
    hosts: HOSTS,
    timeoutMs: 20,
    fetchImpl: (url, init) => {
      return new Promise((resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('aborted')));
        hang();
      });
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'timeout');
});

test('a network error is reported as such', async () => {
  const result = await verifyLink('https://youtu.be/a', {
    hosts: HOSTS,
    fetchImpl: fakeFetch([new Error('ECONNRESET')]).impl,
  });
  assert.equal(result.reason, 'network');
});

test('no allow list means nothing is verified and nothing is fetched', async () => {
  const { impl, calls } = fakeFetch([html(OK_HTML)]);
  const result = await verifyLink('https://youtu.be/a', { hosts: [], fetchImpl: impl });
  assert.equal(result.reason, 'hosts-unavailable');
  assert.equal(calls.length, 0);
});

test('a refused link is never fetched', async () => {
  const { impl, calls } = fakeFetch([html(OK_HTML)]);
  const result = await verifyLink('https://evil.example/a', { hosts: HOSTS, fetchImpl: impl });
  assert.equal(result.reason, 'host-not-allowed');
  assert.equal(calls.length, 0);
});
