import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrefsService } from '../core/prefs.service';
import { MusicPlayerService, neighbourTrack } from './music-player.service';
import { YOUTUBE_PLAYER } from './youtube-player';
import { FakeYouTubePlayer, externalTrack, settle, youtubeTrack } from './testing';

function clearStorage(): void {
  try {
    globalThis.localStorage?.clear();
  } catch {
    // Storage may be unavailable in this environment; the tests do not depend on it.
  }
}

describe('MusicPlayerService', () => {
  let fake: FakeYouTubePlayer;

  beforeEach(() => {
    clearStorage();
    fake = new FakeYouTubePlayer();
    TestBed.configureTestingModule({ providers: [{ provide: YOUTUBE_PLAYER, useValue: fake }] });
    TestBed.inject(PrefsService).setCampaign('test-campaign');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
    clearStorage();
  });

  function service(): MusicPlayerService {
    return TestBed.inject(MusicPlayerService);
  }

  it('never plays anything by itself', async () => {
    const player = service();
    await settle();
    expect(player.state()).toBe('idle');
    expect(player.current()).toBeNull();
    expect(fake.calls).toEqual([]);
  });

  it('shows loading until the player reports playing, not before', async () => {
    const player = service();
    const track = youtubeTrack('abc');
    player.playTrack(track, [track]);
    expect(player.state()).toBe('loading');
    await settle();
    expect(fake.calls).toEqual(['load:abc', 'volume:70', 'play']);
    expect(player.state()).toBe('loading');
    fake.state('playing');
    expect(player.state()).toBe('playing');
  });

  it('toggles pause and play through the player and follows its reports', async () => {
    const player = service();
    const track = youtubeTrack('abc');
    player.playTrack(track, [track]);
    await settle();
    fake.state('playing');

    player.toggle();
    expect(fake.calls.at(-1)).toBe('pause');
    expect(player.state()).toBe('playing');
    fake.state('paused');
    expect(player.state()).toBe('paused');

    player.toggle();
    expect(fake.calls.at(-1)).toBe('play');
    expect(player.state()).toBe('paused');
  });

  it('keeps the chosen volume, sets the player, and saves it for the campaign', () => {
    const player = service();
    player.setVolume(140);
    expect(player.volume()).toBe(100);
    player.setVolume(40);
    expect(player.volume()).toBe(40);
    expect(fake.lastVolume()).toBe(40);
    expect(TestBed.inject(PrefsService).get('music.volume')).toBe('40');
  });

  it('restores the saved volume and loop when the service starts again', () => {
    const prefs = TestBed.inject(PrefsService);
    prefs.set('music.volume', '25');
    prefs.set('music.loop', '1');
    const player = service();
    expect(player.volume()).toBe(25);
    expect(player.loop()).toBe(true);
  });

  it('restarts the same track on end when loop is on', async () => {
    const player = service();
    const track = youtubeTrack('abc');
    player.playTrack(track, [track]);
    await settle();
    fake.state('playing');
    player.toggleLoop();
    fake.calls.length = 0;

    fake.state('ended');
    expect(fake.calls).toEqual(['seek:0', 'play']);
    expect(player.state()).toBe('loading');
    expect(player.current()).toBe(track);
  });

  it('does not move on or restart when the track ends and loop is off', async () => {
    const player = service();
    const first = youtubeTrack('one');
    const second = youtubeTrack('two');
    player.playTrack(first, [first, second]);
    await settle();
    fake.state('playing');
    fake.calls.length = 0;

    fake.state('ended');
    expect(fake.calls).toEqual([]);
    expect(player.state()).toBe('idle');
    expect(player.current()).toBe(first);
  });

  it('fades out over the time given, then pauses and restores the stored volume', async () => {
    vi.useFakeTimers();
    const player = service();
    const track = youtubeTrack('abc');
    player.setVolume(60);
    player.playTrack(track, [track]);
    await settle();
    fake.state('playing');
    fake.volumes.length = 0;

    player.fadeOut(1000);
    expect(player.fading()).toBe('out');
    vi.advanceTimersByTime(500);
    const middle = fake.lastVolume() ?? -1;
    expect(middle).toBeGreaterThan(0);
    expect(middle).toBeLessThan(60);
    expect(fake.calls).not.toContain('pause');

    vi.advanceTimersByTime(600);
    expect(fake.calls).toContain('pause');
    expect(fake.lastVolume()).toBe(60);
    expect(player.fading()).toBeNull();
    expect(player.volume()).toBe(60);
  });

  it('fades in on start when the fade preference is on', async () => {
    vi.useFakeTimers();
    const player = service();
    player.toggleFade();
    expect(TestBed.inject(PrefsService).get('music.fade')).toBe('1');
    const track = youtubeTrack('abc');
    player.playTrack(track, [track]);
    await settle();

    expect(fake.volumes[0]).toBe(0);
    expect(fake.calls).toContain('play');
    expect(player.fading()).toBe('in');
    vi.advanceTimersByTime(2000);
    expect(fake.lastVolume()).toBe(70);
    expect(player.fading()).toBeNull();
  });

  it('maps a removed or blocked video to a plain-language error', async () => {
    const player = service();
    const track = youtubeTrack('gone');
    player.playTrack(track, [track]);
    await settle();
    fake.error('unavailable');
    expect(player.state()).toBe('error');
    expect(player.error()).toBe('music.error.unavailable');
  });

  it('maps any other player error to a generic failure', async () => {
    const player = service();
    const track = youtubeTrack('bad');
    player.playTrack(track, [track]);
    await settle();
    fake.error('failed');
    expect(player.error()).toBe('music.error.failed');
  });

  it('maps a player that cannot be loaded to the connection message', async () => {
    fake.loadError = new Error('script blocked');
    const player = service();
    const track = youtubeTrack('abc');
    player.playTrack(track, [track]);
    await settle();
    expect(player.state()).toBe('error');
    expect(player.error()).toBe('music.error.player');
  });

  it('opens external tracks in a new tab and never loads the player', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const player = service();
    const link = externalTrack('ext');
    player.playTrack(link);
    expect(open).toHaveBeenCalledWith('https://example.org/ext', '_blank', 'noopener,noreferrer');
    expect(fake.calls).toEqual([]);
    expect(player.current()).toBeNull();
  });

  it('skips external tracks when moving to the next one', async () => {
    const player = service();
    const first = youtubeTrack('one');
    const link = externalTrack('ext');
    const third = youtubeTrack('three');
    const list = [first, link, third];
    player.playTrack(first, list);
    await settle();
    expect(player.hasNext()).toBe(true);
    player.next();
    await settle();
    expect(player.current()).toBe(third);
    expect(fake.calls).toContain('load:three');
    expect(player.hasPrevious()).toBe(true);
  });

  it('stop closes the player and clears the queue', async () => {
    const player = service();
    const track = youtubeTrack('abc');
    player.playTrack(track, [track]);
    await settle();
    player.stop();
    expect(player.current()).toBeNull();
    expect(player.queue()).toEqual([]);
    expect(player.state()).toBe('idle');
    expect(fake.calls).toContain('stop');
  });
});

describe('neighbourTrack', () => {
  it('finds the playable neighbour in both directions and stops at the ends', () => {
    const a = youtubeTrack('a');
    const link = externalTrack('x');
    const b = youtubeTrack('b');
    const queue = [a, link, b];
    expect(neighbourTrack(queue, a, 1)).toBe(b);
    expect(neighbourTrack(queue, b, -1)).toBe(a);
    expect(neighbourTrack(queue, b, 1)).toBeNull();
    expect(neighbourTrack(queue, null, 1)).toBeNull();
  });
});
