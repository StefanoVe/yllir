// Sets allow_model_imagination in a campaign (campaign.yaml, top-level key) to
// true, false or null (null is the default). Rewriting campaign.yaml drops its
// comments, so only the framework writes this file.

import fs from 'node:fs';
import path from 'node:path';
import { parseYamlLite } from '../../../../../scripts/lib/yaml-lite.mjs';
import { validateConfig } from '../../../../../scripts/lib/config.mjs';
import { generateInstructions } from '../../../../../scripts/lib/instructions.mjs';
import { stringifyConfig } from '../../../../core/new-campaign/scripts/lib/config-write.mjs';

const FILE = 'campaign.yaml';
const KEY = 'allow_model_imagination';
const VALUES = [true, false, null];

/**
 * Sets `allow_model_imagination` in `<root>/campaign.yaml`, keeps every other key,
 * validates the result and regenerates the instructions. When the new config does
 * not validate, the previous bytes are restored. Nothing is written when the value
 * is already the one given (an absent key counts as null).
 * @param {string} root campaign folder
 * @param {boolean|null} value true, false or null
 * @returns {{ changed: boolean, value: boolean|null, errors: Array<{code: string, path: string, message: string}> }}
 */
export function setModelImagination(root, value) {
  if (!VALUES.includes(value)) {
    return refuse('bad-input', value, KEY, 'the value must be true, false or null');
  }

  const dir = path.resolve(root);
  const file = path.join(dir, FILE);

  let previous;
  try {
    previous = fs.readFileSync(file);
  } catch (err) {
    return refuse(err.code === 'ENOENT' ? 'missing-file' : 'unreadable', value, FILE, 'campaign.yaml cannot be read');
  }

  const parsed = parseYamlLite(previous.toString('utf8'));
  if (parsed.errors.length > 0) {
    return {
      changed: false,
      value,
      errors: parsed.errors.map((error) => ({ code: 'yaml', path: FILE, message: `line ${error.line}: ${error.message}` })),
    };
  }
  const config = parsed.data;
  if (!isMapping(config)) {
    return refuse('invalid-config', value, FILE, 'campaign.yaml must be a mapping');
  }

  const current = Object.hasOwn(config, KEY) ? config[KEY] : null;
  if (current === value) {
    return { changed: false, value, errors: [] };
  }

  let text;
  try {
    text = stringifyConfig({ ...config, [KEY]: value });
  } catch (err) {
    return refuse('unsupported-config', value, FILE, err.message);
  }

  try {
    fs.writeFileSync(file, text);
  } catch (err) {
    return refuse('unwritable', value, FILE, `campaign.yaml cannot be written (${err.code ?? 'error'})`);
  }

  const check = validateConfig(dir);
  if (!check.ok) {
    fs.writeFileSync(file, previous);
    return { changed: false, value, errors: check.errors };
  }

  const generated = generateInstructions(dir);
  return { changed: true, value, errors: generated.errors };
}

function refuse(code, value, at, message) {
  return { changed: false, value, errors: [{ code, path: at, message }] };
}

function isMapping(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
