// The server-side player of one campaign: one mpv process, started on the first play, driven by
// the master's commands. Only YouTube and SoundCloud tracks of the campaign library play: YouTube
// through the URL rebuilt from the video id, SoundCloud through its cleaned track link. Every failure
// becomes the `error` phase; nothing here throws into
// the server. Owner: music engineer.
import type { MusicCommand, MusicPlayback as PlaybackState } from '../../../shared/src/types.js';
import type { Ctx } from '../context.js';
import { loadMusicEntries, type EntriesResult } from './library.js';
import { classifyMusicUrl } from './provider.js';
import { findMusicTools, MpvProcess, type MpvSpawnOptions, type ToolsResult } from './mpv.js';

export const DEFAULT_VOLUME = 80;
const DEFAULT_FADE_MS = 3000;
const FADE_STEP_MS = 100;
const DEFAULT_PUBLISH_INTERVAL_MS = 250;
const STDERR_TAIL_LINES = 20;
/** mpv reports stderr and IPC events on different pipes: wait this long for the yt-dlp message. */
const CLASSIFY_GRACE_MS = 300;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
/** yt-dlp messages that mean the video itself cannot be played (as opposed to a technical failure). */
const UNAVAILABLE_MESSAGE = /unavailable|private video|not available|removed|terminated|blocked|members.only|age.restricted/i;

export interface PlaybackOptions {
  tools: ToolsResult;
  /** Receives every state the bus should carry (the caller publishes it as `musicstate`). */
  publish: (state: PlaybackState) => void;
  log: (line: string) => void;
  /** The campaign music library; read only. */
  loadEntries: () => Promise<EntriesResult>;
  /** Starts an mpv process. Tests inject a stand-in; the default spawns the real one. */
  spawn?: (opts: MpvSpawnOptions) => MpvProcess;
  /** Length of the fade-out ramp. Default 3000 ms. */
  fadeMs?: number;
  /** Shortest gap between two position publications while playing. Default 250 ms (4 per second). */
  publishIntervalMs?: number;
}

/** The state of a campaign whose music module is off: nothing can play, the defaults show. */
export function inactivePlayback(): PlaybackState {
  return { available: false, phase: 'idle', trackId: null, position: 0, duration: 0, volume: DEFAULT_VOLUME, loop: true };
}

/**
 * The URL mpv loads for a track of the library, or null for anything that cannot play in the app.
 * YouTube: the watch URL rebuilt from the video id. SoundCloud: the stored link, re-classified and
 * cleaned to origin + path (no query, no fragment), so mpv gets the track page only.
 */
export function playUrlOf(entries: EntriesResult, trackId: string): string | null {
  if (!entries.ok) return null;
  const entry = entries.entries.find((candidate) => candidate.track.id === trackId);
  if (!entry) return null;
  const { provider, videoId, url } = entry.track;
  if (provider === 'youtube') {
    if (videoId === undefined || !VIDEO_ID.test(videoId)) return null;
    return `https://www.youtube.com/watch?v=${videoId}`;
  }
  if (provider === 'soundcloud') {
    const link = classifyMusicUrl(url);
    if (link === null || link.provider !== 'soundcloud') return null;
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  }
  return null;
}

/** Controller of one campaign's playback. Commands return the state at once; loads run in the background. */
export class MusicPlayback {
  private readonly tools: ToolsResult;
  private state: PlaybackState;
  private proc: MpvProcess | null = null;
  private starting: Promise<MpvProcess> | null = null;
  /** Bumped by every play, stop and shutdown: a load that finds a different token gives up. */
  private token = 0;
  /** Pause asked while the track is still loading: applied when it is ready. */
  private wantPaused = false;
  private fadeTimer: NodeJS.Timeout | null = null;
  private publishTimer: NodeJS.Timeout | null = null;
  private failTimer: NodeJS.Timeout | null = null;
  private lastPublishAt = 0;
  private stderrTail: string[] = [];
  private closed = false;

  constructor(private readonly opts: PlaybackOptions) {
    this.tools = opts.tools;
    this.state = {
      ...inactivePlayback(),
      available: opts.tools.ok,
      ...(opts.tools.ok ? {} : { unavailableReason: opts.tools.reason }),
    };
  }

  /** The current state, without keys that are undefined. */
  snapshot(): PlaybackState {
    const copy: Record<string, unknown> = { ...this.state };
    for (const key of Object.keys(copy)) {
      if (copy[key] === undefined) delete copy[key];
    }
    return copy as unknown as PlaybackState;
  }

  play(trackId: string): PlaybackState {
    if (this.closed) return this.snapshot();
    this.cancelFade();
    this.clearFailTimer();
    const token = ++this.token;
    this.wantPaused = false;
    this.stderrTail = [];
    this.set({ phase: 'loading', trackId, position: 0, duration: 0, error: undefined });
    if (!this.tools.ok) {
      this.fail('unavailable');
      return this.reply();
    }
    void this.load(trackId, token);
    return this.reply();
  }

