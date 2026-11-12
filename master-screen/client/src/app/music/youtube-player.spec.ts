import { describe, expect, it } from 'vitest';
import { IframeYouTubePlayer, YOUTUBE_CONTAINER_ID, clampVolume, youTubeErrorKind, youTubeState } from './youtube-player';

describe('youTubeErrorKind', () => {
  it('treats removed, private and embed-blocked videos as unavailable', () => {
    expect(youTubeErrorKind(100)).toBe('unavailable');
    expect(youTubeErrorKind(101)).toBe('unavailable');
    expect(youTubeErrorKind(150)).toBe('unavailable');
  });

  it('treats every other code as a generic failure', () => {
    expect(youTubeErrorKind(2)).toBe('failed');
    expect(youTubeErrorKind(5)).toBe('failed');
    expect(youTubeErrorKind(999)).toBe('failed');
  });
});

describe('youTubeState', () => {
  it('maps the YouTube state numbers to the app states', () => {
    expect(youTubeState(1)).toBe('playing');
    expect(youTubeState(2)).toBe('paused');
    expect(youTubeState(0)).toBe('ended');
    expect(youTubeState(3)).toBe('buffering');
    expect(youTubeState(5)).toBe('cued');
    expect(youTubeState(-1)).toBe('unstarted');
    expect(youTubeState(42)).toBeNull();
  });
});

describe('clampVolume', () => {
  it('keeps the volume between 0 and 100 and rounds it', () => {
    expect(clampVolume(-5)).toBe(0);
    expect(clampVolume(140)).toBe(100);
    expect(clampVolume(33.6)).toBe(34);
    expect(clampVolume(Number.NaN)).toBe(0);
  });
});

describe('IframeYouTubePlayer', () => {
  it('touches neither the document nor the API until a video is loaded', () => {
    const doc = document;
    const before = doc.querySelectorAll('script[src*="iframe_api"]').length;
    new IframeYouTubePlayer(doc, () => window);
    expect(doc.getElementById(YOUTUBE_CONTAINER_ID)).toBeNull();
    expect(doc.querySelectorAll('script[src*="iframe_api"]').length).toBe(before);
  });
});
