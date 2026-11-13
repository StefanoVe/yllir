// Entry point: `node server.mjs --campaign <folder> --framework <folder> [options]`.
// Parses and checks the arguments, picks a loopback port, keeps the lock file, prints
// the READY line on stdout (the only stdout line), and shuts down cleanly. Owner: server skeleton.
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { createApp } from './app.js';
import { createCtx } from './context.js';
import { agentStatus } from './agent/index.js';
import { startWatcher } from './docs/watcher.js';
import { setExternalFrameworkRoot } from './docs/external.js';
import { startLiveWatcher } from './live/watcher.js';

const DEFAULT_PORT = 4317;
const PORT_ATTEMPTS = 200;
const EXIT_GRACE_MS = 60_000;

const USAGE = [
  'Usage: node server.mjs --campaign <folder> --framework <folder> [options]',
  '',
  'Options:',
  '  --campaign <folder>   the campaign folder (must contain campaign.yaml)',
  '  --framework <folder>  the Yllir plugin folder (must contain scripts/engine.mjs)',
  '  --port <n>            port on 127.0.0.1 (default: first free port from 4317)',
  '  --open                open the screen in the default browser',
  '  --exit-when-closed    exit 60 s after the last browser tab was closed',
  '  --help                show this help',
].join('\n');

function stderrLine(message: string): void {
  process.stderr.write(`${message}\n`);
}

function fail(message: string, code = 2): never {
  stderrLine(message);
  process.exit(code);
}

function parseCli(argv: string[]) {
  try {
    return parseArgs({
      args: argv,
      strict: true,
      allowPositionals: false,
      options: {
        campaign: { type: 'string' },
        framework: { type: 'string' },
        port: { type: 'string' },
        open: { type: 'boolean' },
        'exit-when-closed': { type: 'boolean' },
        help: { type: 'boolean' },
      },
    }).values;
  } catch {
    return fail('Unknown or incomplete option. Run with --help to see the options.');
  }
}

async function isFile(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isFile();
  } catch {
    return false;
  }
}

async function isDirectory(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

function parsePort(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const port = Number(value);
  if (!/^\d+$/.test(value) || port < 1 || port > 65535) {
    return fail('The port must be a number between 1 and 65535.');
  }
  return port;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

interface LockInfo {
  pid: number;
  port: number;
  url: string;
}

/** The lock of a live server of this campaign, or null. A stale lock (dead pid) is ignored. */
async function liveLock(lockPath: string): Promise<LockInfo | null> {
  let info: unknown;
  try {
    info = JSON.parse(await fs.readFile(lockPath, 'utf8'));
  } catch {
    return null;
  }
  if (typeof info !== 'object' || info === null) return null;
  const { pid, port, url } = info as Partial<LockInfo>;
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return null;
  if (typeof port !== 'number' || typeof url !== 'string') return null;
  return isProcessAlive(pid) ? { pid, port, url } : null;
}

async function writeLock(lockPath: string, info: LockInfo): Promise<void> {
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  await fs.writeFile(lockPath, `${JSON.stringify(info)}\n`, 'utf8');
}

async function removeLock(lockPath: string): Promise<void> {
  try {
    const info = JSON.parse(await fs.readFile(lockPath, 'utf8')) as Partial<LockInfo>;
    if (info.pid === process.pid) await fs.rm(lockPath, { force: true });
  } catch {
    // no lock file, or unreadable: nothing of ours to remove
  }
}

function listenOn(server: http.Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (err: Error) => reject(err);
    server.once('error', onError);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', onError);
      resolve();
    });
  });
}

/** From the requested port, or from 4317 upward. Throws with code NO_PORT when none is free. */
async function listenOnFreePort(requested: number | undefined): Promise<{ server: http.Server; port: number }> {
  const first = requested ?? DEFAULT_PORT;
  const last = requested ?? DEFAULT_PORT + PORT_ATTEMPTS - 1;
  for (let port = first; port <= last; port++) {
    const server = http.createServer();
    try {
      await listenOn(server, port);
      const actual = (server.address() as AddressInfo).port;
      return { server, port: actual };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw err;
    }
  }
  throw Object.assign(new Error('no free port'), { code: 'NO_PORT' });
}