  pause(): PlaybackState {
    if (this.canControl()) {
      this.cancelFade();
      if (this.state.phase === 'playing') {
        this.proc?.send(['set_property', 'pause', true]);
        this.set({ phase: 'paused' });
      } else if (this.state.phase === 'loading') {
        this.wantPaused = true;
      }
    }
    return this.reply();
  }

  resume(): PlaybackState {
    if (this.canControl()) {
      this.cancelFade();
      if (this.state.phase === 'paused') {
        this.proc?.send(['set_property', 'pause', false]);
        this.set({ phase: 'playing' });
      } else if (this.state.phase === 'loading') {
        this.wantPaused = false;
      }
    }
    return this.reply();
  }

  stop(): PlaybackState {
    if (this.closed) return this.snapshot();
    this.cancelFade();
    this.clearFailTimer();
    this.token++;
    this.wantPaused = false;
    if (this.proc?.running) this.proc.send(['stop']);
    this.set({ phase: 'idle', trackId: null, position: 0, duration: 0, error: undefined });
    return this.reply();
  }

  /** Ramps the volume to 0 over the fade length, then stops and restores the volume value. */
  fadeout(): PlaybackState {
    if (!this.canControl()) return this.reply();
    if (this.state.phase === 'loading') return this.stop();
    if ((this.state.phase !== 'playing' && this.state.phase !== 'paused') || this.fadeTimer !== null) {
      return this.reply();
    }
    const fadeMs = this.opts.fadeMs ?? DEFAULT_FADE_MS;
    const steps = Math.max(1, Math.round(fadeMs / FADE_STEP_MS));
    let step = 0;
    this.fadeTimer = setInterval(() => {
      step += 1;
      if (step >= steps) {
        this.finishFade();
        return;
      }
      this.proc?.send(['set_property', 'volume', Math.round(this.state.volume * (1 - step / steps))]);
    }, fadeMs / steps);
    this.fadeTimer.unref();
    return this.reply();
  }

  seek(value: number): PlaybackState {
    if (this.canControl() && (this.state.phase === 'playing' || this.state.phase === 'paused') && this.proc?.running) {
      if (Number.isFinite(value)) {
        const max = this.state.duration > 0 ? this.state.duration : Number.POSITIVE_INFINITY;
        const target = Math.min(max, Math.max(0, value));
        this.proc.send(['seek', target, 'absolute']);
        this.set({ position: target });
      }
    }
    return this.reply();
  }

  volume(value: number): PlaybackState {
    if (this.closed || !Number.isFinite(value)) return this.reply();
    this.cancelFade();
    const level = Math.min(100, Math.max(0, Math.round(value)));
    this.set({ volume: level });
    if (this.proc?.running) this.proc.send(['set_property', 'volume', level]);
    return this.reply();
  }

  loop(value: boolean): PlaybackState {
    if (this.closed) return this.snapshot();
    this.set({ loop: value });
    if (this.proc?.running) this.proc.send(['set_property', 'loop-file', value ? 'inf' : 'no']);
    return this.reply();
  }

  /** Kills mpv (quit, then SIGTERM, then SIGKILL) and stops every pending action. Never throws. */
  async shutdown(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.token++;
    this.clearFailTimer();
    if (this.fadeTimer) clearInterval(this.fadeTimer);
    this.fadeTimer = null;
    if (this.publishTimer) clearTimeout(this.publishTimer);
    this.publishTimer = null;
    const starting = this.starting ? await this.starting.catch(() => null) : null;
    const proc = this.proc ?? starting;
    this.proc = null;
    if (proc) await proc.stop();
  }

  private clearFailTimer(): void {
    if (this.failTimer) clearTimeout(this.failTimer);
    this.failTimer = null;
  }

  private canControl(): boolean {
    return this.state.available && !this.closed;
  }

  private set(changes: Partial<PlaybackState>): void {
    this.state = { ...this.state, ...changes };
  }

  /** Publishes now and returns the state: every command ends here. */
  private reply(): PlaybackState {
    this.publishNow();
    return this.snapshot();
  }

  private publishNow(): void {
    if (this.publishTimer) clearTimeout(this.publishTimer);
    this.publishTimer = null;
    this.lastPublishAt = Date.now();
    this.opts.publish(this.snapshot());
  }

  /** Position and duration updates: at most one publication per interval, the last value always sent. */
  private publishSoon(): void {
    const interval = this.opts.publishIntervalMs ?? DEFAULT_PUBLISH_INTERVAL_MS;
    const wait = interval - (Date.now() - this.lastPublishAt);
    if (wait <= 0) {
      this.publishNow();
      return;
    }
    if (this.publishTimer === null) {
      this.publishTimer = setTimeout(() => {
        this.publishTimer = null;
        this.publishNow();
      }, wait);
      this.publishTimer.unref();
    }
  }

