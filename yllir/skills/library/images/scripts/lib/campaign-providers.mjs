// Image providers added by the master for one campaign. They live in
// <campaignRoot>/.campaign/image-providers/<id>/ and are committed with the
// campaign, so they must never hold an API key. Keys are read only from the
// environment or from the local, uncommitted .campaign/state/keys.json.

import fs from 'node:fs';
import path from 'node:path';
import { parseYamlLite } from '../../../../../scripts/lib/yaml-lite.mjs';
import { OPERATIONS } from './providers.mjs';

export const BUILTIN_IDS = ['comfyui', 'codex', 'photoshop', 'upload'];
export const PLACEHOLDERS = ['PROMPT', 'NEGATIVE', 'OUTPUT', 'INPUT', 'INPUT_BASE64', 'WIDTH', 'HEIGHT', 'KEY'];

const KINDS = ['command', 'mcp', 'http'];
const ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const KEY_ENV_RE = /^[A-Z][A-Z0-9_]*$/;
const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/;
const DOT_PATH_RE = /^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*$/;
const PLACEHOLDER_RE = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;
const HTTP_METHODS = ['POST', 'GET'];
const DEFAULT_TIMEOUT_SECONDS = 600;
const MCP_PREFIX = 'mcp__';

const PROVIDER_FILE = 'provider.yaml';
const REQUEST_FILE = 'request.json';
const INSTRUCTIONS_FILE = 'instructions.md';
const KEYS_FILE = path.join('.campaign', 'state', 'keys.json');

// The generic rule only looks at a bare run of [A-Za-z0-9_-], so paths and
// URLs (which contain / . : + =) are not flagged. A run must mix letters and
// digits and must not be a plain lowercase slug (model names, folder names).
const GENERIC_RUN_RE = /(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{32,}(?![A-Za-z0-9_-])/g;
const SLUG_RE = /^[a-z0-9-]+$/;

function isGenericSecret(run) {
  return /[0-9]/.test(run) && /[A-Za-z]/.test(run) && !SLUG_RE.test(run);
}

const SECRET_PATTERNS = [
  { re: /AIza[0-9A-Za-z_-]{30,}/, what: 'looks like an API key' },
  { re: /sk-[A-Za-z0-9_-]{20,}/, what: 'looks like an API key' },
  { re: /(?:ghp|gho|xox[abp])_?[A-Za-z0-9-]{20,}/, what: 'looks like an access token' },
  { re: /Bearer\s+(?!\{KEY\})[A-Za-z0-9._-]{20,}/, what: 'looks like a bearer token' },
  {
    test: (line) => [...line.matchAll(GENERIC_RUN_RE)].some((match) => isGenericSecret(match[0])),
    what: 'looks like a long secret string',
  },
];

function isMapping(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function isStringList(value) {
  return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'string' && item.trim() !== '');
}

/** Every string found in a value, walking arrays and mappings. */
function collectStrings(value, out = []) {
  if (typeof value === 'string') {
    out.push(value);
  } else if (Array.isArray(value)) {
    value.forEach((item) => collectStrings(item, out));
  } else if (isMapping(value)) {
    Object.values(value).forEach((item) => collectStrings(item, out));
  }
  return out;
}

function placeholderNames(strings) {
  const names = new Set();
  for (const text of strings) {
    for (const match of text.matchAll(PLACEHOLDER_RE)) names.add(match[1]);
  }
  return names;
}

function checkPlaceholders(strings, errors) {
  for (const name of placeholderNames(strings)) {
    if (!PLACEHOLDERS.includes(name)) errors.push(`unknown placeholder {${name}}`);
  }
}

/** Campaign providers folder: <root>/.campaign/image-providers. */
export function campaignProvidersDir(root) {
  return path.join(root, '.campaign', 'image-providers');
}

/**
 * Describes secret-looking text, line by line. Never returns the secret itself.
 * @returns {string[]} for example `line 4: looks like an API key`
 */
export function findSecrets(text) {
  const found = [];
  if (typeof text !== 'string') return found;
  text.split(/\r?\n/).forEach((line, index) => {
    for (const { re, test, what } of SECRET_PATTERNS) {
      const hit = test ? test(line) : re.test(line);
      if (hit) found.push(`line ${index + 1}: ${what}`);
    }
  });
  return [...new Set(found)];
}

/**
 * Returns the API key of a provider, or null. The environment variable named by
 * manifest.key_env wins; otherwise the entry for manifest.id in
 * <root>/.campaign/state/keys.json. Never logs the key.
 */
export function readKey(root, manifest, env = process.env) {
  const fromEnv = manifest?.key_env ? env[manifest.key_env] : undefined;
  if (typeof fromEnv === 'string' && fromEnv !== '') return fromEnv;
  const text = readText(path.join(root, KEYS_FILE));
  if (text === null) return null;
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isMapping(parsed) || !Object.hasOwn(parsed, manifest?.id)) return null;
  const value = parsed[manifest.id];
  return typeof value === 'string' && value !== '' ? value : null;
}

