import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { detectMusicTools, MpvProcess, mpvArgs, type MpvTools } from './mpv.js';
import { fakeMpvBinary } from './test-support.js';

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) fs.rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-mpv-test-'));
  cleanup.push(dir);
  return dir;
}

function executable(dir: string, name: string): string {
  const file = path.join(dir, name);
  fs.writeFileSync(file, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  return file;
}

async function waitFor(check: () => boolean, ms = 3000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('condition not reached in time');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe('binary lookup', () => {
  it('takes the env override first, then the fallback folders, then PATH', () => {
    const dir = tempDir();
    const override = executable(dir, 'custom-mpv');
    const pathDir = tempDir();
    executable(pathDir, 'mpv');
    const found = detectMusicTools({
      env: { MPV_PATH: override, YTDLP_PATH: executable(dir, 'yt-dlp'), PATH: pathDir },
      fallbackDirs: [],
    });
    assert.equal(found.ok, true);
    if (found.ok) assert.equal(found.tools.mpv, override);

    const viaPath = detectMusicTools({
      env: { MPV_PATH: path.join(dir, 'missing'), YTDLP_PATH: executable(dir, 'yt-dlp'), PATH: pathDir },
      fallbackDirs: [],
    });
    assert.equal(viaPath.ok, true);
    if (viaPath.ok) assert.equal(viaPath.tools.mpv, path.join(pathDir, 'mpv'));
  });

  it('reports the missing tool in plain terms: mpv first, then yt-dlp', () => {
    const empty = tempDir();
    assert.deepEqual(detectMusicTools({ env: { PATH: empty }, fallbackDirs: [] }), { ok: false, reason: 'mpv-missing' });
    const onlyMpv = detectMusicTools({ env: { PATH: empty, MPV_PATH: executable(empty, 'mpv') }, fallbackDirs: [] });
    assert.deepEqual(onlyMpv, { ok: false, reason: 'ytdlp-missing' });
  });
});

describe('mpv arguments', () => {
  it('plays audio only, through the given yt-dlp, and never expands a playlist', () => {
    const args = mpvArgs({ socketPath: '/tmp/x.sock', volume: 80, loop: true, ytdlp: '/opt/homebrew/bin/yt-dlp' });
    assert.ok(args.includes('--no-video'));
    assert.ok(args.includes('--idle=yes'));
    assert.ok(args.includes('--input-ipc-server=/tmp/x.sock'));
    assert.ok(args.includes('--loop-file=inf'));
    assert.ok(args.includes('--ytdl-raw-options=no-playlist=,playlist-items=1'));
    assert.ok(args.includes('--script-opts=ytdl_hook-ytdl_path=/opt/homebrew/bin/yt-dlp'));
    assert.deepEqual(mpvArgs({ socketPath: 's', volume: 1, loop: false, ytdlp: 'y' }).filter((a) => a.startsWith('--loop-file')), [
      '--loop-file=no',
    ]);
  });
});

describe('MpvProcess with the fake mpv', () => {
  function tools(): MpvTools {
    return { mpv: fakeMpvBinary(), ytdlp: process.execPath, deno: null };
  }

  it('starts, reports property changes and file events over IPC, then stops and removes its socket', async () => {
    const logDir = tempDir();
    const logFile = path.join(logDir, 'ipc.jsonl');
    process.env.FAKE_MPV_LOG = logFile;
    const lines: string[] = [];
    const proc = new MpvProcess({ tools: tools(), volume: 80, loop: true, log: (line) => lines.push(line) });
    const properties: Array<[string, unknown]> = [];
    const events: string[] = [];
    proc.on('property', (name, value) => properties.push([name, value]));
    proc.on('event', (event) => events.push(String(event.event)));
    try {
      await proc.start();
      assert.equal(proc.running, true);
      proc.send(['loadfile', 'https://www.youtube.com/watch?v=FORESTID123', 'replace']);
      await waitFor(() => events.includes('file-loaded'));
      await waitFor(() => properties.some(([name, value]) => name === 'duration' && value === 3));
      await waitFor(() => properties.some(([name, value]) => name === 'time-pos' && typeof value === 'number' && value > 0));
      assert.ok(events.includes('start-file'));
      const sent = fs
        .readFileSync(logFile, 'utf8')
        .trim()
        .split('\n')
        .map((line) => (JSON.parse(line) as { command: unknown[] }).command);
      assert.deepEqual(sent[0], ['observe_property', 1, 'time-pos']);
      assert.ok(sent.some((c) => c[0] === 'loadfile' && c[1] === 'https://www.youtube.com/watch?v=FORESTID123'));
      const pid = proc.pid;
      assert.ok(pid !== undefined && isAlive(pid));
      await proc.stop();
      assert.equal(proc.running, false);
      assert.equal(pid !== undefined && isAlive(pid), false, 'the child is gone after stop');
      assert.ok(lines.some((line) => line.startsWith('[mpv] fake-mpv: ready')), 'mpv output is logged with the [mpv] prefix');
    } finally {
      await proc.stop();
      delete process.env.FAKE_MPV_LOG;
    }
  });

  it('removes its control socket on stop', async () => {
    const dir = tempDir();
    const socketPath = path.join(dir, 'control.sock');
    const proc = new MpvProcess({ tools: tools(), volume: 50, loop: false, log: () => undefined, socketPath });
    await proc.start();
    assert.equal(fs.existsSync(socketPath), true);
    await proc.stop();
    assert.equal(fs.existsSync(socketPath), false);
  });

  it('fails to start when the process exits without opening its socket, and does not hang', async () => {
    const dir = tempDir();
    const broken = executable(dir, 'mpv');
    const proc = new MpvProcess({
      tools: { mpv: broken, ytdlp: process.execPath, deno: null },
      volume: 80,
      loop: true,
      log: () => undefined,
      connectTimeoutMs: 2000,
    });
    await assert.rejects(proc.start());
    assert.equal(proc.running, false);
  });

  it('escalates to SIGKILL when the child ignores quit and SIGTERM', async () => {
    const dir = tempDir();
    const socketPath = path.join(dir, 'hang.sock');
    // A stand-in that opens the socket and ignores every signal and every IPC command.
    const stubbornScript = path.join(dir, 'stubborn.mjs');
    fs.writeFileSync(
      stubbornScript,
      [
        "import net from 'node:net';",
        "process.on('SIGTERM', () => {});",
        "const socketArg = process.argv.find((a) => a.startsWith('--input-ipc-server='));",
        "net.createServer(() => {}).listen(socketArg.slice('--input-ipc-server='.length));",
        "",
      ].join("\n"),
    );
    const stubborn = path.join(dir, 'mpv');
    fs.writeFileSync(stubborn, `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(stubbornScript)} "$@"\n`, { mode: 0o755 });
    const proc = new MpvProcess({
      tools: { mpv: stubborn, ytdlp: process.execPath, deno: null },
      volume: 80,
      loop: true,
      log: () => undefined,
      socketPath,
      connectTimeoutMs: 5000,
    });
    await proc.start();
    const pid = proc.pid;
    assert.ok(pid !== undefined && isAlive(pid));
    await proc.stop(200);
    assert.equal(pid !== undefined && isAlive(pid), false);
  });
});
