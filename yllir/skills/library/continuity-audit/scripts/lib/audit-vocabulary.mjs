// Controlled vocabulary of the continuity audit: which attributes a fact may
// use and which shape each value must have. Pure checks, no campaign access.

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseYamlLite } from '../../../../../scripts/lib/yaml-lite.mjs';

const DEFAULT_PATH = fileURLToPath(new URL('../../audit-vocabulary.yaml', import.meta.url));

const ATTRIBUTE = /^[a-z]+\.[a-z0-9]+(-[a-z0-9]+)*$/;
const NUMBER = /^-?\d+(\.\d+)?$/;
const VALUE_KINDS = new Set(['date', 'number', 'ids', 'id', 'text']);

/**
 * Loads and checks the vocabulary file.
 * @param {string} [file] path to audit-vocabulary.yaml
 * @returns {{ families: object[], sourceTypes: string[] }}
 * @throws {Error} when the file cannot be read or does not have the expected shape
 */
export function loadVocabulary(file = DEFAULT_PATH) {
  const text = fs.readFileSync(file, 'utf8');
  const { data, errors } = parseYamlLite(text);
  if (errors.length > 0) {
    throw new Error(`${file}: line ${errors[0].line}: ${errors[0].message}`);
  }
  if (!data || !Array.isArray(data.families) || !Array.isArray(data.source_types)) {
    throw new Error(`${file}: families and source_types must be lists`);
  }
  for (const family of data.families) {
    const valid =
      family !== null &&
      typeof family === 'object' &&
      typeof family.family === 'string' &&
      typeof family.single === 'boolean' &&
      VALUE_KINDS.has(family.value) &&
      (family.names === 'any' ||
        (Array.isArray(family.names) && family.names.every((n) => typeof n === 'string')));
    if (!valid) {
      throw new Error(`${file}: invalid family definition ${JSON.stringify(family)}`);
    }
  }
  return { families: data.families, sourceTypes: data.source_types };
}

/**
 * @param {{ families: object[] }} vocab
 * @param {string} attribute "<family>.<name>"
 * @returns {{ ok: boolean, family: string|null, name: string|null, single: boolean|null, valueKind: string|null, reason?: string }}
 */
export function checkAttribute(vocab, attribute) {
  const none = { ok: false, family: null, name: null, single: null, valueKind: null };
  if (typeof attribute !== 'string' || !ATTRIBUTE.test(attribute)) {
    return { ...none, reason: 'attribute must be family.name in kebab-case' };
  }
  const dot = attribute.indexOf('.');
  const family = attribute.slice(0, dot);
  const name = attribute.slice(dot + 1);
  const definition = vocab.families.find((f) => f.family === family);
  if (!definition) {
    return { ...none, family, name, reason: `family not in vocabulary: ${family}` };
  }
  if (Array.isArray(definition.names) && !definition.names.includes(name)) {
    return { ...none, family, name, reason: `name not allowed for family ${family}` };
  }
  return { ok: true, family, name, single: definition.single, valueKind: definition.value };
}

/**
 * @param {string} valueKind one of date, number, ids, id, text
 * @param {string} value the value written in the fact
 * @param {Set<string>|string[]} subjectIds ids of the known subjects
 * @returns {{ ok: boolean, reason?: string }}
 */
export function checkValue(valueKind, value, subjectIds) {
  if (typeof value !== 'string') {
    return { ok: false, reason: 'value must be a string' };
  }
  switch (valueKind) {
    case 'date':
      return /\d/.test(value) ? { ok: true } : { ok: false, reason: 'date needs a digit' };
    case 'number':
      return NUMBER.test(value)
        ? { ok: true }
        : { ok: false, reason: 'number must be digits, optionally with a decimal point' };
    case 'id': {
      const ids = subjectIds instanceof Set ? subjectIds : new Set(subjectIds);
      const id = value.trim();
      return ids.has(id) ? { ok: true } : { ok: false, reason: `unknown subject id: ${id}` };
    }
    case 'ids': {
      const parts = value.split(',').map((part) => part.trim());
      return parts.every((part) => part !== '')
        ? { ok: true }
        : { ok: false, reason: 'every item of the list must be non-empty' };
    }
    case 'text':
      return value.trim() !== '' ? { ok: true } : { ok: false, reason: 'text must not be empty' };
    default:
      return { ok: false, reason: `unknown value kind: ${valueKind}` };
  }
}
