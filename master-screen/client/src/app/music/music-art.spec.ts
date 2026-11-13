import { describe, expect, it } from 'vitest';
import { artUrl } from './music-art';
import { soundcloudTrack, youtubeTrack } from './testing';

describe('artUrl', () => {
  it('builds the thumbnail only for a YouTube track with a valid id', () => {
    expect(artUrl(youtubeTrack('abcdefghijk'))).toBe('https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg');
    expect(artUrl(youtubeTrack('bad id!'))).toBeNull();
  });

  it('makes no thumbnail request for a SoundCloud track: it keeps the tone and the note', () => {
    expect(artUrl(soundcloudTrack('sc'))).toBeNull();
    expect(artUrl(null)).toBeNull();
  });
});