  private fail(error: 'unavailable' | 'failed'): void {
    this.wantPaused = false;
    this.set({ phase: 'error', error, position: 0, duration: 0 });
    this.publishNow();
  }

  private finishFade(): void {
    if (this.fadeTimer) clearInterval(this.fadeTimer);
    this.fadeTimer = null;
    this.token++;
    this.wantPaused = false;
    if (this.proc?.running) {
      this.proc.send(['stop']);
      this.proc.send(['set_property', 'volume', this.state.volume]);
    }
    this.set({ phase: 'idle', trackId: null, position: 0, duration: 0, error: undefined });
    this.publishNow();
  }

  /** Ends a running fade and puts the volume back, before any other command takes over. */
  private cancelFade(): void {
    if (this.fadeTimer === null) return;
    clearInterval(this.fadeTimer);
    this.fadeTimer = null;
    if (this.proc?.running) this.proc.send(['set_property', 'volume', this.state.volume]);
  }

  private async load(trackId: string, token: number): Promise<void> {
    try {
      const entries = await this.opts.loadEntries();
      if (token !== this.token) return;
      const url = playUrlOf(entries, trackId);
      if (url === null) {
        this.fail('unavailable');
        return;
      }
      const proc = await this.ensureProcess();
      // A newer play, stop or shutdown may have happened while mpv was starting.
      if (token !== this.token) return;
      const sent =
        proc.send(['set_property', 'volume', this.state.volume]) &&
        proc.send(['set_property', 'loop-file', this.state.loop ? 'inf' : 'no']) &&
        proc.send(['loadfile', url, 'replace']) &&
        proc.send(['set_property', 'pause', this.wantPaused]);
      if (!sent) {
        this.opts.log('[music] mpv is not connected; the track was not loaded');
        this.fail('failed');
      }
    } catch (err) {
      if (token !== this.token) return;
      this.opts.log(`[music] playback failed: ${err instanceof Error ? err.message : String(err)}`);
      this.fail('failed');
    }
  }

  /** The running mpv process, started on first use. Concurrent callers share one start. */
  private ensureProcess(): Promise<MpvProcess> {
    if (this.closed) return Promise.reject(new Error('the music player is closed'));
    if (this.proc?.running) return Promise.resolve(this.proc);
    if (this.starting) return this.starting;
    if (!this.tools.ok) return Promise.reject(new Error('mpv is not installed'));
    const spawnOpts: MpvSpawnOptions = {
      tools: this.tools.tools,
      volume: this.state.volume,
      loop: this.state.loop,
      log: this.opts.log,
    };
    const proc = this.opts.spawn ? this.opts.spawn(spawnOpts) : new MpvProcess(spawnOpts);
    proc.on('line', (line) => this.onLine(line));
    proc.on('property', (name, value) => this.onProperty(name, value));
    proc.on('event', (event) => this.onEvent(event));
    proc.on('exit', () => this.onProcessExit(proc));
    this.starting = proc
      .start()
      .then(() => {
        this.proc = proc;
        return proc;
      })
      .finally(() => {
        this.starting = null;
      });
    return this.starting;
  }

  /** Classifies an mpv load error once the yt-dlp message had time to arrive, and only for the same play. */
  private scheduleFailure(): void {
    if (this.failTimer !== null) return;
    const token = this.token;
    this.failTimer = setTimeout(() => {
      this.failTimer = null;
      if (token !== this.token) return;
      const phase = this.state.phase;
      if (phase !== 'loading' && phase !== 'playing' && phase !== 'paused') return;
      const unavailable = UNAVAILABLE_MESSAGE.test(this.stderrTail.join('\n'));
      this.opts.log(`[music] mpv could not play the track (${unavailable ? 'unavailable' : 'failed'})`);
      this.fail(unavailable ? 'unavailable' : 'failed');
    }, CLASSIFY_GRACE_MS);
    this.failTimer.unref();
  }

  private onProcessExit(proc: MpvProcess): void {
    if (this.proc !== proc) return;
    this.proc = null;
    if (this.fadeTimer) clearInterval(this.fadeTimer);
    this.fadeTimer = null;
    if (this.state.phase === 'loading' || this.state.phase === 'playing' || this.state.phase === 'paused') {
      this.fail('failed');
    }
  }

  private onLine(line: string): void {
    this.stderrTail.push(line);
    if (this.stderrTail.length > STDERR_TAIL_LINES) this.stderrTail.splice(0, this.stderrTail.length - STDERR_TAIL_LINES);
  }

