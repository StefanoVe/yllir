// ComfyUI client for the image skill: probes a local server, fills the workflow
// templates and runs one job (generate or remove background) into its job folder.
// Only built-in modules. Every network call takes an injectable fetchImpl.

import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_URL = 'http://127.0.0.1:8188';
export const REMOVE_BACKGROUND_NODE = 'InspyrenetRembg';

const TEMPLATE_BY_OPERATION = { generate: 'generate.json', remove_background: 'remove-background.json' };
const WORKFLOW_BY_OPERATION = { generate: 'generate', remove_background: 'remove-background' };
const PLACEHOLDER = /^\{\{([A-Z][A-Z0-9_]*)\}\}$/;

/** Failure that carries a result code (unavailable, timeout or failed). */
class Stop extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'Stop';
    this.code = code;
  }
}

/**
 * Deep-copies a workflow and replaces every string that is exactly `{{NAME}}` with
 * values.NAME, keeping the type of the value. Placeholders inside longer strings are
 * left alone. Throws when a placeholder has no value.
 */
export function fillTemplate(template, values) {
  const fill = (node) => {
    if (Array.isArray(node)) return node.map(fill);
    if (node !== null && typeof node === 'object') {
      const out = {};
      for (const [key, value] of Object.entries(node)) out[key] = fill(value);
      return out;
    }
    if (typeof node === 'string') {
      const match = PLACEHOLDER.exec(node);
      if (match) {
        const name = match[1];
        if (values[name] === undefined) throw new Error(`no value for placeholder {{${name}}}`);
        return values[name];
      }
    }
    return node;
  };
  return fill(template);
}

