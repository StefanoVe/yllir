// Client of the Codex CLI: delegates one image generation to it. A job folder holds
// job.json; the result goes to result.png and run.json beside it, and the CLI output
// is appended to codex.log. Environment variables and keys are never written anywhere.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PNG_SIGNATURE } from '../../../../scripts/lib/png-signature.mjs';

const KILL_GRACE_MS = 2000;
const MESSAGE_LIMIT = 200;
const FALLBACK_SLACK_MS = 2000;

function oneLine(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

function failure(error, message) {
  const text = oneLine(message);
  return { ok: false, error, message: text.length > MESSAGE_LIMIT ? text.slice(0, MESSAGE_LIMIT) : text };
}

/** Checks that the Codex CLI is installed and answers `--version`. */
export function probeCodex({ command = 'codex', timeoutMs = 5000 } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    let stdout = '';
    const notWorking = { available: false, version: null, reason: 'not-working' };
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    let child;
    try {
      child = spawn(command, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch {
      finish(notWorking);
      return;
    }

    timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(notWorking);
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', () => {});
    child.on('error', (err) => {
      finish({ available: false, version: null, reason: err.code === 'ENOENT' ? 'not-installed' : 'not-working' });
    });
    child.on('close', (code) => {
      if (code === 0) finish({ available: true, version: stdout.trim(), reason: null });
      else finish(notWorking);
    });
  });
}

/** The text given to Codex for one generate job. */
export function buildInstruction(job, outputPath) {
  return (
    `Generate exactly one image with your image generation tool. ` +
    `Description: ${job.prompt}. ` +
    `Avoid: ${job.negative || 'nothing'}. ` +
    `Size about ${job.width}x${job.height}. ` +
    `Save the final image as a PNG file at exactly this path: ${outputPath}. ` +
    `If the tool saves it elsewhere, copy it to that path. ` +
    `Do nothing else: do not edit any other file, do not ask questions.`
  );
}

/**
 * The text given to Codex for one repaint job: job.prompt is the full repaint prompt
 * (see atlas-repaint-job.mjs), sent word for word, followed only by the save instruction.
 */
export function buildRepaintInstruction(job, outputPath) {
  return (
    `${job.prompt} ` +
    `Save the final image as a PNG file at exactly this path: ${outputPath}. ` +
    `If the tool saves it elsewhere, copy it to that path. ` +
    `Do nothing else: do not edit any other file, do not ask questions.`
  );
}

/**
 * The arguments of `codex exec` for one job. A repaint job with an input picture attaches
 * it with `-i`; the variadic option is closed with `--` so the instruction is not read as a file.
 */
export function codexArgs(job, jobDir, resultPath) {
  const base = ['exec', '--skip-git-repo-check', '--enable', 'image_generation', '--sandbox', 'workspace-write', '-C', jobDir];
  if (job.operation === 'repaint' && typeof job.input === 'string') {
    return [...base, '-i', path.join(jobDir, job.input), '--', buildRepaintInstruction(job, resultPath)];
  }
  if (job.operation === 'repaint') {
    return [...base, buildRepaintInstruction(job, resultPath)];
  }
  return [...base, buildInstruction(job, resultPath)];
}

function hasPngSignature(file) {
  try {
    return fs.readFileSync(file).subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE);
  } catch {
    return false;
  }
}

/**
 * Looks for a PNG that codex generated but could not copy to the job folder: the CLI saves
 * it under <codexHome>/generated_images/<session>/. Only files modified at or after startedAt
 * (with clock slack) and with the PNG signature qualify; the newest qualifying file wins.
 * The original is never moved or deleted. Returns its path, or null.
 */