  private onProperty(name: string, value: unknown): void {
    const phase = this.state.phase;
    const hasTrack = phase === 'loading' || phase === 'playing' || phase === 'paused';
    switch (name) {
      case 'time-pos':
        if (hasTrack && typeof value === 'number' && Number.isFinite(value)) {
          this.set({ position: value });
          this.publishSoon();
        }
        break;
      case 'duration':
        if (hasTrack) {
          this.set({ duration: typeof value === 'number' && Number.isFinite(value) ? value : 0 });
          this.publishSoon();
        }
        break;
      case 'pause':
        if (phase === 'playing' || phase === 'paused') {
          this.set({ phase: value === true ? 'paused' : 'playing' });
          this.publishNow();
        }
        break;
      case 'idle-active':
        // mpv went idle by itself (the track ended, loop off): back to idle.
        if (value === true && (phase === 'playing' || phase === 'paused')) {
          this.wantPaused = false;
          this.set({ phase: 'idle', trackId: null, position: 0, duration: 0 });
          this.publishNow();
        }
        break;
      default:
        break;
    }
  }

  private onEvent(event: Record<string, unknown>): void {
    const phase = this.state.phase;
    switch (event.event) {
      case 'file-loaded':
      case 'playback-restart':
        if (phase === 'loading') {
          const paused = this.wantPaused;
          this.set({ phase: paused ? 'paused' : 'playing', error: undefined });
          if (paused) this.proc?.send(['set_property', 'pause', true]);
          this.publishNow();
        }
        break;
      case 'end-file':
        if (event.reason === 'error' && (phase === 'loading' || phase === 'playing' || phase === 'paused')) {
          this.scheduleFailure();
        }
        break;
      default:
        break;
    }
  }
}

type ParseResult = { ok: true; command: MusicCommand } | { ok: false; error: string };

const TRACK_ID = /^[0-9a-f]{12}$/;
const MAX_SEEK_SECONDS = 86400;

/** The keys each command takes besides `command`. */
const SHAPES: Record<MusicCommand['command'], string[]> = {
  play: ['trackId'],
  pause: [],
  resume: [],
  stop: [],
  fadeout: [],
  seek: ['value'],
  volume: ['value'],
  loop: ['value'],
};

function refuse(error: string): ParseResult {
  return { ok: false, error };
}

/** Checks a request body against the command contract. Unknown keys and out-of-range values are refused. */
export function parseMusicCommand(body: unknown): ParseResult {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return refuse('The music command must be a JSON object with a "command" field.');
  }
  const input = body as Record<string, unknown>;
  const name = input.command;
  if (typeof name !== 'string' || !Object.hasOwn(SHAPES, name)) {
    return refuse(`Unknown music command. Use one of: ${Object.keys(SHAPES).join(', ')}.`);
  }
  const command = name as MusicCommand['command'];
  const allowed = ['command', ...SHAPES[command]];
  for (const key of Object.keys(input)) {
    if (!allowed.includes(key)) return refuse(`The music command "${command}" does not take "${key}".`);
  }
  switch (command) {
    case 'play': {
      const trackId = input.trackId;
      if (typeof trackId !== 'string' || !TRACK_ID.test(trackId)) {
        return refuse('The track id must be 12 lowercase hexadecimal characters.');
      }
      return { ok: true, command: { command, trackId } };
    }
    case 'seek': {
      const value = input.value;
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > MAX_SEEK_SECONDS) {
        return refuse(`The seek position must be a number of seconds from 0 to ${MAX_SEEK_SECONDS}.`);
      }
      return { ok: true, command: { command, value } };
    }
    case 'volume': {
      const value = input.value;
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
        return refuse('The volume must be a number from 0 to 100.');
      }
      return { ok: true, command: { command, value } };
    }
    case 'loop': {
      const value = input.value;
      if (typeof value !== 'boolean') return refuse('The loop setting must be true or false.');
      return { ok: true, command: { command, value } };
    }
    default:
      return { ok: true, command: { command } as MusicCommand };
  }
}

const controllers = new WeakMap<Ctx, MusicPlayback>();

/**
 * The playback controller of a campaign, created on first use. It spawns nothing by itself: mpv
 * starts on the first play. Closed with the context (ctx.onClose), so shutdown kills mpv.
 */
export function playbackFor(ctx: Ctx): MusicPlayback {
  let controller = controllers.get(ctx);
  if (controller === undefined) {
    controller = new MusicPlayback({
      tools: findMusicTools(),
      publish: (state) => ctx.bus.publish('musicstate', state),
      log: (line) => ctx.log(line),
      loadEntries: () => loadMusicEntries(ctx),
    });
    controllers.set(ctx, controller);
    const created = controller;
    ctx.onClose(() => created.shutdown());
  }
  return controller;
}
