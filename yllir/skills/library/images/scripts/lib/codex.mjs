// Client of the Codex CLI: delegates one image generation to it. A job folder holds
// job.json; the result goes to result.png and run.json beside it, and the CLI output
// is appended to codex.log. Environment variables and keys are never written anywhere.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const KILL_GRACE_MS = 2000;
const MESSAGE_LIMIT = 200;

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

function hasPngSignature(file) {
  try {
    return fs.readFileSync(file).subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE);
  } catch {
    return false;
  }
}

function lastLogLine(text) {
  const lines = text.split('\n').map((line) => line.trim()).filter((line) => line !== '');
  return lines.length > 0 ? lines[lines.length - 1] : '';
}

/** Runs one job through Codex. Resolves to { ok: true } or { ok: false, error, message }. */
export function runCodex({ jobDir, command = 'codex', timeoutMs = 600000, stallMs = 180000 }) {
  const job = JSON.parse(fs.readFileSync(path.join(jobDir, 'job.json'), 'utf8'));
  if (job.operation !== 'generate') {
    return Promise.resolve(failure('unsupported', `operation ${job.operation} is not supported by codex`));
  }

  const resultPath = path.join(jobDir, 'result.png');
  const logPath = path.join(jobDir, 'codex.log');
  const args = [
    'exec',
    '--skip-git-repo-check',
    '--enable',
    'image_generation',
    '--sandbox',
    'workspace-write',
    '-C',
    jobDir,
    buildInstruction(job, resultPath),
  ];

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
