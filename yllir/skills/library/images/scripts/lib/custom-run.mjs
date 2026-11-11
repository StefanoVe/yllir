// Runs one image job with a provider the master added to the campaign: a command
// provider (a terminal program, no shell) or an http provider (one web API call).
// A job folder holds job.json; the result goes to result.png and run.json beside it.
// Keys are read from the environment or the local keys file and never written to
// run.json, logs or error messages.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  campaignProvidersDir,
  fillPlaceholders,
  readKey,
  validateCampaignProvider,
} from './campaign-providers.mjs';
import { PNG_SIGNATURE } from './codex.mjs';

const STALL_MS = 180000;
const HTTP_TIMEOUT_MS = 300000;
const MESSAGE_LIMIT = 200;

const RESULT_FILE = 'result.png';
const RUN_FILE = 'run.json';
const LOG_FILE = 'provider.log';

function oneLine(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

function failure(error, message) {
  const text = oneLine(message);
  return { ok: false, error, message: text.length > MESSAGE_LIMIT ? text.slice(0, MESSAGE_LIMIT) : text };
}

function readJob(jobDir) {
  return JSON.parse(fs.readFileSync(path.join(jobDir, 'job.json'), 'utf8'));
}

function removeStale(jobDir) {
  fs.rmSync(path.join(jobDir, RESULT_FILE), { force: true });
  fs.rmSync(path.join(jobDir, RUN_FILE), { force: true });
}

function writeRun(jobDir, id, job) {
  const run = { provider: id, parameters: { width: job.width, height: job.height } };
  fs.writeFileSync(path.join(jobDir, RUN_FILE), `${JSON.stringify(run, null, 2)}\n`);
}

function startsWithPng(bytes) {
  return bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE);
}

function lastLogLine(text) {
  const lines = text.split('\n').map((line) => line.trim()).filter((line) => line !== '');
  return lines.length > 0 ? lines[lines.length - 1] : '';
}

/** Values for {NAME} placeholders of one job. KEY is the API key, or '' when none. */
export function placeholderValues(job, jobDir, key = null) {
  return {
    PROMPT: job.prompt ?? '',
    NEGATIVE: job.negative ?? '',
    OUTPUT: path.join(jobDir, RESULT_FILE),
    INPUT: job.input ?? '',
    INPUT_BASE64: job.input ? fs.readFileSync(job.input).toString('base64') : '',
    WIDTH: String(job.width),
    HEIGHT: String(job.height),
    KEY: key ?? '',
  };
}

/** Reads a dot path such as 'data.0.b64' through objects and array indexes. */
export function getPath(obj, dotPath) {
  let current = obj;
  for (const key of dotPath.split('.')) {
    if (current === null || typeof current !== 'object' || !Object.hasOwn(current, key)) return undefined;
    current = current[key];
  }
  return current;
}

/**
 * Runs a command provider: the manifest command, without a shell, in the job folder.
 * @returns {Promise<{ok: true} | {ok: false, error: string, message: string}>}
 */
export function runCommandProvider({
  root,
  jobDir,
  id,
  env = process.env,
  stallMs = STALL_MS,
  timeoutMs = null,
}) {
  const dir = path.resolve(jobDir);
  const checked = validateCampaignProvider(root, id, env);
  if (!checked.ok) return Promise.resolve(failure('invalid', checked.errors.join('; ')));
  const manifest = checked.manifest;
  if (manifest.kind !== 'command') return Promise.resolve(failure('invalid', `${id} is not a command provider`));

  const job = readJob(dir);
  if (!manifest.operations.includes(job.operation)) {
    return Promise.resolve(failure('unsupported', `${id} does not support ${job.operation}`));
  }

  const values = placeholderValues(job, dir);
  delete values.KEY;
  const argv = manifest.command.map((arg) => fillPlaceholders(arg, values));
  const limitMs = timeoutMs ?? manifest.timeout_seconds * 1000;
  const resultPath = path.join(dir, RESULT_FILE);
  const logPath = path.join(dir, LOG_FILE);

  removeStale(dir);
  fs.writeFileSync(logPath, '');

  return new Promise((resolve) => {
    let settled = false;
    let output = '';
    let child = null;
    let stallTimer = null;
    let hardTimer = null;

    const settle = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(stallTimer);
      clearTimeout(hardTimer);
      resolve(result);
    };

    const expire = (reason) => {
      if (settled) return;
      child.kill('SIGKILL');
      settle(failure('timeout', reason === 'stall'
        ? `the program printed nothing for ${Math.round(stallMs / 1000)} seconds and was stopped`
        : 'the program did not finish in time and was stopped'));
    };

    const resetStall = () => {
      clearTimeout(stallTimer);
      stallTimer = setTimeout(() => expire('stall'), stallMs);
    };

    const onData = (chunk) => {
      fs.appendFileSync(logPath, chunk);
      output += chunk;
      resetStall();
    };

    try {
      child = spawn(argv[0], argv.slice(1), { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      settle(failure('failed', err.message));
      return;
    }

    child.on('error', (err) => {
      if (err.code === 'ENOENT') settle(failure('unavailable', `program not found: ${argv[0]}`));
      else settle(failure('failed', err.message));
    });
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('close', (code) => {
      if (settled) return;
      if (code !== 0) {
        settle(failure('failed', lastLogLine(output) || `the program exited with code ${code}`));
        return;
      }
      let bytes = null;
      try {
        bytes = fs.readFileSync(resultPath);
      } catch {
        settle(failure('failed', 'no image produced'));
        return;
      }
      if (!startsWithPng(bytes)) {
        settle(failure('failed', 'output is not a PNG'));
        return;
      }
      writeRun(dir, id, job);
      settle({ ok: true });
    });

    resetStall();
    hardTimer = setTimeout(() => expire('hard'), limitMs);
  });
}

/** Replaces placeholders in every string of a JSON value, leaving the structure as it is. */
function fillDeep(value, values) {
  if (typeof value === 'string') return fillPlaceholders(value, values);
  if (Array.isArray(value)) return value.map((item) => fillDeep(item, values));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, fillDeep(item, values)]));
  }
  return value;
}

