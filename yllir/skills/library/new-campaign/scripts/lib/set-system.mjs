// Sets the game-rules adapter of a campaign (system.adapter in campaign.yaml) and
// lists the installed adapters. Rewriting campaign.yaml drops its comments, so
// only the framework writes this file.

import fs from 'node:fs';
import path from 'node:path';
import { parseYamlLite } from '../../../../../scripts/lib/yaml-lite.mjs';
import { listAdapters, loadAdapter, pluginRootFromHere } from '../../../../../scripts/lib/adapter.mjs';
import { validateConfig } from '../../../../../scripts/lib/config.mjs';
import { generateInstructions } from '../../../../../scripts/lib/instructions.mjs';
import { stringifyConfig } from '../../../../../scripts/lib/config-write.mjs';

const FILE = 'campaign.yaml';

/**
 * Lists the adapters installed in the plugin.
 * @returns {Array<{id: string, name: string}>} sorted by id
 */
export function listInstalledAdapters(pluginRoot = pluginRootFromHere()) {
  return listAdapters(pluginRoot).map((id) => {
    const { adapter } = loadAdapter(pluginRoot, id);
    const name = adapter && typeof adapter.name === 'string' && adapter.name.trim() !== '' ? adapter.name : id;
    return { id, name };
  });
}

/**
 * Sets `system.adapter` in `<root>/campaign.yaml`, keeps every other key, validates
 * the result and regenerates the instructions. When the new config does not
 * validate, the previous bytes are restored. Nothing is written when the adapter
 * is already the one given.
 * @returns {{ changed: boolean, adapter: string, errors: Array<{code: string, path: string, message: string}> }}
 */
export function setSystemAdapter(root, adapter) {
  const dir = path.resolve(root);
  const file = path.join(dir, FILE);

  let previous;
  try {
    previous = fs.readFileSync(file);
  } catch (err) {
    return refuse(err.code === 'ENOENT' ? 'missing-file' : 'unreadable', adapter, FILE, 'campaign.yaml cannot be read');
  }

  const parsed = parseYamlLite(previous.toString('utf8'));
  if (parsed.errors.length > 0) {
    return {
      changed: false,
      adapter,
      errors: parsed.errors.map((error) => ({ code: 'yaml', path: FILE, message: `line ${error.line}: ${error.message}` })),
    };
  }
  const config = parsed.data;
  if (!isMapping(config) || !isMapping(config.system)) {
    return refuse('invalid-config', adapter, 'system', 'campaign.yaml must have a system mapping');
  }
  if (typeof adapter !== 'string') {
    return refuse('bad-input', adapter, 'adapter', 'the adapter must be text');
  }
  if (config.system.adapter === adapter) {
    return { changed: false, adapter, errors: [] };
  }

  let text;
  try {
    text = stringifyConfig({ ...config, system: { ...config.system, adapter } });
  } catch (err) {
    return refuse('unsupported-config', adapter, FILE, err.message);
  }

  try {
    fs.writeFileSync(file, text);
  } catch (err) {
    return refuse('unwritable', adapter, FILE, `campaign.yaml cannot be written (${err.code ?? 'error'})`);
  }

  const check = validateConfig(dir);
  if (!check.ok) {
    fs.writeFileSync(file, previous);
    return { changed: false, adapter, errors: check.errors };
  }

  const generated = generateInstructions(dir);
  return { changed: true, adapter, errors: generated.errors };
}

function refuse(code, adapter, at, message) {
  return { changed: false, adapter, errors: [{ code, path: at, message }] };
}

function isMapping(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