function findFallbackPng(codexHome, startedAt) {
  const root = path.join(codexHome, 'generated_images');
  let sessions;
  try {
    sessions = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return null;
  }
  const candidates = [];
  for (const session of sessions) {
    if (!session.isDirectory()) continue;
    const sessionDir = path.join(root, session.name);
    let names;
    try {
      names = fs.readdirSync(sessionDir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!name.endsWith('.png')) continue;
      const file = path.join(sessionDir, name);
      try {
        const stat = fs.statSync(file);
        if (stat.isFile() && stat.mtimeMs >= startedAt - FALLBACK_SLACK_MS) {
          candidates.push({ file, mtimeMs: stat.mtimeMs });
        }
      } catch {
        // the file vanished between the listing and the stat: not a candidate
      }
    }
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const found = candidates.find((candidate) => hasPngSignature(candidate.file));
  return found ? found.file : null;
}

function lastLogLine(text) {
  const lines = text.split('\n').map((line) => line.trim()).filter((line) => line !== '');
  return lines.length > 0 ? lines[lines.length - 1] : '';
}

/**
 * Runs one job through Codex. Resolves to { ok: true } or { ok: false, error, message }.
 * The codex binary is `command`, else the YLLIR_CODEX_BIN variable, else `codex` on the PATH.
 * When codex generated an image but did not copy it to result.png, the newest fresh PNG under
 * `codexHome`/generated_images is copied there (see findFallbackPng).
 */
export function runCodex({
  jobDir,
  command = process.env.YLLIR_CODEX_BIN || 'codex',
  timeoutMs = 600000,
  stallMs = 180000,
  codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex'),
}) {
  const job = JSON.parse(fs.readFileSync(path.join(jobDir, 'job.json'), 'utf8'));
  if (job.operation !== 'generate' && job.operation !== 'repaint') {
    return Promise.resolve(failure('unsupported', `operation ${job.operation} is not supported by codex`));
  }
  if (job.operation === 'repaint' && typeof job.input === 'string' && !fs.existsSync(path.join(jobDir, job.input))) {
    return Promise.resolve(failure('failed', 'the input picture of the repaint job is missing'));
  }

  const resultPath = path.join(jobDir, 'result.png');
  const logPath = path.join(jobDir, 'codex.log');
  const args = codexArgs(job, jobDir, resultPath);

  return new Promise((resolve) => {
    let settled = false;
    let expired = false;
    let output = '';
    let child = null;
    let stallTimer = null;
    let hardTimer = null;
    let graceTimer = null;

    const settle = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(stallTimer);
      clearTimeout(hardTimer);
      clearTimeout(graceTimer);
      resolve(result);
    };

    const expire = () => {
      if (expired || settled) return;
      expired = true;
      clearTimeout(stallTimer);
      clearTimeout(hardTimer);
      child.kill('SIGTERM');
      graceTimer = setTimeout(() => {
        child.kill('SIGKILL');
        settle(failure('timeout', 'codex did not finish in time and was stopped'));
      }, KILL_GRACE_MS);
    };

    const resetStall = () => {
      if (expired) return;
      clearTimeout(stallTimer);
      stallTimer = setTimeout(expire, stallMs);
    };

    const onData = (chunk) => {
      fs.appendFileSync(logPath, chunk);
      output += chunk;
      resetStall();
    };

    // A retry reuses the job folder: outputs of an earlier attempt must never count as success.
    fs.rmSync(resultPath, { force: true });
    fs.rmSync(path.join(jobDir, 'run.json'), { force: true });
    fs.appendFileSync(logPath, '');
    const startedAt = Date.now();
    try {
      child = spawn(command, args, { cwd: jobDir, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      settle(failure('failed', err.message));
      return;
    }

    child.on('error', (err) => {
      if (err.code === 'ENOENT') settle(failure('unavailable', `codex command not found: ${command}`));
      else settle(failure('failed', err.message));
    });

    child.stdout.on('data', onData);
    child.stderr.on('data', onData);

    child.on('close', (code) => {
      if (settled) return;
      if (expired) {
        settle(failure('timeout', 'codex did not finish in time and was stopped'));
        return;
      }
      if (!hasPngSignature(resultPath)) {
        const fallback = findFallbackPng(codexHome, startedAt);
        if (fallback) {
          try {
            fs.copyFileSync(fallback, resultPath);
            fs.appendFileSync(logPath, `fallback: copied ${fallback}\n`);
          } catch {
            // the copy failed: the check below reports the missing image as before
          }
        }
      }
      if (hasPngSignature(resultPath)) {
        fs.writeFileSync(
          path.join(jobDir, 'run.json'),
          `${JSON.stringify({ provider: 'codex', parameters: { width: job.width, height: job.height } }, null, 2)}\n`,
        );
        settle({ ok: true });
        return;
      }
      if (code === 0) {
        settle(failure('failed', 'no image produced'));
        return;
      }
      settle(failure('failed', lastLogLine(output) || `codex exited with code ${code}`));
    });

    resetStall();
    hardTimer = setTimeout(expire, timeoutMs);
  });
}
