// Runs the framework's engine and loads its library modules. Reads of the campaign go
// through here only. Owner: server skeleton.
import { execFile } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Ctx } from './context.js';

export const ENGINE_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;
const EXIT_LINE = /^exit: (\d+)$/;

export interface EngineResult<T = unknown> {
  code: number;
  json: T | null;
}

export interface EngineOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * Splits the engine output: the JSON printed before the last `exit: <code>` line and
 * that code. Without an exit line, code is null and the whole output is the body.
 */
export function parseEngineOutput(stdout: string): { code: number | null; json: unknown } {
  const lines = stdout.replace(/\r\n/g, '\n').split('\n');
  let exitIndex = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (EXIT_LINE.test(lines[i].trim())) {
      exitIndex = i;
      break;
    }
  }
  const code = exitIndex === -1 ? null : Number(EXIT_LINE.exec(lines[exitIndex].trim())?.[1]);
  const body = (exitIndex === -1 ? lines : lines.slice(0, exitIndex)).join('\n').trim();
  let json: unknown = null;
  if (body !== '') {
    try {
      json = JSON.parse(body);
    } catch {
      json = null;
    }
  }
  return { code, json };
}

/**
 * Runs `node <framework>/scripts/engine.mjs <command> <campaign> ...rest` without a shell.
 * args is [command, ...rest]. Never rejects: failures come back as a non-zero code.
 */
export function runEngine<T = unknown>(
  ctx: Ctx,
  args: string[],
  opts: EngineOptions = {},
): Promise<EngineResult<T>> {
  const [command, ...rest] = args;
  if (!command) return Promise.reject(new Error('runEngine needs a command'));
  const script = path.join(ctx.frameworkRoot, 'scripts', 'engine.mjs');
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [script, command, ctx.campaignRoot, ...rest],
      {
        cwd: ctx.campaignRoot,
        timeout: opts.timeoutMs ?? ENGINE_TIMEOUT_MS,
        maxBuffer: MAX_OUTPUT_BYTES,
        encoding: 'utf8',
        windowsHide: true,
        signal: opts.signal,
      },
      (err, stdout, stderr) => {
        const parsed = parseEngineOutput(String(stdout));
        if (stderr && String(stderr).trim() !== '') {
          ctx.log(`engine ${command}: ${String(stderr).trim()}`);
        }
        let code = parsed.code;
        if (code === null) {
          if (err && (err as NodeJS.ErrnoException & { killed?: boolean }).killed) code = 124;
          else if (err && typeof err.code === 'number') code = err.code;
          else code = err ? 1 : 0;
        }
        resolve({ code, json: parsed.json as T | null });
      },
    );
  });
}

const moduleCache = new Map<string, Promise<unknown>>();

/**
 * Loads `<framework>/scripts/lib/<name>.mjs` once and returns its exports.
 * A failed load is not cached, so a later call retries.
 */
export function loadFrameworkModule<T = Record<string, unknown>>(ctx: Pick<Ctx, 'frameworkRoot'>, name: string): Promise<T> {
  if (!/^[a-z0-9-]+$/.test(name)) {
    return Promise.reject(new Error(`invalid framework module name: ${name}`));
  }
  const file = path.join(ctx.frameworkRoot, 'scripts', 'lib', `${name}.mjs`);
  const cached = moduleCache.get(file);
  if (cached) return cached as Promise<T>;
  const loading = import(pathToFileURL(file).href).catch((err: unknown) => {
    moduleCache.delete(file);
    throw err;
  });
  moduleCache.set(file, loading);
  return loading as Promise<T>;
}