function openBrowser(url: string, log: (msg: string) => void): void {
  const isWindows = process.platform === 'win32';
  let command: string;
  let args: string[];
  if (process.platform === 'darwin') {
    command = 'open';
    args = [url];
  } else if (isWindows) {
    command = 'cmd';
    args = ['/c', 'start', '""', url];
  } else {
    command = 'xdg-open';
    args = [url];
  }
  const child = spawn(command, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    windowsVerbatimArguments: isWindows,
  });
  child.on('error', () => log(`Could not open the browser. Open this address yourself: ${url}`));
  child.unref();
}

async function main(): Promise<void> {
  const values = parseCli(process.argv.slice(2));
  if (values.help) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  if (!values.campaign) fail('Missing --campaign <folder>. Run with --help to see the options.');
  if (!values.framework) fail('Missing --framework <folder>. Run with --help to see the options.');

  const campaignRoot = path.resolve(values.campaign);
  const frameworkRoot = path.resolve(values.framework);
  if (!(await isDirectory(campaignRoot)) || !(await isFile(path.join(campaignRoot, 'campaign.yaml')))) {
    fail(`This folder is not a Yllir campaign: campaign.yaml is missing in ${campaignRoot}.`);
  }
  if (!(await isFile(path.join(frameworkRoot, 'scripts', 'engine.mjs')))) {
    fail(`The Yllir plugin folder is wrong: scripts/engine.mjs is missing in ${frameworkRoot}.`);
  }

  const requestedPort = parsePort(values.port);
  const lockPath = path.join(campaignRoot, '.campaign', 'state', 'master-screen', 'server.json');
  const running = await liveLock(lockPath);
  if (running) {
    fail(`The master screen is already running for this campaign at ${running.url}.`);
  }

  let listening: { server: http.Server; port: number };
  try {
    listening = await listenOnFreePort(requestedPort);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'NO_PORT') {
      fail(
        requestedPort === undefined
          ? 'No free port was found on this computer, from 4317 upward.'
          : `Port ${requestedPort} is already in use.`,
      );
    }
    throw err;
  }
  const { server, port } = listening;
  const url = `http://127.0.0.1:${port}`;
  const log = stderrLine;

  setExternalFrameworkRoot(frameworkRoot);
  const ctx = createCtx({
    campaignRoot,
    frameworkRoot,
    port,
    log,
    agentStatus: () => agentStatus(campaignRoot),
    requestShutdown: () => {
      void shutdown(0);
    },
  });
  server.on('request', createApp(ctx));
  const stopWatcher = startWatcher(ctx);
  const stopLiveWatcher = startLiveWatcher(ctx);
  await writeLock(lockPath, { pid: process.pid, port, url });

  let stopping: Promise<void> | null = null;
  const shutdown = (code: number): Promise<void> => {
    if (stopping === null) {
      stopping = (async () => {
        await stopWatcher().catch((err: unknown) => log(`watcher stop failed: ${String(err)}`));
        await stopLiveWatcher().catch((err: unknown) => log(`live watcher stop failed: ${String(err)}`));
        ctx.bus.close();
        await ctx.closeAll();
        await new Promise<void>((resolve) => {
          server.close(() => resolve());
          server.closeAllConnections();
        });
        await removeLock(lockPath);
      })().finally(() => process.exit(code));
    }
    return stopping;
  };

  process.on('SIGINT', () => void shutdown(0));
  process.on('SIGTERM', () => void shutdown(0));

  if (values['exit-when-closed']) {
    let sawClient = false;
    let timer: NodeJS.Timeout | null = null;
    ctx.bus.onClientsChange((count) => {
      if (count > 0) {
        sawClient = true;
        if (timer) clearTimeout(timer);
        timer = null;
        return;
      }
      if (sawClient && timer === null) {
        timer = setTimeout(() => void shutdown(0), EXIT_GRACE_MS);
      }
    });
  }

  process.stdout.write(`${JSON.stringify({ ready: true, url, pid: process.pid })}\n`);
  if (values.open) openBrowser(url, log);
}

main().catch((err: unknown) => {
  stderrLine(`The master screen could not start: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
