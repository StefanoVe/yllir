import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MusicPlayback } from '@shared/types';
import { MusicApiService } from './music-api.service';
import { MusicPlayerService, neighbourTrack } from './music-player.service';
import { FakeMusicServer, externalTrack, settle, soundcloudTrack, youtubeTrack } from './testing';

const PLAYING: MusicPlayback = {
  available: true,
  phase: 'playing',
  trackId: 'a',
  position: 12,
  duration: 200,
  volume: 40,
  loop: false,
};

describe('MusicPlayerService', () => {
  let server: FakeMusicServer;
  let player: MusicPlayerService;
  const a = youtubeTrack('a', { title: 'Alpha' });
  const b = youtubeTrack('b', { title: 'Bravo' });
  const c = youtubeTrack('c', { title: 'Charlie' });

  beforeEach(() => {
    server = new FakeMusicServer();
    server.tracks = [a, b, c];
    server.install();
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(), ...server.providers()] });
    player = TestBed.inject(MusicPlayerService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    server.unstub();
    TestBed.resetTestingModule();
  });

  it('reads the server state at startup and mirrors it without overwriting volume or loop', async () => {
    server.playback = PLAYING;
    player.refresh();
    await settle();
    expect(player.ready()).toBe(true);
    expect(player.volume()).toBe(40);
    expect(player.loop()).toBe(false);
    expect(player.state()).toBe('playing');
    expect(player.position()).toBe(12);
    expect(player.duration()).toBe(200);
  });

  it('renders a live musicstate as it arrives, without interpolating the position', async () => {
    await settle();
    server.emit('musicstate', { ...PLAYING, position: 13.25 });
    await settle();
    expect(player.position()).toBe(13.25);
    server.emit('musicstate', { ...PLAYING, position: 13.5 });
    await settle();
    expect(player.position()).toBe(13.5);
  });

  it('reports unavailability with its reason and never shows the playback as available', async () => {
    server.playback = { ...PLAYING, available: false, unavailableReason: 'mpv-missing', phase: 'idle', trackId: null };
    player.refresh();
    await settle();
    expect(player.available()).toBe(false);
    expect(player.unavailableReason()).toBe('mpv-missing');
  });

  it('sends a play command with the track id and shows loading until the server answers', async () => {
    await settle();
    player.playTrack(a, [a, b]);
    expect(player.state()).toBe('loading');
    expect(player.current()?.id).toBe('a');
    await settle();
    expect(server.commands).toEqual([{ command: 'play', trackId: 'a' }]);
    expect(player.state()).toBe('playing');
    expect(player.current()?.title).toBe('Alpha');
  });

  it('looks up the title of a track the app has not seen, once, through the tracks endpoint', async () => {
    server.playback = { ...PLAYING, trackId: 'c' };
    const search = vi.spyOn(TestBed.inject(MusicApiService), 'tracks');
    player.refresh();
    await settle();
    TestBed.flushEffects();
    await settle();
    expect(player.current()?.title).toBe('Charlie');
    expect(search).toHaveBeenCalledWith('');
    expect(search.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it('toggles pause and resume from the state the server reports', async () => {
    server.playback = PLAYING;
    player.refresh();
    await settle();
    player.toggle();
    await settle();
    expect(server.commands.at(-1)).toEqual({ command: 'pause' });
    expect(player.state()).toBe('paused');
    player.toggle();
    await settle();
    expect(server.commands.at(-1)).toEqual({ command: 'resume' });
    expect(player.state()).toBe('playing');
  });

  it('starts the current track again from idle', async () => {
    server.playback = { ...PLAYING, phase: 'idle' };
    player.refresh();
    await settle();
    player.toggle();
    await settle();
    expect(server.commands.at(-1)).toEqual({ command: 'play', trackId: 'a' });
  });

  it('seeks within the length and sends the seek command', async () => {
    server.playback = PLAYING;
    player.refresh();
    await settle();
    player.seek(500);
    await settle();
    expect(server.commands.at(-1)).toEqual({ command: 'seek', value: 200 });
    player.seek(-4);
    await settle();
    expect(server.commands.at(-1)).toEqual({ command: 'seek', value: 0 });
  });

  it('sends the newest slider value after the one in flight, never a backlog', async () => {
    server.playback = PLAYING;
    player.refresh();
    await settle();
    player.seek(10);
    player.seek(20);
    player.seek(30);
    expect(player.seekDraft()).toBe(30);
    await settle();
    expect(server.commands.filter((command) => command.command === 'seek')).toEqual([
      { command: 'seek', value: 10 },
      { command: 'seek', value: 30 },
    ]);
    expect(player.seekDraft()).toBeNull();
    expect(player.position()).toBe(30);
  });

  it('rounds and clamps the volume, and shows the server value once the drag ends', async () => {
    server.playback = PLAYING;
    player.refresh();
    await settle();
    player.setVolume(150);
    expect(player.volumeDraft()).toBe(100);
    await settle();
    expect(server.commands).toContainEqual({ command: 'volume', value: 100 });
    expect(player.volume()).toBe(100);
    expect(player.volumeDraft()).toBeNull();
  });

  it('toggles the loop through the server', async () => {
    server.playback = PLAYING;
    player.refresh();
    await settle();
    player.toggleLoop();
    await settle();
    expect(server.commands.at(-1)).toEqual({ command: 'loop', value: true });
    expect(player.loop()).toBe(true);
  });

  it('sends fade-out only while playing, and stop clears the queue', async () => {
    await settle();
    player.fadeOut();
    expect(server.commands).toEqual([]);
    server.playback = PLAYING;
    player.refresh();
    await settle();
    player.fadeOut();
    await settle();
    expect(server.commands.at(-1)).toEqual({ command: 'fadeout' });
    player.playTrack(b, [a, b, c]);
    await settle();
    player.stop();
    await settle();
    expect(server.commands.at(-1)).toEqual({ command: 'stop' });
    expect(player.queue()).toEqual([]);
  });

  it('moves through the queue, skipping external tracks', async () => {
    const link = externalTrack('x');
    await settle();
    player.playTrack(b, [a, b, link, c]);
    await settle();
    expect(player.hasPrevious()).toBe(true);
    expect(player.hasNext()).toBe(true);
    player.next();
    await settle();
    expect(server.commands.at(-1)).toEqual({ command: 'play', trackId: 'c' });
    expect(player.hasNext()).toBe(false);
    player.previous();
    await settle();
    player.previous();
    await settle();
    expect(server.commands.at(-1)).toEqual({ command: 'play', trackId: 'a' });
  });

  it('plays a SoundCloud track in the app and sends it to the server', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    await settle();
    player.playTrack(soundcloudTrack('sc'));
    await settle();
    expect(open).not.toHaveBeenCalled();
    expect(server.commands.at(-1)).toEqual({ command: 'play', trackId: 'sc' });
  });

  it('opens an external track in a new tab and never sends it to the server', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    await settle();
    player.playTrack(externalTrack('e', { url: 'https://example.org/e' }));
    expect(open).toHaveBeenCalledWith('https://example.org/e', '_blank', 'noopener,noreferrer');
    expect(server.commands).toEqual([]);
  });

  it('shows the failure of a command in plain words and ends the loading state', async () => {
    await settle();
    server.failNext = 'command';
    player.playTrack(a);
    await settle();
    expect(player.failure()).toBe('The player did not answer.');
    expect(player.state()).toBe('idle');
  });

  it('retries the current track after an error', async () => {
    server.playback = { ...PLAYING, phase: 'error', error: 'failed' };
    player.refresh();
    await settle();
    expect(player.error()).toBe('failed');
    player.retry();
    await settle();
    expect(server.commands.at(-1)).toEqual({ command: 'play', trackId: 'a' });
  });
});

describe('neighbourTrack', () => {
  it('finds the next and previous YouTube track of the queue', () => {
    const queue = [a(), externalTrack('x'), b()];
    expect(neighbourTrack(queue, queue[0], 1)?.id).toBe('b');
    expect(neighbourTrack(queue, queue[2], -1)?.id).toBe('a');
    expect(neighbourTrack(queue, queue[0], -1)).toBeNull();
    expect(neighbourTrack(queue, null, 1)).toBeNull();
  });

  it('counts SoundCloud tracks as playable in the app, and skips external ones', () => {
    const cloud = soundcloudTrack('sc');
    const queue = [a(), externalTrack('x'), cloud, b()];
    expect(neighbourTrack(queue, queue[0], 1)?.id).toBe('sc');
    expect(neighbourTrack(queue, cloud, 1)?.id).toBe('b');
    expect(neighbourTrack(queue, b(), -1)?.id).toBe('sc');
  });
});

function a() {
  return youtubeTrack('a');
}
function b() {
  return youtubeTrack('b');
}
