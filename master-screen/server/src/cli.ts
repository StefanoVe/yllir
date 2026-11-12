// Runs one framework CLI (skills/library/<skill>/scripts/<name>.mjs) with execFile, never a
// shell. The CLI prints one JSON document, then a last line `exit: <code>`. Owner: master-screen server.
import { execFile } from 'node:child_process';
import path from 'node:path';
import type { Ctx } from './context.js';

export const CLI_TIMEOUT_MS = 120_000;
/** Code given when the CLI ran longer than the timeout and was killed. */
export const TIMED_OUT_CODE = 124;
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;
const EXIT_LINE = /^exit: (\d+)$/;

export interface CliResult<T = unknown> {
  code: number;
  /** The JSON printed before the exit line, or null when nothing was printed (or it timed out). */
  json: T | null;
}

export interface CliOptions {
  timeoutMs?: number;
}

/** The output could not be read as the contract says. Routes map it to a plain-language answer. */
export class FrameworkCliError extends Error {
  readonly reason = 'bad-output';
  constructor() {
    super('The framework answer could not be read.');
    this.name = 'FrameworkCliError';
  }
}

/** Splits the output: the text before the last `exit: <code>` line, and that code (null when absent). */
export function splitCliOutput(stdout: string): { code: number | null; body: string } {
  const lines = stdout.replace(/\r\n/g, '\n').split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const match = EXIT_LINE.exec(lines[i].trim());
    if (match) {
      return { code: Number(match[1]), body: lines.slice(0, i).join('\n').trim() };
    }
  }
  return { code: null, body: stdout.trim() };
}

/**
 * Runs `node <frameworkRoot>/<relScript> ...args` in the campaign folder. Resolves with the
 * exit code and the parsed JSON. Rejects with FrameworkCliError when printed JSON cannot be
 * read. Stderr goes to the server log only, never to the caller.
 */
export function runFrameworkCli<T = unknown>(
  ctx: Ctx,
  relScript: string,
  args: string[],
  opts: CliOptions = {},
): Promise<CliResult<T>> {
  const script = path.join(ctx.frameworkRoot, relScript);
  const name = path.basename(relScript);
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [script, ...args],
      {
        cwd: ctx.campaignRoot,
        timeout: opts.timeoutMs ?? CLI_TIMEOUT_MS,
        maxBuffer: MAX_OUTPUT_BYTES,
        encoding: 'utf8',
        windowsHide: true,
      },
      (err, stdout, stderr) => {
        if (stderr && String(stderr).trim() !== '') {
          ctx.log(`framework ${name}: ${String(stderr).trim()}`);
        }
        if (err && (err as NodeJS.ErrnoException & { killed?: boolean }).killed === true) {
          resolve({ code: TIMED_OUT_CODE, json: null });
          return;
        }
        const parsed = splitCliOutput(String(stdout ?? ''));
        let json: unknown = null;
        if (parsed.body !== '') {
          try {
            json = JSON.parse(parsed.body);
          } catch {
            reject(new FrameworkCliError());
            return;
          }
        }
        let code = parsed.code;
        if (code === null) {
          code = err ? (typeof err.code === 'number' ? err.code : 1) : 0;
        }
        resolve({ code, json: json as T | null });
      },
    );
  });
}
