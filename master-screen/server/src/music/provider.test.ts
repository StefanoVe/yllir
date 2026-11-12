import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classifyMusicUrl, trackId } from './provider.js';

describe('classifyMusicUrl: provider and video id', () => {
  const cases: Array<[string, unknown]> = [
    ['https://www.youtube.com/watch?v=abcdefghijk', { provider: 'youtube', videoId: 'abcdefghijk' }],
    ['https://youtube.com/watch?v=abcdefghijk&t=10s', { provider: 'youtube', videoId: 'abcdefghijk' }],
    ['https://m.youtube.com/watch?feature=share&v=abcdefghijk', { provider: 'youtube', videoId: 'abcdefghijk' }],
    ['https://youtu.be/ABCDEFGHIJK', { provider: 'youtube', videoId: 'ABCDEFGHIJK' }],
    ['https://youtu.be/ABCDEFGHIJK?si=xyz', { provider: 'youtube', videoId: 'ABCDEFGHIJK' }],
    ['https://www.youtube.com/shorts/SHORTID1234', { provider: 'youtube', videoId: 'SHORTID1234' }],
    ['https://www.youtube.com/embed/EMBEDID1234', { provider: 'youtube', videoId: 'EMBEDID1234' }],
    ['https://music.youtube.com/watch?v=MUSIC012345', { provider: 'youtube', videoId: 'MUSIC012345' }],
    ['https://www.youtube.com/watch?v=a_b-c_d-e_f', { provider: 'youtube', videoId: 'a_b-c_d-e_f' }],
    ['https://www.youtube.com/playlist?list=PL123abc', { provider: 'external' }],
    ['https://www.youtube.com/watch?list=PL123abc', { provider: 'external' }],
    ['https://www.youtube.com/watch?v=tooshort', { provider: 'external' }],
    ['https://www.youtube.com/watch?v=abcdefghij!', { provider: 'external' }],
    ['https://youtu.be/', { provider: 'external' }],
    ['https://open.spotify.com/track/abc', { provider: 'external' }],
    ['https://soundcloud.com/x/y', { provider: 'external' }],
    ['https://archive.org/details/x', { provider: 'external' }],
  ];
  for (const [url, expected] of cases) {
    it(`classifies ${url}`, () => {
      assert.deepEqual(classifyMusicUrl(url), expected);
    });
  }

  it('drops links that are not https, carry userinfo, have no host or do not parse', () => {
    for (const url of [
      'http://youtube.com/watch?v=abcdefghijk',
      'javascript:alert(1)',
      'data:text/html,hi',
      'ftp://example.org/x',
      'https://user:pass@youtube.com/watch?v=abcdefghijk',
      'https://user@example.org/x',
      'https://',
      'not a url',
      '',
    ]) {
      assert.equal(classifyMusicUrl(url), null, url);
    }
  });
});

describe('trackId', () => {
  it('is 12 hex digits and depends on the sheet and the link', () => {
    const id = trackId('Places/Porto/Porto.md', 'https://youtu.be/ABCDEFGHIJK');
    assert.match(id, /^[0-9a-f]{12}$/);
    assert.equal(id, trackId('Places/Porto/Porto.md', 'https://youtu.be/ABCDEFGHIJK'));
    assert.notEqual(id, trackId('Places/Mercato/Mercato.md', 'https://youtu.be/ABCDEFGHIJK'));
  });
});
