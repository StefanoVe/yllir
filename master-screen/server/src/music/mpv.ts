// Spawns mpv on the server's machine and talks to it through its JSON IPC socket. Audio only:
// mpv streams YouTube through yt-dlp, so nothing is rendered and nothing is played in the browser.
// Port of the behaviour of the ost-planner MPV.swift (structure is ours). Owner: music engineer.
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

export interface MpvTools {
  mpv: string;
  ytdlp: string;
  /** deno is optional: yt-dlp uses it for some YouTube challenges; its folder joins PATH when found. */
  deno: string | null;
}

export type ToolsResult =
  | { ok: true; tools: MpvTools }
  | { ok: false; reason: 'mpv-missing' | 'ytdlp-missing' };

export interface DetectOptions {
  env?: NodeJS.ProcessEnv;
  /** Folders searched after the env override and before PATH. Tests pass [] to see a missing tool. */
  fallbackDirs?: string[];
}

const DEFAULT_FALLBACK_DIRS = ['/opt/homebrew/bin', '/usr/local/bin'];

function isExecutableFile(file: string): boolean {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

/**
 * The executable of one tool: the env override first, then the fallback folders, then PATH.
 * macOS apps started outside a shell do not see /opt/homebrew/bin on PATH, hence the fallbacks.
 */
export function findExecutable(name: string, envKey: string, opts: DetectOptions = {}): string | null {
  const env = opts.env ?? process.env;
  const dirs = opts.fallbackDirs ?? DEFAULT_FALLBACK_DIRS;
  const candidates: string[] = [];
  const override = env[envKey];
  if (override) candidates.push(override);
  for (const dir of dirs) candidates.push(path.join(dir, name));
  for (const dir of (env.PATH ?? '').split(path.delimiter)) {
    if (dir) candidates.push(path.join(dir, name));
  }
  return candidates.find(isExecutableFile) ?? null;
}

/** Looks for mpv and yt-dlp (and deno). Not cached: see findMusicTools for the cached form. */
export function detectMusicTools(opts: DetectOptions = {}): ToolsResult {
  const mpv = findExecutable('mpv', 'MPV_PATH', opts);
  if (mpv === null) return { ok: false, reason: 'mpv-missing' };
  const ytdlp = findExecutable('yt-dlp', 'YTDLP_PATH', opts);
  if (ytdlp === null) return { ok: false, reason: 'ytdlp-missing' };
  const deno = findExecutable('deno', 'DENO_PATH', opts);
  return { ok: true, tools: { mpv, ytdlp, deno } };
}

let cachedTools: ToolsResult | undefined;

/** The tools of this process, looked up once. Cheap to call on every request. */
export function findMusicTools(): ToolsResult {
  if (cachedTools === undefined) cachedTools = detectMusicTools();
  return cachedTools;
}

/** Forgets the cached lookup (tests, or after the author installs the tools while the server runs). */
export function resetMusicToolsCache(): void {
  cachedTools = undefined;
}

export interface MpvSpawnOptions {
  tools: MpvTools;
  volume: number;
  loop: boolean;
  /** Receives every mpv output line, prefixed with `[mpv]`, and the IPC notices. */
  log: (line: string) => void;
  /** Control socket path. Default: a unique file in os.tmpdir(). */
  socketPath?: string;
  /** How long to wait for mpv to open its socket. Default 5000 ms. */
  connectTimeoutMs?: number;
  /** Base environment of the child. Default: process.env. */
  env?: NodeJS.ProcessEnv;
}

/** Events: 'property' (name, value), 'event' (raw mpv event object), 'line' (output line), 'exit'. */
export interface MpvProcessEvents {
  property: [name: string, value: unknown];
  event: [event: Record<string, unknown>];
  line: [line: string];
  exit: [code: number | null, signal: NodeJS.Signals | null];
}

/** Properties observed from the start, in this order. */
const OBSERVED = ['time-pos', 'duration', 'pause', 'idle-active', 'eof-reached'];

/** Children still alive, killed synchronously when this process exits (parent death). */
const liveChildren = new Set<ChildProcess>();
let exitHookInstalled = false;

function installExitHook(): void {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.on('exit', () => {
    for (const child of liveChildren) {
      try {
        child.kill('SIGKILL');
      } catch {
        // already gone
      }
    }
    liveChildren.clear();
  });
}

/** The mpv arguments of a playback instance, as the reference app uses them. */
export function mpvArgs(opts: { socketPath: string; volume: number; loop: boolean; ytdlp: string }): string[] {
  return [
    '--no-config',
    '--idle=yes',
    '--no-video',
    '--no-terminal',
    '--force-window=no',
    `--input-ipc-server=${opts.socketPath}`,
    `--volume=${opts.volume}`,
    `--loop-file=${opts.loop ? 'inf' : 'no'}`,
    // Direct DASH URLs answer 403 to ffmpeg; the HLS audio variants stream and seek.
    '--ytdl-format=bestaudio[protocol^=m3u8]/bestaudio/best',
    // Only the single video of a playlist or radio URL, never the list. SoundCloud sets ignore
    // no-playlist, so yt-dlp also takes just the first entry (playlist-items=1): the set never expands.
    '--ytdl-raw-options=no-playlist=,playlist-items=1',
    `--script-opts=ytdl_hook-ytdl_path=${opts.ytdlp}`,
  ];
}

/** One mpv process with its IPC connection. Start it with start(); stop() kills it and removes the socket. */
export class MpvProcess extends EventEmitter<MpvProcessEvents> {
  private child: ChildProcess | null = null;
  private socket: net.Socket | null = null;
  private socketPath = '';
  private exited = false;

  constructor(private readonly opts: MpvSpawnOptions) {
    super();
  }

  /** The child's process id, once started. */
  get pid(): number | undefined {
    return this.child?.pid;
  }

  /** True while the child runs and its control socket is connected. */
  get running(): boolean {
    return this.child !== null && !this.exited && this.socket !== null && !this.socket.destroyed;
  }

  async start(): Promise<void> {
    if (this.child !== null) throw new Error('mpv is already started');
    this.socketPath =
      this.opts.socketPath ?? path.join(os.tmpdir(), `yllir-mpv-${process.pid}-${randomBytes(4).toString('hex')}.sock`);
    fs.rmSync(this.socketPath, { force: true });

    const env = { ...(this.opts.env ?? process.env) };
    // A macOS app started outside a shell lacks the Homebrew folders: extend PATH with the tools' folders.
    const extra = [this.opts.tools.mpv, this.opts.tools.ytdlp, this.opts.tools.deno]
      .filter((file): file is string => file !== null)
      .map((file) => path.dirname(file));
    const basePath = env.PATH ?? '';
    env.PATH = [...extra, ...basePath.split(path.delimiter).filter(Boolean)].join(path.delimiter);

    const args = mpvArgs({
      socketPath: this.socketPath,
      volume: this.opts.volume,
      loop: this.opts.loop,
      ytdlp: this.opts.tools.ytdlp,
    });
    const child = spawn(this.opts.tools.mpv, args, { stdio: ['ignore', 'pipe', 'pipe'], env });
    this.child = child;
    liveChildren.add(child);
    installExitHook();

    const emitLine = (chunk: Buffer, pending: { text: string }): void => {
      pending.text += chunk.toString('utf8');
      let newline = pending.text.indexOf('\n');
      while (newline >= 0) {
        const line = pending.text.slice(0, newline).replace(/\r$/, '');
        pending.text = pending.text.slice(newline + 1);
        if (line !== '') {
          this.opts.log(`[mpv] ${line}`);
          this.emit('line', line);
        }
        newline = pending.text.indexOf('\n');
      }
    };
    const stdoutPending = { text: '' };
    const stderrPending = { text: '' };
    child.stdout?.on('data', (chunk: Buffer) => emitLine(chunk, stdoutPending));
    child.stderr?.on('data', (chunk: Buffer) => emitLine(chunk, stderrPending));

    child.on('error', (err) => {
      this.opts.log(`[mpv] process error: ${err.message}`);
      this.handleExit(null, null);
    });
    child.on('exit', (code, signal) => this.handleExit(code, signal));

    try {
      this.socket = await this.connect(this.opts.connectTimeoutMs ?? 5000);
    } catch (err) {
      await this.stop();
      throw err;
    }
    this.socket.on('data', (chunk: Buffer) => this.readIpc(chunk));
    this.socket.on('error', () => {
      // A broken socket ends the IPC; the process exit (or stop) takes it from there.
    });

    OBSERVED.forEach((name, index) => this.send(['observe_property', index + 1, name]));
  }

  /** Sends one IPC command. Returns false when the connection is not open (the command is dropped). */
  send(command: unknown[]): boolean {
    if (!this.running || this.socket === null) return false;
    this.socket.write(`${JSON.stringify({ command })}\n`);
    return true;
  }

  /** Quits mpv: `quit` over IPC, then SIGTERM, then SIGKILL. Removes the socket. Never throws. */
  async stop(graceMs = 1500): Promise<void> {
    const child = this.child;
    if (child !== null && !this.exited) {
      this.send(['quit']);
      const exitedInTime = await this.waitForExit(graceMs);
      if (!exitedInTime) {
        child.kill('SIGTERM');
        if (!(await this.waitForExit(1000))) {
          child.kill('SIGKILL');
          await this.waitForExit(1000);
        }
      }
    }
    this.socket?.destroy();
    this.socket = null;
    if (this.socketPath) fs.rmSync(this.socketPath, { force: true });
    if (child) liveChildren.delete(child);
  }

  private waitForExit(ms: number): Promise<boolean> {
    if (this.exited) return Promise.resolve(true);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.off('exit', onExit);
        resolve(false);
      }, ms);
      const onExit = (): void => {
        clearTimeout(timer);
        resolve(true);
      };
      this.once('exit', onExit);
    });
  }

  private handleExit(code: number | null, signal: NodeJS.Signals | null): void {
    if (this.exited) return;
    this.exited = true;
    if (this.child) liveChildren.delete(this.child);
    this.socket?.destroy();
    this.socket = null;
    if (this.socketPath) fs.rmSync(this.socketPath, { force: true });
    this.opts.log(`[mpv] exited (code ${code ?? 'none'}, signal ${signal ?? 'none'})`);
    this.emit('exit', code, signal);
  }

  private async connect(timeoutMs: number): Promise<net.Socket> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (this.exited) throw new Error('mpv stopped before it opened its control socket');
      try {
        return await new Promise<net.Socket>((resolve, reject) => {
          const socket = net.createConnection(this.socketPath);
          socket.once('connect', () => resolve(socket));
          socket.once('error', (err) => {
            socket.destroy();
            reject(err);
          });
        });
      } catch {
        if (Date.now() >= deadline) throw new Error('mpv did not open its control socket in time');
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
  }

  private pendingIpc = '';

  private readIpc(chunk: Buffer): void {
    this.pendingIpc += chunk.toString('utf8');
    let newline = this.pendingIpc.indexOf('\n');
    while (newline >= 0) {
      const line = this.pendingIpc.slice(0, newline);
      this.pendingIpc = this.pendingIpc.slice(newline + 1);
      newline = this.pendingIpc.indexOf('\n');
      if (line.trim() === '') continue;
      let message: unknown;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      if (typeof message !== 'object' || message === null) continue;
      const obj = message as Record<string, unknown>;
      if (obj.event === 'property-change') {
        this.emit('property', String(obj.name), obj.data);
      } else if (typeof obj.event === 'string') {
        this.emit('event', obj);
      } else if (typeof obj.error === 'string' && obj.error !== 'success') {
        this.opts.log(`[mpv] command failed: ${obj.error}`);
      }
    }
  }
}
