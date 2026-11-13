import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import type { MusicPlayback as PlaybackState } from '../../../shared/src/types.js';
import { createCtx } from '../context.js';
import { makeCampaign, tempDir } from '../live/test-support.js';
import { loadMusicEntries, loadMusicLibrary } from './library.js';
import { detectMusicTools, MpvProcess, type MpvSpawnOptions, type ToolsResult } from './mpv.js';
import { MusicPlayback, parseMusicCommand, playUrlOf } from './playback.js';
import { fakeMpvBinary, MUSIC_ON_YAML, REAL_FRAMEWORK } from './test-support.js';

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) fs.rmSync(dir, { recursive: true, force: true });
});

// Sheet with the tracks the tests play. Video ids are 11 characters; the fake mpv reacts to
// "gone" (unavailable video), "fail" (technical error) and "slow" (late load) in the URL.
const TEST_SHEET = [
  '# Test place',
  '',
  '<!-- master -->',
  '## Master',
  '',
  '### Music',
  '',
  '- [Forest theme](https://youtube.com/watch?v=FORESTID123) — wind',
  '- [Gone](https://www.youtube.com/watch?v=gone0000001) — removed upstream',
  '- [Broken](https://www.youtube.com/watch?v=failfail001) — technical failure',
  '- [Slow](https://www.youtube.com/watch?v=slowslow001) — late load',
  '- [Ext](https://example.org/track) — not YouTube',
  '- [Cloud](https://soundcloud.com/forss/flickermood?si=share#t=10) — soundcloud track',
  '- [Set](https://soundcloud.com/forss/sets/some-set) — soundcloud set',
  '- [Apple](https://music.apple.com/us/album/some-album/123) — apple music',
  '<!-- /master -->',
  '',
].join('\n');

interface Rig {
  playback: MusicPlayback;
  states: PlaybackState[];
  spawned: MpvProcess[];
  logFile: string;
  trackId(title: string): string;
  close(): Promise<void>;
}

const savedLog = process.env.FAKE_MPV_LOG;

async function rig(opts: { tools?: ToolsResult; fadeMs?: number } = {}): Promise<Rig> {
  const campaign = makeCampaign({ 'campaign.yaml': MUSIC_ON_YAML, 'Places/Test/Test.md': TEST_SHEET });
  cleanup.push(campaign);
  const ctx = createCtx({ campaignRoot: campaign, frameworkRoot: REAL_FRAMEWORK, port: 0, log: () => undefined });
  const logDir = tempDir('ms-playback-log-');
  cleanup.push(logDir);
  const logFile = path.join(logDir, 'ipc.jsonl');
  process.env.FAKE_MPV_LOG = logFile;
  const states: PlaybackState[] = [];
  const spawned: MpvProcess[] = [];
  const tools: ToolsResult =
    opts.tools ?? { ok: true, tools: { mpv: fakeMpvBinary(), ytdlp: process.execPath, deno: null } };
  const playback = new MusicPlayback({
    tools,
    publish: (state) => states.push(state),
    log: () => undefined,
    loadEntries: () => loadMusicEntries(ctx),
    spawn: (o: MpvSpawnOptions) => {
      const proc = new MpvProcess(o);
      spawned.push(proc);
      return proc;
    },
    fadeMs: opts.fadeMs ?? 200,
    publishIntervalMs: 250,
  });
  const library = await loadMusicLibrary(ctx);
  if (!library.ok) throw new Error(library.note);
  return {
    playback,
    states,
    spawned,
    logFile,
    trackId(title: string): string {
      const track = library.tracks.find((t) => t.title === title);
      if (!track) throw new Error(`no track ${title}`);
      return track.id;
    },
    async close(): Promise<void> {
      await playback.shutdown();
      if (savedLog === undefined) delete process.env.FAKE_MPV_LOG;
      else process.env.FAKE_MPV_LOG = savedLog;
    },
  };
}

async function waitFor(check: () => boolean, ms = 4000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('condition not reached in time');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function sentCommands(logFile: string): unknown[][] {
  if (!fs.existsSync(logFile)) return [];
  return fs
    .readFileSync(logFile, 'utf8')
    .trim()
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => (JSON.parse(line) as { command: unknown[] }).command);
}