/**
 * Checks one campaign provider. Errors are short English sentences that never
 * contain a secret value.
 * @returns {{ ok: boolean, manifest: object|null, errors: string[] }}
 */
export function validateCampaignProvider(root, id, env = process.env) {
  const errors = [];
  const fail = () => ({ ok: false, manifest: null, errors: [...new Set(errors)] });

  if (typeof id !== 'string' || !ID_RE.test(id)) {
    errors.push('the folder name must be a lowercase id with letters, digits and single dashes');
    return fail();
  }
  if (BUILTIN_IDS.includes(id)) {
    errors.push(`${id} is the id of a built-in provider and cannot be used`);
    return fail();
  }

  const dir = path.join(campaignProvidersDir(root), id);
  const texts = {
    [PROVIDER_FILE]: readText(path.join(dir, PROVIDER_FILE)),
    [REQUEST_FILE]: readText(path.join(dir, REQUEST_FILE)),
    [INSTRUCTIONS_FILE]: readText(path.join(dir, INSTRUCTIONS_FILE)),
  };
  if (texts[PROVIDER_FILE] === null) {
    errors.push(`${PROVIDER_FILE} is missing`);
    return fail();
  }

  const parsed = parseYamlLite(texts[PROVIDER_FILE]);
  const data = parsed.data;

  // Secrets are checked on the raw text, before any structural check.
  for (const [file, text] of Object.entries(texts)) {
    if (text === null) continue;
    for (const finding of findSecrets(text)) errors.push(`${file} ${finding}`);
  }
  const keyEnv = isMapping(data) && typeof data.key_env === 'string' ? data.key_env : undefined;
  const key = readKey(root, { id, key_env: keyEnv }, env);
  if (key !== null) {
    for (const [file, text] of Object.entries(texts)) {
      if (text !== null && text.includes(key)) {
        errors.push(`${file} contains the stored API key; keys stay in the environment or .campaign/state/keys.json, never in campaign files`);
      }
    }
  }

  if (parsed.errors.length > 0) {
    const first = parsed.errors[0];
    errors.push(`${PROVIDER_FILE} line ${first.line}: ${first.message}`);
    return fail();
  }
  if (!isMapping(data)) {
    errors.push(`${PROVIDER_FILE} must be a mapping of fields`);
    return fail();
  }

  if (data.id !== id) errors.push(`id must equal the folder name ${id}`);
  if (typeof data.name !== 'string' || data.name.trim() === '') {
    errors.push('name must be a non-empty text, the name the master uses for the service');
  }
  if (!KINDS.includes(data.kind)) errors.push('kind must be command, mcp or http');
  if (!Array.isArray(data.operations) || data.operations.length === 0 || data.operations.some((op) => !OPERATIONS.includes(op))) {
    errors.push(`operations must be a non-empty list of: ${OPERATIONS.join(', ')}`);
  }
  if (data.external !== true) errors.push('external must be true: a campaign provider is always an outside service');
  if (typeof data.added !== 'string' || !ISO_DATETIME_RE.test(data.added) || Number.isNaN(Date.parse(data.added))) {
    errors.push('added must be an ISO date-time, such as 2026-11-11T10:00:00Z');
  }
  let timeout = DEFAULT_TIMEOUT_SECONDS;
  if (data.timeout_seconds !== undefined) {
    if (Number.isInteger(data.timeout_seconds) && data.timeout_seconds > 0) timeout = data.timeout_seconds;
    else errors.push('timeout_seconds must be a whole number above zero');
  }
  if (data.key_env !== undefined && data.kind !== 'http') {
    errors.push('key_env is only allowed for http providers');
  }

  let request = null;
  if (data.kind === 'command') {
    const commandOk = isStringList(data.command);
    if (!commandOk) errors.push('command must be a non-empty list of strings: the program and its arguments, run without a shell');
    if (!isStringList(data.probe)) errors.push('probe must be a non-empty list of strings: the command that checks the program is installed');
    if (commandOk && !data.command.some((arg) => arg.includes('{OUTPUT}'))) {
      errors.push('command must have at least one argument with {OUTPUT}');
    }
    const strings = collectStrings([data.command, data.probe]);
    if (strings.some((text) => text.includes('{KEY}'))) {
      errors.push('command and probe must not use {KEY}: keys are passed only to http providers');
    }
    checkPlaceholders(strings, errors);
  } else if (data.kind === 'mcp') {
    if (typeof data.tool !== 'string' || !data.tool.startsWith(MCP_PREFIX) || data.tool.length <= MCP_PREFIX.length) {
      errors.push('tool must be the name of an MCP tool, starting with mcp__');
    }
    const instructions = texts[INSTRUCTIONS_FILE];
    if (instructions === null || instructions.trim() === '') {
      errors.push('instructions.md is required beside provider.yaml and must not be empty');
    }
  } else if (data.kind === 'http') {
    if (data.key_env !== undefined && (typeof data.key_env !== 'string' || !KEY_ENV_RE.test(data.key_env))) {
      errors.push('key_env must be an environment variable name in capitals, such as GEMINI_API_KEY');
    }
    if (texts[REQUEST_FILE] === null) {
      errors.push('request.json is required beside provider.yaml for http providers');
    } else {
      let parsedRequest;
      try {
        parsedRequest = JSON.parse(texts[REQUEST_FILE]);
      } catch {
        errors.push('request.json is not valid JSON');
      }
      if (parsedRequest !== undefined) {
        if (!isMapping(parsedRequest)) {
          errors.push('request.json must be a JSON object');
        } else {
          request = parsedRequest;
          checkRequest(request, data.key_env, errors);
        }
      }
    }
  }

  if (errors.length > 0) return fail();

  const manifest = {
    id,
    name: data.name,
    kind: data.kind,
    operations: [...data.operations],
    external: true,
    added: data.added,
    timeout_seconds: timeout,
  };
  if (data.kind === 'command') {
    manifest.command = [...data.command];
    manifest.probe = [...data.probe];
  } else if (data.kind === 'mcp') {
    manifest.tool = data.tool;
  } else {
    manifest.key_env = data.key_env ?? null;
    manifest.request = request;
  }
  return { ok: true, manifest, errors: [] };
}