/**
 * Runs an http provider: one request.json call, then the image from the response
 * (base64 inside it, or a URL it names).
 * @returns {Promise<{ok: true} | {ok: false, error: string, message: string}>}
 */
export async function runHttpProvider({
  root,
  jobDir,
  id,
  env = process.env,
  fetchImpl = fetch,
  timeoutMs = HTTP_TIMEOUT_MS,
}) {
  const dir = path.resolve(jobDir);
  const checked = validateCampaignProvider(root, id, env);
  if (!checked.ok) return failure('invalid', checked.errors.join('; '));
  const manifest = checked.manifest;
  if (manifest.kind !== 'http') return failure('invalid', `${id} is not an http provider`);

  const job = readJob(dir);
  if (!manifest.operations.includes(job.operation)) return failure('unsupported', `${id} does not support ${job.operation}`);

  const key = readKey(root, manifest, env);
  if (manifest.key_env && key === null) {
    return failure('unavailable', `no-key: set ${manifest.key_env} in the environment`);
  }

  // Secrets never reach a message: every occurrence of the key is hidden.
  const fail = (error, message) => {
    let text = String(message ?? '');
    if (key) {
      text = text.split(key).join('***').split(encodeURIComponent(key)).join('***');
    }
    return failure(error, text);
  };

  const request = manifest.request;
  const values = placeholderValues(job, dir, key);
  const urlValues = Object.fromEntries(Object.entries(values).map(([name, value]) => [name, encodeURIComponent(value)]));
  const url = fillPlaceholders(request.url, urlValues);
  const headers = {};
  for (const [name, value] of Object.entries(request.headers ?? {})) {
    headers[name] = fillPlaceholders(value, values);
  }
  const hasBody = request.method === 'POST' && request.body !== undefined;
  if (hasBody && !Object.keys(headers).some((name) => name.toLowerCase() === 'content-type')) {
    headers['Content-Type'] = 'application/json';
  }
  const body = hasBody ? JSON.stringify(fillDeep(request.body, values)) : undefined;

  const [mode, responsePath] = Object.entries(request.response)[0];
  const resultPath = path.join(dir, RESULT_FILE);
  removeStale(dir);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response;
    try {
      response = await fetchImpl(url, { method: request.method, headers, body, signal: controller.signal });
    } catch (err) {
      if (err.name === 'AbortError') return fail('timeout', 'the service did not answer in time');
      return fail('unavailable', `could not reach the service: ${err.message}`);
    }
    if (response.status === 401 || response.status === 403) {
      return fail('failed', 'the service refused the key');
    }
    const text = await response.text();
    if (!response.ok) {
      return fail('failed', text.trim() === '' ? `HTTP ${response.status}` : `HTTP ${response.status}: ${text}`);
    }

    let json;
    try {
      json = JSON.parse(text);
    } catch {
      return fail('failed', 'the service response is not JSON');
    }
    const found = getPath(json, responsePath);
    if (typeof found !== 'string' || found === '') {
      return fail('failed', `the service response has no ${mode} at ${responsePath}`);
    }

    let bytes;
    if (mode === 'base64') {
      bytes = Buffer.from(found, 'base64');
    } else {
      const image = await fetchImpl(found, { method: 'GET', signal: controller.signal });
      if (!image.ok) return fail('failed', `HTTP ${image.status} while downloading the image`);
      bytes = Buffer.from(await image.arrayBuffer());
    }
    if (!startsWithPng(bytes)) return fail('failed', 'output is not a PNG');

    fs.writeFileSync(resultPath, bytes);
    writeRun(dir, id, job);
    return { ok: true };
  } catch (err) {
    if (err.name === 'AbortError') return fail('timeout', 'the service did not answer in time');
    return fail('failed', err.message);
  } finally {
    clearTimeout(timer);
  }
}