describe('parseMusicCommand', () => {
  it('accepts each command in its shape', () => {
    const ok = [
      { command: 'play', trackId: 'abcdef012345' },
      { command: 'pause' },
      { command: 'resume' },
      { command: 'stop' },
      { command: 'fadeout' },
      { command: 'seek', value: 0 },
      { command: 'volume', value: 100 },
      { command: 'loop', value: false },
    ];
    for (const body of ok) assert.equal(parseMusicCommand(body).ok, true, JSON.stringify(body));
  });

  it('refuses unknown commands, unknown keys, bad ids and out-of-range values', () => {
    const refused: unknown[] = [
      null,
      [],
      'play',
      {},
      { command: 'constructor' },
      { command: 'toString' },
      { command: 'play', trackId: 'ABCDEF012345' },
      { command: 'play', trackId: 'abcdef01234' },
      { command: 'play', trackId: 42 },
      { command: 'play', trackId: 'abcdef012345', url: 'https://example.org' },
      { command: 'pause', trackId: 'abcdef012345' },
      { command: 'seek', value: -0.5 },
      { command: 'seek', value: Number.NaN },
      { command: 'seek', value: 86401 },
      { command: 'volume', value: -1 },
      { command: 'volume', value: 100.5 },
      { command: 'loop', value: 1 },
    ];
    for (const body of refused) {
      const parsed = parseMusicCommand(body);
      assert.equal(parsed.ok, false, JSON.stringify(body));
      if (!parsed.ok) assert.equal(typeof parsed.error, 'string');
    }
  });
});

describe('URL of a track', () => {
  it('refuses anything that is not a YouTube video id', () => {
    assert.equal(playUrlOf({ ok: false, note: 'x' }, 'abcdef012345'), null);
    assert.equal(
      playUrlOf(
        {
          ok: true,
          entries: [
            {
              track: {
                id: 'abcdef012345',
                title: 'Bad',
                url: 'https://youtube.com/watch?v=x',
                mood: '',
                provider: 'youtube',
                videoId: 'not an id!',
                docPath: 'a.md',
                docTitle: 'a',
              },
              area: '',
              passages: [],
            },
          ],
        },
        'abcdef012345',
      ),
      null,
    );
  });

  it('cleans a SoundCloud link to origin and path, and refuses a non-SoundCloud link', () => {
    const entry = (provider: 'soundcloud' | 'external', url: string) => ({
      ok: true as const,
      entries: [
        {
          track: { id: 'abcdef012345', title: 'T', url, mood: '', provider, docPath: 'a.md', docTitle: 'a' },
          area: '',
          passages: [],
        },
      ],
    });
    assert.equal(
      playUrlOf(entry('soundcloud', 'https://m.soundcloud.com/forss/flickermood?si=x#t=5'), 'abcdef012345'),
      'https://m.soundcloud.com/forss/flickermood',
    );
    assert.equal(playUrlOf(entry('soundcloud', 'https://example.org/track'), 'abcdef012345'), null);
    assert.equal(playUrlOf(entry('external', 'https://soundcloud.com/forss/flickermood'), 'abcdef012345'), null);
  });
});