/** GET with a timeout. Rejects on network error or timeout. */
async function getWithTimeout(fetchImpl, url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { method: 'GET', signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Checks whether a ComfyUI server answers and what it can do: its checkpoints and
 * whether the background removal node is installed.
 */
export async function probeComfyui({ url = DEFAULT_URL, fetchImpl = globalThis.fetch, timeoutMs = 3000 } = {}) {
  const unreachable = { available: false, url, checkpoints: [], checkpoint: null, removeBackground: false, reason: 'unreachable' };

  try {
    const stats = await getWithTimeout(fetchImpl, `${url}/system_stats`, timeoutMs);
    if (stats.status !== 200) return unreachable;
  } catch {
    return unreachable;
  }

  let checkpoints = [];
  try {
    const info = await getWithTimeout(fetchImpl, `${url}/object_info/CheckpointLoaderSimple`, timeoutMs);
    if (info.status === 200) {
      const json = await readJson(info);
      const list = json?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0];
      if (Array.isArray(list)) checkpoints = list.filter((name) => typeof name === 'string');
    }
  } catch {
    return unreachable;
  }

  if (checkpoints.length === 0) {
    return { available: false, url, checkpoints, checkpoint: null, removeBackground: false, reason: 'no-checkpoint' };
  }

  let removeBackground = false;
  try {
    const info = await getWithTimeout(fetchImpl, `${url}/object_info/${REMOVE_BACKGROUND_NODE}`, timeoutMs);
    if (info.status === 200) {
      const json = await readJson(info);
      removeBackground = json !== null && Object.prototype.hasOwnProperty.call(json, REMOVE_BACKGROUND_NODE);
    }
  } catch {
    removeBackground = false;
  }

  return { available: true, url, checkpoints, checkpoint: checkpoints[0], removeBackground, reason: null };
}

/** One request that respects the overall deadline; converts failures to Stop. */
async function send(fetchImpl, url, init, deadline) {
  const remaining = Math.max(1, deadline - Date.now());
  try {
    return await fetchImpl(url, { ...init, signal: AbortSignal.timeout(remaining) });
  } catch (err) {
    if (Date.now() >= deadline) throw new Stop('timeout', `ComfyUI did not answer in time: ${url}`);
    throw new Stop('unavailable', `ComfyUI is unreachable at ${url}: ${err?.message ?? err}`);
  }
}

async function bodyText(response) {
  try {
    return (await response.text()).slice(0, 500);
  } catch {
    return '';
  }
}

function firstImage(outputs) {
  for (const output of Object.values(outputs ?? {})) {
    const image = output?.images?.[0];
    if (image) return image;
  }
  return null;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs the job in jobDir on ComfyUI. On success writes result.png and run.json into
 * jobDir and returns { ok: true }. Otherwise returns { ok: false, error, message }
 * where error is 'unavailable', 'timeout' or 'failed'.
 */
export async function runComfyui({
  jobDir,
  url = DEFAULT_URL,
  checkpoint,
  templatesDir,
  fetchImpl = globalThis.fetch,
  timeoutMs = 600000,
  pollMs = 1000,
}) {
  const deadline = Date.now() + timeoutMs;
  try {
    const job = JSON.parse(fs.readFileSync(path.join(jobDir, 'job.json'), 'utf8'));
    const templateName = TEMPLATE_BY_OPERATION[job.operation];
    if (!templateName) throw new Stop('failed', `unknown operation: ${job.operation}`);
    const template = JSON.parse(fs.readFileSync(path.join(templatesDir, templateName), 'utf8'));

    const values = {
      PROMPT: job.prompt,
      NEGATIVE: job.negative ?? '',
      CHECKPOINT: checkpoint,
      WIDTH: job.width,
      HEIGHT: job.height,
      SEED: job.seed,
    };

    if (job.operation === 'remove_background') {
      if (typeof job.input !== 'string' || !fs.existsSync(job.input)) {
        throw new Stop('failed', `input image not found: ${job.input}`);
      }
      const form = new FormData();
      form.append('image', new Blob([fs.readFileSync(job.input)]), path.basename(job.input));
      form.append('overwrite', 'true');
      const upload = await send(fetchImpl, `${url}/upload/image`, { method: 'POST', body: form }, deadline);
      if (upload.status !== 200) {
        throw new Stop('failed', `upload refused (${upload.status}): ${await bodyText(upload)}`);
      }
      const uploaded = await readJson(upload);
      if (typeof uploaded?.name !== 'string') throw new Stop('failed', 'upload answer has no file name');
      values.INPUT_IMAGE = uploaded.subfolder ? `${uploaded.subfolder}/${uploaded.name}` : uploaded.name;
    }

    const workflow = fillTemplate(template, values);
    const queued = await send(
      fetchImpl,
      `${url}/prompt`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: workflow, client_id: 'yllir' }),
      },
      deadline,
    );
    if (queued.status !== 200) {
      throw new Stop('failed', `ComfyUI refused the workflow (${queued.status}): ${await bodyText(queued)}`);
    }
    const promptId = (await readJson(queued))?.prompt_id;
    if (typeof promptId !== 'string') throw new Stop('failed', 'ComfyUI answer has no prompt_id');

    let image = null;
    for (;;) {
      const history = await send(fetchImpl, `${url}/history/${promptId}`, { method: 'GET' }, deadline);
      if (history.status === 200) {
        const json = (await readJson(history)) ?? {};
        const entry = Object.prototype.hasOwnProperty.call(json, promptId) ? json[promptId] : null;
        if (entry) {
          if (entry.status?.status_str === 'error') {
            throw new Stop('failed', `ComfyUI reported an error for prompt ${promptId}`);
          }
          image = firstImage(entry.outputs);
          if (image) break;
          if (entry.status?.completed === true) throw new Stop('failed', 'ComfyUI finished without an image output');
        }
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Stop('timeout', `no result before the timeout (prompt ${promptId})`);
      await sleep(Math.min(pollMs, remaining));
    }

    const query = new URLSearchParams({
      filename: image.filename,
      subfolder: image.subfolder ?? '',
      type: image.type ?? 'output',
    });
    const view = await send(fetchImpl, `${url}/view?${query}`, { method: 'GET' }, deadline);
    if (view.status !== 200) throw new Stop('failed', `could not download the image (${view.status})`);
    fs.writeFileSync(path.join(jobDir, 'result.png'), Buffer.from(await view.arrayBuffer()));

    const run = {
      provider: 'comfyui',
      parameters: {
        checkpoint,
        width: job.width,
        height: job.height,
        seed: job.seed,
        workflow: WORKFLOW_BY_OPERATION[job.operation],
      },
    };
    fs.writeFileSync(path.join(jobDir, 'run.json'), `${JSON.stringify(run, null, 2)}\n`);
    return { ok: true };
  } catch (err) {
    if (err instanceof Stop) return { ok: false, error: err.code, message: err.message };
    return { ok: false, error: 'failed', message: err?.message ?? String(err) };
  }
}
