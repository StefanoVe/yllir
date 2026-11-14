import { describe, expect, it } from 'vitest';
import { artUrl, contrastingInk, noteInk } from './music-art';
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

describe('note ink on the fallback tone', () => {
  it('uses white-ish ink on dark tones, near-black on light ones, and white for the dark fallback tones', () => {
    expect(contrastingInk([[20, 20, 20]])).toBe('#ffffff');
    expect(contrastingInk([[240, 240, 235]])).toBe('#111111');
    expect(noteInk('Ambient track')).toBe('#ffffff');
  });
});