describe('MusicPlayback', () => {
  it('plays a YouTube track through the URL rebuilt from its video id', async () => {
    const r = await rig();
    try {
      const id = r.trackId('Forest theme');
      const started = r.playback.play(id);
      assert.equal(started.phase, 'loading');
      assert.equal(started.trackId, id);
      await waitFor(() => r.playback.snapshot().phase === 'playing');
      const state = r.playback.snapshot();
      assert.equal(state.available, true);
      assert.equal(state.volume, 80);
      assert.equal(state.loop, true);
      const loads = sentCommands(r.logFile).filter((c) => c[0] === 'loadfile');
      assert.deepEqual(loads.map((c) => c[1]), ['https://www.youtube.com/watch?v=FORESTID123']);
      assert.equal(r.spawned.length, 1, 'mpv starts once, on the first play');
    } finally {
      await r.close();
    }
  });

  it('plays a SoundCloud track through its cleaned link (no query, no fragment)', async () => {
    const r = await rig();
    try {
      r.playback.play(r.trackId('Cloud'));
      await waitFor(() => r.playback.snapshot().phase === 'playing');
      const loads = sentCommands(r.logFile).filter((c) => c[0] === 'loadfile');
      assert.deepEqual(loads.map((c) => c[1]), ['https://soundcloud.com/forss/flickermood']);
    } finally {
      await r.close();
    }
  });

  it('sends a SoundCloud set to mpv as its link too; yt-dlp takes only its first entry', async () => {
    const r = await rig();
    try {
      r.playback.play(r.trackId('Set'));
      await waitFor(() => r.playback.snapshot().phase === 'playing');
      const loads = sentCommands(r.logFile).filter((c) => c[0] === 'loadfile');
      assert.deepEqual(loads.map((c) => c[1]), ['https://soundcloud.com/forss/sets/some-set']);
    } finally {
      await r.close();
    }
  });

  it('refuses a non-playable track (Apple Music, external link) and never starts mpv', async () => {
    const r = await rig();
    try {
      for (const title of ['Ext', 'Apple']) {
        r.playback.play(r.trackId(title));
        await waitFor(() => r.playback.snapshot().phase === 'error');
        assert.equal(r.playback.snapshot().error, 'unavailable', title);
      }
      assert.equal(r.spawned.length, 0);
      assert.equal(fs.existsSync(r.logFile), false);
    } finally {
      await r.close();
    }
  });

  it('refuses a track id the library does not know', async () => {
    const r = await rig();
    try {
      r.playback.play('ffffffffffff');
      await waitFor(() => r.playback.snapshot().phase === 'error');
      assert.equal(r.playback.snapshot().error, 'unavailable');
      assert.equal(r.spawned.length, 0);
    } finally {
      await r.close();
    }
  });

  it('a newer play supersedes a slower one: the stale load never starts', async () => {
    const r = await rig();
    try {
      r.playback.play(r.trackId('Slow'));
      r.playback.play(r.trackId('Forest theme'));
      await waitFor(() => r.playback.snapshot().phase === 'playing');
      await new Promise((resolve) => setTimeout(resolve, 600));
      const loads = sentCommands(r.logFile).filter((c) => c[0] === 'loadfile').map((c) => c[1]);
      assert.deepEqual(loads, ['https://www.youtube.com/watch?v=FORESTID123']);
      assert.equal(r.playback.snapshot().trackId, r.trackId('Forest theme'));
    } finally {
      await r.close();
    }
  });

  it('maps a video that yt-dlp reports as unavailable to error unavailable', async () => {
    const r = await rig();
    try {
      r.playback.play(r.trackId('Gone'));
      await waitFor(() => r.playback.snapshot().phase === 'error', 6000);
      assert.equal(r.playback.snapshot().error, 'unavailable');
    } finally {
      await r.close();
    }
  });

  it('maps a technical load failure to error failed, and never throws', async () => {
    const r = await rig();
    try {
      r.playback.play(r.trackId('Broken'));
      await waitFor(() => r.playback.snapshot().phase === 'error', 6000);
      assert.equal(r.playback.snapshot().error, 'failed');
    } finally {
      await r.close();
    }
  });

  it('reports unavailable at once when mpv or yt-dlp is missing, and spawns nothing', async () => {
    const empty = tempDir('ms-empty-path-');
    cleanup.push(empty);
    const tools = detectMusicTools({ env: { PATH: empty }, fallbackDirs: [] });
    assert.equal(tools.ok, false);
    const r = await rig({ tools });
    try {
      assert.equal(r.playback.snapshot().available, false);
      assert.equal(r.playback.snapshot().unavailableReason, 'mpv-missing');
      r.playback.play(r.trackId('Forest theme'));
      assert.equal(r.playback.snapshot().phase, 'error');
      assert.equal(r.playback.snapshot().error, 'unavailable');
      assert.equal(r.spawned.length, 0);
    } finally {
      await r.close();
    }
  });

  it('pause, resume, seek clamped to the duration, and loop', async () => {
    const r = await rig();
    try {
      r.playback.play(r.trackId('Forest theme'));
      await waitFor(() => r.playback.snapshot().phase === 'playing');
      assert.equal(r.playback.pause().phase, 'paused');
      assert.equal(r.playback.resume().phase, 'playing');
      await waitFor(() => r.playback.snapshot().duration === 3);
      assert.equal(r.playback.seek(999).position, 3);
      assert.equal(r.playback.seek(-5).position, 0);
      assert.equal(r.playback.loop(false).loop, false);
      await waitFor(() => sentCommands(r.logFile).some((c) => c[0] === 'set_property' && c[1] === 'loop-file' && c[2] === 'no'));
    } finally {
      await r.close();
    }
  });

  it('clamps the volume to 0..100 and sends it to mpv', async () => {
    const r = await rig();
    try {
      assert.equal(r.playback.volume(150).volume, 100);
      assert.equal(r.playback.volume(-20).volume, 0);
      assert.equal(r.playback.volume(35.4).volume, 35);
      r.playback.play(r.trackId('Forest theme'));
      await waitFor(() => r.playback.snapshot().phase === 'playing');
      assert.ok(sentCommands(r.logFile).some((c) => c[0] === 'set_property' && c[1] === 'volume' && c[2] === 35));
    } finally {
      await r.close();
    }
  });

  it('fadeout ramps the volume down, stops, and restores the volume value', async () => {
    const r = await rig({ fadeMs: 200 });
    try {
      r.playback.play(r.trackId('Forest theme'));
      await waitFor(() => r.playback.snapshot().phase === 'playing');
      r.playback.fadeout();
      await waitFor(() => r.playback.snapshot().phase === 'idle');
      const sent = sentCommands(r.logFile);
      const volumes = sent.filter((c) => c[0] === 'set_property' && c[1] === 'volume').map((c) => c[2]);
      assert.ok(volumes.includes(40), 'the ramp went below the start value');
      const stopAt = sent.findIndex((c) => c[0] === 'stop');
      assert.ok(stopAt >= 0);
      const restored = sent.slice(stopAt).some((c) => c[0] === 'set_property' && c[1] === 'volume' && c[2] === 80);
      assert.equal(restored, true);
      assert.equal(r.playback.snapshot().volume, 80);
    } finally {
      await r.close();
    }
  });

  it('stop returns to idle with no track and cancels a pending load', async () => {
    const r = await rig();
    try {
      r.playback.play(r.trackId('Slow'));
      const stopped = r.playback.stop();
      assert.equal(stopped.phase, 'idle');
      assert.equal(stopped.trackId, null);
      await new Promise((resolve) => setTimeout(resolve, 600));
      assert.equal(r.playback.snapshot().phase, 'idle');
      assert.equal(sentCommands(r.logFile).some((c) => c[0] === 'loadfile'), false);
    } finally {
      await r.close();
    }
  });

  it('publishes at most 4 position updates per second while playing, and every command at once', async () => {
    const r = await rig();
    try {
      r.playback.play(r.trackId('Forest theme'));
      await waitFor(() => r.playback.snapshot().phase === 'playing');
      const before = r.states.length;
      const start = Date.now();
      await waitFor(() => r.states.some((s) => s.position > 0.5 && s.phase === 'playing'));
      const elapsed = Math.max(1, Date.now() - start);
      const updates = r.states.length - before;
      assert.ok(updates <= Math.ceil(elapsed / 250) + 1, `${updates} updates in ${elapsed} ms`);
      const beforeCommand = r.states.length;
      r.playback.volume(20);
      assert.equal(r.states.length, beforeCommand + 1);
      assert.equal(r.states[r.states.length - 1].volume, 20);
    } finally {
      await r.close();
    }
  });

  it('shutdown kills the mpv child and removes its socket', async () => {
    const r = await rig();
    r.playback.play(r.trackId('Forest theme'));
    await waitFor(() => r.playback.snapshot().phase === 'playing');
    const pid = r.spawned[0].pid;
    assert.ok(pid !== undefined);
    await r.close();
    assert.throws(() => process.kill(pid, 0));
  });
});