/** Checks the parsed contents of an http provider's request.json. */
function checkRequest(request, keyEnv, errors) {
  if (!HTTP_METHODS.includes(request.method)) errors.push('request.json method must be POST or GET');
  if (typeof request.url !== 'string' || request.url.trim() === '') {
    errors.push('request.json url must be a non-empty text');
  }
  if (request.headers !== undefined
    && (!isMapping(request.headers) || Object.values(request.headers).some((value) => typeof value !== 'string'))) {
    errors.push('request.json headers must map header names to text values');
  }

  const response = request.response;
  const responseKeys = isMapping(response) ? Object.keys(response) : [];
  const responseValid = responseKeys.length === 1
    && ['base64', 'url'].includes(responseKeys[0])
    && typeof response[responseKeys[0]] === 'string'
    && DOT_PATH_RE.test(response[responseKeys[0]]);
  if (!responseValid) {
    errors.push('request.json response must be { "base64": "<dot path>" } or { "url": "<dot path>" }');
  }

  const everything = collectStrings([request.url, request.headers, request.body]);
  checkPlaceholders(everything, errors);

  const promptSources = collectStrings([request.url, request.body]);
  if (!promptSources.some((text) => text.includes('{PROMPT}'))) {
    errors.push('request.json must put {PROMPT} in the url or the body');
  }

  const keySources = collectStrings([request.url, request.headers]);
  const usesKey = everything.some((text) => text.includes('{KEY}'));
  if (keyEnv !== undefined) {
    if (!keySources.some((text) => text.includes('{KEY}'))) {
      errors.push('key_env is set, so {KEY} must appear in the url or a header');
    }
  } else if (usesKey) {
    errors.push('request.json uses {KEY} but key_env is not set');
  }
}

/**
 * Reads every provider folder of a campaign. Valid ones go to `providers`,
 * newest `added` first (ties by id); invalid ones go to `errors` with their
 * messages. A missing folder gives empty lists.
 * @returns {{ providers: object[], errors: Array<{id: string, errors: string[]}> }}
 */
export function loadCampaignProviders(root, env = process.env) {
  let entries;
  try {
    entries = fs.readdirSync(campaignProvidersDir(root), { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return { providers: [], errors: [] };
    throw error;
  }
  const providers = [];
  const errors = [];
  const folders = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  for (const id of folders) {
    const result = validateCampaignProvider(root, id, env);
    if (result.ok) providers.push(result.manifest);
    else errors.push({ id, errors: result.errors });
  }
  providers.sort((a, b) => Date.parse(b.added) - Date.parse(a.added) || a.id.localeCompare(b.id));
  return { providers, errors };
}

/**
 * Replaces each {NAME} that is a key of `values`, in one pass, so a value is
 * never substituted again. Unknown placeholders stay as they are.
 */
export function fillPlaceholders(text, values) {
  return text.replace(PLACEHOLDER_RE, (match, name) => (Object.hasOwn(values, name) ? String(values[name]) : match));
}
