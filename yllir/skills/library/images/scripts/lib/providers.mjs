// Image provider manifests and the deterministic choice of the provider.
// Manifests live in <pluginRoot>/modules/image-providers/<id>/provider.yaml.
// The choice is made here, never by the agent: the master's named provider is
// never replaced silently, and automatic choice follows the order of the list
// given to selectProvider (campaign providers first, then ORDER; see loadAllProviders).

import fs from 'node:fs';
import path from 'node:path';
import { parseYamlLite } from '../../../../../scripts/lib/yaml-lite.mjs';
import { loadCampaignProviders } from './campaign-providers.mjs';

export const OPERATIONS = ['generate', 'remove_background'];
export const ORDER = ['comfyui', 'codex', 'photoshop', 'upload'];

const KINDS = ['script', 'mcp', 'manual'];
const STATE_FILE = path.join('.campaign', 'state', 'image-providers.json');

/** Folder that holds one provider manifest per subfolder. */
export function providersDir(pluginRoot) {
  return path.join(pluginRoot, 'modules', 'image-providers');
}

function orderIndex(id) {
  const index = ORDER.indexOf(id);
  return index === -1 ? ORDER.length : index;
}

function isMapping(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validate(data, folderId, filename) {
  const fail = (message) => {
    throw new Error(`invalid image provider manifest ${filename}: ${message}`);
  };
  if (!isMapping(data)) fail('manifest must be a mapping');
  if (typeof data.id !== 'string' || data.id !== folderId) fail(`id must equal the folder name ${folderId}`);
  if (!KINDS.includes(data.kind)) fail(`kind must be one of ${KINDS.join(', ')}`);
  if (!Array.isArray(data.operations) || data.operations.some((op) => !OPERATIONS.includes(op))) {
    fail(`operations must be a list of ${OPERATIONS.join(', ')}`);
  }
  if (typeof data.external !== 'boolean') fail('external must be true or false');
  return { id: data.id, kind: data.kind, operations: [...data.operations], external: data.external };
}

/**
 * Reads and validates every provider manifest. Throws naming the file on an
 * invalid manifest. Result is sorted by ORDER; unknown ids come last, alphabetically.
 */
export function loadProviders(pluginRoot) {
  const dir = providersDir(pluginRoot);
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const providers = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const filename = path.join(dir, entry.name, 'provider.yaml');
    if (!fs.existsSync(filename)) continue;
    const parsed = parseYamlLite(fs.readFileSync(filename, 'utf8'));
    if (parsed.errors.length > 0) {
      const first = parsed.errors[0];
      throw new Error(`invalid image provider manifest ${filename}: line ${first.line}: ${first.message}`);
    }
    providers.push(validate(parsed.data, entry.name, filename));
  }
  return providers.sort((a, b) => orderIndex(a.id) - orderIndex(b.id) || a.id.localeCompare(b.id));
}

/**
 * Campaign providers first (newest first, as loadCampaignProviders gives them),
 * then the built-in ones in ORDER. Invalid campaign providers are only reported.
 * @returns {{ providers: object[], errors: Array<{id: string, errors: string[]}> }}
 */
export function loadAllProviders(pluginRoot, campaignRoot, env = process.env) {
  const campaign = loadCampaignProviders(campaignRoot, env);
  return { providers: [...campaign.providers, ...loadProviders(pluginRoot)], errors: campaign.errors };
}

function isAvailable(id, table) {
  if (id === 'upload') return true;
  return table.providers[id]?.available === true;
}

function supports(manifest, operation) {
  return manifest.operations.includes(operation);
}

/**
 * Chooses the provider for one operation.
 * @returns {{ provider: string|null, reason: string, needsConsent: boolean }}
 */
export function selectProvider({ providers, table, operation, requested = null, exclude = [] }) {
  const none = (reason) => ({ provider: null, reason, needsConsent: false });
  const result = (manifest, reason) => ({
    provider: manifest.id,
    reason,
    needsConsent: manifest.external && table.providers[manifest.id]?.consent !== true,
  });

  if (!OPERATIONS.includes(operation)) return none('unknown-operation');

  if (requested !== null && requested !== undefined) {
    const manifest = providers.find((p) => p.id === requested)
      ?? providers.find((p) => typeof p.name === 'string' && p.name.toLowerCase() === String(requested).toLowerCase());
    if (!manifest) return none('unknown-provider');
    if (!supports(manifest, operation)) return none('requested-unsupported');
    if (manifest.id === 'comfyui' && operation === 'remove_background' && table.providers.comfyui?.removeBackground !== true) {
      return none('requested-unsupported');
    }
    if (!isAvailable(manifest.id, table)) return none('requested-unavailable');
    return result(manifest, 'requested');
  }

  for (const manifest of providers) {
    if (exclude.includes(manifest.id)) continue;
    if (!supports(manifest, operation)) continue;
    if (!isAvailable(manifest.id, table)) continue;
    if (manifest.id === 'comfyui' && operation === 'remove_background' && table.providers.comfyui?.removeBackground !== true) continue;
    return result(manifest, 'automatic');
  }
  return none('none-available');
}

/** Reads the probe table; a missing or unreadable file gives an empty table. */
export function readTable(campaignRoot) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(campaignRoot, STATE_FILE), 'utf8'));
    if (isMapping(parsed) && isMapping(parsed.providers)) return parsed;
  } catch {
    // missing or unreadable: treated as empty below
  }
  return { providers: {} };
}

/** Writes the probe table as pretty JSON, creating the folders it needs. */
export function writeTable(campaignRoot, table) {
  const file = path.join(campaignRoot, STATE_FILE);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(table, null, 2)}\n`, 'utf8');
}

/** Records the master's consent for an external provider. */
export function recordConsent(campaignRoot, id) {
  const table = readTable(campaignRoot);
  table.providers[id] = { ...(table.providers[id] ?? {}), consent: true };
  writeTable(campaignRoot, table);
  return table;
}
