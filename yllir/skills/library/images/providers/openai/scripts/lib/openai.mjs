// Client of the OpenAI Images API (ChatGPT images): one generation call per job folder.
// The job prompt and the key reach the request; the key is never written to run.json,
// logs or messages. The key comes from the environment (OPENAI_API_KEY) or from the
// campaign's local, uncommitted .campaign/state/keys.json.

import fs from 'node:fs';
import path from 'node:path';
import { readKey } from '../../../../scripts/lib/campaign-providers.mjs';
import { PNG_SIGNATURE } from '../../../../scripts/lib/png-signature.mjs';
import { readTable, writeTable } from '../../../../scripts/lib/providers.mjs';

export const OPENAI_KEY_ENV = 'OPENAI_API_KEY';
export const DEFAULT_MODEL = 'gpt-image-1';
/** The image models the master can choose from. The only list of models in the framework. */
export const OPENAI_MODELS = [
  { id: 'gpt-image-1.5', label: 'GPT Image 1.5' },
  { id: 'gpt-image-1', label: 'GPT Image 1' },
  { id: 'gpt-image-1-mini', label: 'GPT Image 1 mini (cheaper, faster)' },
];

const PROVIDER_ID = 'openai';
const ENDPOINT = 'https://api.openai.com/v1/images/generations';
const KEYS_FILE = path.join('.campaign', 'state', 'keys.json');
const LEGACY_KEYS_ENTRY = 'generate2dmedia';
const TIMEOUT_MS = 300000;
const MESSAGE_LIMIT = 200;
const RESULT_FILE = 'result.png';
const RUN_FILE = 'run.json';

function oneLine(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

/** Hides every occurrence of the key, then makes the message one short line. */
function safeMessage(message, key) {
  let text = String(message ?? '');
  if (key) text = text.split(key).join('***');
  text = oneLine(text);
  return text.length > MESSAGE_LIMIT ? text.slice(0, MESSAGE_LIMIT) : text;
}

function failure(error, message, key = null) {
  return { ok: false, error, message: safeMessage(message, key) };
}

function readJsonFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * The OpenAI key of a campaign: OPENAI_API_KEY from the environment, else the `openai`
 * entry of .campaign/state/keys.json, else (compatibility) the OPENAI_API_KEY entry of
 * the generate2dmedia keys. Returns null when there is none. Never throws.
 */
export function readOpenaiKey(campaignRoot, env = process.env) {
  const key = readKey(campaignRoot, { id: PROVIDER_ID, key_env: OPENAI_KEY_ENV }, env);
  if (key !== null) return key;
  const data = readJsonFile(path.join(campaignRoot, KEYS_FILE));
  const legacy = data?.[LEGACY_KEYS_ENTRY]?.[OPENAI_KEY_ENV];
  return typeof legacy === 'string' && legacy !== '' ? legacy : null;
}

/** The model the master chose and the probe table stores, or null when none is stored. Never throws. */
export function readOpenaiModel(campaignRoot) {
  const model = readTable(campaignRoot).providers.openai?.model;
  return typeof model === 'string' && model !== '' ? model : null;
}

/**
 * Stores the master's model choice in the probe table, keeping every other field of
 * the openai entry. Throws Error('unknown model') when the id is not in OPENAI_MODELS.
 */
export function setOpenaiModel(campaignRoot, id) {
  if (!OPENAI_MODELS.some((entry) => entry.id === id)) throw new Error('unknown model');
  const table = readTable(campaignRoot);
  const current = table.providers.openai;
  const entry = current !== null && typeof current === 'object' && !Array.isArray(current) ? current : {};
  table.providers.openai = { ...entry, model: id };
  writeTable(campaignRoot, table);
  return table;
}

/** Checks the provider without any network call: available when a key exists. */
export function probeOpenai({ campaignRoot, env = process.env } = {}) {
  if (readOpenaiKey(campaignRoot, env) !== null) return { available: true, reason: null };
  return { available: false, reason: 'no-key' };
}

/**
 * The size the Images API accepts for a job: square within 10% of 1:1, otherwise
 * landscape or portrait by the aspect ratio. Invalid sizes fall back to square.
 */
export function pickSize(width, height) {
  const w = Number(width);
  const h = Number(height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return '1024x1024';
  // Multiplied out, so the 10% boundary is exact (no floating-point drift).
  if (Math.abs(w - h) * 10 <= h) return '1024x1024';
  return w > h ? '1536x1024' : '1024x1536';
}

/**
 * Generates one image for the job folder. Resolves to { ok: true } or
 * { ok: false, error, message } with error one of: unsupported, unavailable, failed, timeout.
 */
export async function runOpenai({
  campaignRoot,
  jobDir,
  env = process.env,
  fetchImpl = fetch,
  timeoutMs = TIMEOUT_MS,
  model = null,
}) {
  const dir = path.resolve(jobDir);
  let job;
  try {
    job = JSON.parse(fs.readFileSync(path.join(dir, 'job.json'), 'utf8'));
  } catch (err) {
    return failure('failed', `job.json is not readable: ${err.message}`);
  }
  if (job.operation !== 'generate') {
    return failure('unsupported', `operation ${job.operation} is not supported by openai`);
  }

  const key = readOpenaiKey(campaignRoot, env);
  if (key === null) return failure('unavailable', 'no-key: set OPENAI_API_KEY in the environment');

  // A retry reuses the job folder: outputs of an earlier attempt must never count as success.
  fs.rmSync(path.join(dir, RESULT_FILE), { force: true });
  fs.rmSync(path.join(dir, RUN_FILE), { force: true });

  const modelId = model ?? readOpenaiModel(campaignRoot) ?? DEFAULT_MODEL;
  const size = pickSize(job.width, job.height);
  const prompt = typeof job.negative === 'string' && job.negative.trim() !== ''
    ? `${job.prompt}\n\nAvoid: ${job.negative}`
    : job.prompt;
  const body = { model: modelId, prompt, size, n: 1, output_format: 'png' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response;
    try {
      response = await fetchImpl(ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      if (err.name === 'AbortError') return failure('timeout', 'the service did not answer in time', key);
      return failure('unavailable', `could not reach the service: ${err.message}`, key);
    }

    if (response.status === 401 || response.status === 403) {
      return failure('failed', 'the service refused the key', key);
    }
    const text = await response.text();
    if (!response.ok) {
      return failure('failed', text.trim() === '' ? `HTTP ${response.status}` : `HTTP ${response.status}: ${text}`, key);
    }

    let json;
    try {
      json = JSON.parse(text);
    } catch {
      return failure('failed', 'the service response is not JSON', key);
    }
    const b64 = json?.data?.[0]?.b64_json;
    if (typeof b64 !== 'string' || b64 === '') {
      return failure('failed', 'the service response has no image (data[0].b64_json is missing)', key);
    }

    const bytes = Buffer.from(b64, 'base64');
    if (!bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
      return failure('failed', 'output is not a PNG', key);
    }

    fs.writeFileSync(path.join(dir, RESULT_FILE), bytes);
    const run = { provider: PROVIDER_ID, parameters: { width: job.width, height: job.height, model: modelId, size } };
    fs.writeFileSync(path.join(dir, RUN_FILE), `${JSON.stringify(run, null, 2)}\n`);
    return { ok: true };
  } catch (err) {
    if (err.name === 'AbortError') return failure('timeout', 'the service did not answer in time', key);
    return failure('failed', err.message, key);
  } finally {
    clearTimeout(timer);
  }
}
