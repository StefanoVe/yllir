import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  fetchNews,
  fetchPublishedVersion,
  NEWS_DOWNLOAD_PREFIX,
  NEWS_LIMIT,
  NEWS_LIST_URL,
  PLUGIN_MANIFEST_URL,
  type FetchText,
} from './source.js';

const url = (name: string) => `${NEWS_DOWNLOAD_PREFIX}StefanoVe/yllir/main/yllir/news/${name}`;

/** A fake source: a map from URL to body; any other URL fails the way the network would. */
function source(files: Record<string, string>): FetchText & { calls: string[] } {
  const calls: string[] = [];
  const get = (async (u: string) => {
    calls.push(u);
    if (!(u in files)) throw new Error(`no such file: ${u}`);
    return files[u];
  }) as FetchText & { calls: string[] };
  get.calls = calls;
  return get;
}

function listing(names: string[]): string {
  return JSON.stringify(names.map((name) => ({ name, download_url: url(name) })));
}

describe('fetchPublishedVersion', () => {
  it('reads the version of the published plugin manifest', async () => {
    const get = source({ [PLUGIN_MANIFEST_URL]: JSON.stringify({ name: 'yllir', version: '1.2.0' }) });
    assert.equal(await fetchPublishedVersion(get), '1.2.0');
    assert.deepEqual(get.calls, [PLUGIN_MANIFEST_URL]);
  });

  it('throws when the manifest is not JSON or has no usable version', async () => {
    await assert.rejects(fetchPublishedVersion(source({ [PLUGIN_MANIFEST_URL]: 'not json' })));
    await assert.rejects(fetchPublishedVersion(source({ [PLUGIN_MANIFEST_URL]: '{"version":"1.2"}' })));
  });
});

describe('fetchNews', () => {
  it('joins the news of the versions after the installed one, up to the published one, oldest first', async () => {
    const get = source({
      [NEWS_LIST_URL]: listing(['1.1.0.md', '1.2.0.md', '1.3.0.md', '1.2.5.md', 'README.md']),
      [url('1.2.0.md')]: 'First change.\n',
      [url('1.2.5.md')]: '  Second change.  ',
    });
    const news = await fetchNews(get, { installed: '1.1.0', published: '1.2.5', language: 'en' });
    assert.equal(news, 'First change.\n\nSecond change.');
    assert.ok(!get.calls.includes(url('1.3.0.md')), 'versions above the published one are not read');
    assert.ok(!get.calls.includes(url('1.1.0.md')), 'the installed version is not read');
  });

  it('uses the campaign language variant when it exists, else the plain file', async () => {
    const files = {
      [NEWS_LIST_URL]: listing(['1.2.0.md', '1.2.0.it.md', '1.2.1.md']),
      [url('1.2.0.md')]: 'Plain 1.2.0.',
      [url('1.2.0.it.md')]: 'Italiano 1.2.0.',
      [url('1.2.1.md')]: 'Plain 1.2.1.',
    };
    assert.equal(
      await fetchNews(source(files), { installed: '1.1.0', published: '1.2.1', language: 'it' }),
      'Italiano 1.2.0.\n\nPlain 1.2.1.',
    );
    assert.equal(
      await fetchNews(source(files), { installed: '1.1.0', published: '1.2.1', language: 'en' }),
      'Plain 1.2.0.\n\nPlain 1.2.1.',
    );
  });

  it('skips a download outside the yllir repository', async () => {
    const get = source({
      [NEWS_LIST_URL]: JSON.stringify([{ name: '1.2.0.md', download_url: 'https://example.invalid/1.2.0.md' }]),
    });
    assert.equal(await fetchNews(get, { installed: '1.1.0', published: '1.2.0', language: 'en' }), null);
    assert.deepEqual(get.calls, [NEWS_LIST_URL]);
  });

  it('gives null when the listing or a file cannot be read, never throwing', async () => {
    assert.equal(await fetchNews(source({}), { installed: '1.1.0', published: '1.2.0', language: 'en' }), null);
    assert.equal(
      await fetchNews(source({ [NEWS_LIST_URL]: listing(['1.2.0.md']) }), {
        installed: '1.1.0',
        published: '1.2.0',
        language: 'en',
      }),
      null,
    );
  });

  it('gives null when no news is in range', async () => {
    const get = source({ [NEWS_LIST_URL]: listing(['1.0.0.md']) });
    assert.equal(await fetchNews(get, { installed: '1.1.0', published: '1.2.0', language: 'en' }), null);
  });

  it('caps the joined text at 8000 characters', async () => {
    const big = 'x'.repeat(6000);
    const get = source({
      [NEWS_LIST_URL]: listing(['1.2.0.md', '1.2.1.md']),
      [url('1.2.0.md')]: big,
      [url('1.2.1.md')]: big,
    });
    const news = await fetchNews(get, { installed: '1.1.0', published: '1.2.1', language: 'en' });
    assert.equal(news?.length, NEWS_LIMIT);
  });
});
