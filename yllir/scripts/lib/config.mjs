// Validates campaign.yaml: required keys, enumerations, formats, the folders
// declared in structure, and the exclusions of the audit. Deterministic: the
// same file always gives the same result. Its output is the input of the
// agent, which turns each message into plain language for the master.

import fs from 'node:fs';
import path from 'node:path';
import { parseYamlLite } from './yaml-lite.mjs';
import { listAdapters, pluginRootFromHere } from './adapter.mjs';

const FILE = 'campaign.yaml';
// allow_model_imagination is no longer read: it is accepted with any value and ignored
// (the migration removes it from older campaigns).
const TOP_KEYS = ['schema', 'campaign', 'language', 'prose', 'system', 'structure', 'modules', 'audit', 'encyclopedia', 'print', 'workflow', 'allow_model_imagination'];
const ENCYCLOPEDIA_KEYS = ['title', 'base_url'];
const PRINT_KEYS = ['format', 'cmyk', 'renderer'];
const WORKFLOW_KEYS = ['auto_accept', 'auto_item_images'];
const PRINT_FORMATS = ['5x7', 'a4'];
const PRINT_RENDERERS = ['auto', 'photoshop', 'node'];
const ENCYCLOPEDIA_TITLE_MAX = 120;
const ENCYCLOPEDIA_URL_MAX = 200;
const REGISTERS = ['elevated', 'plain', 'colloquial', 'mixed'];
const STRUCTURE_TYPES = ['plot', 'chronicle', 'places', 'subjects', 'objects', 'free', 'notes', 'sources', 'master-only', 'external'];
const MODULE_KEYS = ['print', 'encyclopedia', 'master_screen', 'music'];
const INSTALLED_ADAPTERS = ['none', ...listAdapters(pluginRootFromHere())];
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const LANG_RE = /^[a-z]{2}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ATTRIBUTE_RE = /^[a-z]+\.[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * @typedef {{ code: string, path: string, message: string }} ConfigIssue
 * @typedef {{ ok: boolean, config: object|null, errors: ConfigIssue[], warnings: ConfigIssue[] }} ConfigResult
 */

/**
 * Validates `<campaignRoot>/campaign.yaml`.
 * @param {string} campaignRoot path to the campaign folder
 * @returns {ConfigResult}
 */
export function validateConfig(campaignRoot) {
  const report = createReport();

  let text;
  try {
    text = fs.readFileSync(path.join(campaignRoot, FILE), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      report.error('missing-file', FILE, 'campaign.yaml does not exist in this campaign folder');
    } else {
      report.error('unreadable', FILE, `campaign.yaml cannot be read (${err.code ?? 'unknown error'})`);
    }
    return report.result(null);
  }

  const parsed = parseYamlLite(text);
  if (parsed.errors.length > 0) {
    for (const parseError of parsed.errors) {
      report.error('yaml', FILE, `line ${parseError.line}: ${parseError.message}`);
    }
    return report.result(null);
  }

  validateTopLevel(report, parsed.data, campaignRoot);
  return report.result(parsed.data);
}

function createReport() {
  const issues = [];
  const add = (severity, code, at, message) => {
    issues.push({ severity, code, path: at, message });
  };
  return {
    error: (code, at, message) => add('error', code, at, message),
    warning: (code, at, message) => add('warning', code, at, message),
    result(config) {
      const errors = issues.filter((issue) => issue.severity === 'error').sort(byPathThenCode).map(toIssue);
      const warnings = issues.filter((issue) => issue.severity === 'warning').sort(byPathThenCode).map(toIssue);
      return { ok: errors.length === 0, config, errors, warnings };
    },
  };
}

function toIssue({ code, path: at, message }) {
  return { code, path: at, message };
}

function byPathThenCode(a, b) {
  if (a.path !== b.path) return a.path < b.path ? -1 : 1;
  if (a.code !== b.code) return a.code < b.code ? -1 : 1;
  return 0;
}

function joinPath(base, key) {
  return base === '' ? key : `${base}.${key}`;
}

function isMapping(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isRealDate(text) {
  const [year, month, day] = text.split('-').map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function isDirectory(target) {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Lists the image styles of a campaign: the sorted names of the folders in
 * `<campaignRoot>/.campaign/styles/` that contain a `prompt.md`.
 * A missing styles folder gives an empty list.
 * @param {string} campaignRoot path to the campaign folder
 * @returns {string[]}
 */
export function listCampaignStyles(campaignRoot) {
  const stylesDir = path.join(campaignRoot, '.campaign', 'styles');
  let entries;
  try {
    entries = fs.readdirSync(stylesDir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(stylesDir, entry.name, 'prompt.md')))
    .map((entry) => entry.name)
    .sort();
}

/** A folder is usable when it is non-empty, relative, free of `..` and has no backslash. */
function isSafeRelativeFolder(folder) {
  return (
    folder.trim() !== '' &&
    !folder.startsWith('/') &&
    !folder.includes('\\') &&
    !folder.split('/').includes('..')
  );
}

/** Reports keys of `obj` that the schema does not allow. */
function checkUnknownKeys(r, obj, base, allowed) {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) {
      r.error('unknown-key', joinPath(base, key), `"${key}" is not a setting of campaign.yaml`);
    }
  }
}

/**
 * Reads an optional or required mapping field. Returns the mapping, or null
 * when it is absent or not a mapping (the problem is reported).
 */
function mappingField(r, obj, base, key, { required = false, missingCode = 'missing-key' } = {}) {
  const at = joinPath(base, key);
  if (!Object.hasOwn(obj, key)) {
    if (required) r.error(missingCode, at, `${at} is required`);
    return null;
  }
  if (!isMapping(obj[key])) {
    r.error('bad-type', at, `${at} must be a mapping of settings`);
    return null;
  }
  return obj[key];
}

/**
 * Reads an optional or required list field. Returns the list, or null when it
 * is absent or not a list (the problem is reported).
 */
function listField(r, obj, base, key, { required = false, missingCode = 'missing-key' } = {}) {
  const at = joinPath(base, key);
  if (!Object.hasOwn(obj, key)) {
    if (required) r.error(missingCode, at, `${at} is required`);
    return null;
  }
  if (!Array.isArray(obj[key])) {
    r.error('bad-type', at, `${at} must be a list`);
    return null;
  }
  return obj[key];
}

/**
 * Checks a text field. Returns true when the field is present, is text and
 * passes the optional rules.
 */
function checkText(r, obj, base, key, opts = {}) {
  const {
    required = false,
    nonEmpty = false,
    pattern = null,
    hint = '',
    missingCode = 'missing-key',
    valueCode = 'bad-value',
  } = opts;
  const at = joinPath(base, key);
  if (!Object.hasOwn(obj, key)) {
    if (required) r.error(missingCode, at, `${at} is required`);
    return false;
  }
  const value = obj[key];
  if (typeof value !== 'string') {
    r.error('bad-type', at, `${at} must be text`);
    return false;
  }
  if (nonEmpty && value.trim() === '') {
    r.error(valueCode, at, `${at} must not be empty`);
    return false;
  }
  if (pattern !== null && !pattern.test(value)) {
    r.error(valueCode, at, `${at} must be ${hint}`);
    return false;
  }
  return true;
}

/** Checks a date field written as YYYY-MM-DD and existing in the calendar. */
function checkDate(r, obj, base, key, opts = {}) {
  const { required = false, missingCode = 'missing-key', valueCode = 'bad-value' } = opts;
  const at = joinPath(base, key);
  if (!Object.hasOwn(obj, key)) {
    if (required) r.error(missingCode, at, `${at} is required`);
    return false;
  }
  const value = obj[key];
  if (typeof value !== 'string') {
    r.error('bad-type', at, `${at} must be a date written as YYYY-MM-DD`);
    return false;
  }
  if (!DATE_RE.test(value) || !isRealDate(value)) {
    r.error(valueCode, at, `${at} must be a real date written as YYYY-MM-DD`);
    return false;
  }
  return true;
}

/** Checks an enumerated text field. Returns true when the value is allowed. */
function checkEnum(r, obj, base, key, allowed, { required = false } = {}) {
  const at = joinPath(base, key);
  if (!Object.hasOwn(obj, key)) {
    if (required) r.error('missing-key', at, `${at} is required`);
    return false;
  }
  const value = obj[key];
  if (typeof value !== 'string') {
    r.error('bad-type', at, `${at} must be text`);
    return false;
  }
  if (!allowed.includes(value)) {
    r.error('bad-value', at, `${at} must be one of: ${allowed.join(', ')}`);
    return false;
  }
  return true;
}

function validateTopLevel(r, config, campaignRoot) {
  checkUnknownKeys(r, config, '', TOP_KEYS);

  if (config.schema !== 1) {
    r.error('bad-schema', 'schema', 'schema must be the number 1');
  }

  const campaign = mappingField(r, config, '', 'campaign', { required: true });
  if (campaign !== null) validateCampaign(r, campaign);

  const language = mappingField(r, config, '', 'language', { required: true });
  if (language !== null) validateLanguage(r, language);

  const prose = mappingField(r, config, '', 'prose', { required: true });
  if (prose !== null) {
    checkUnknownKeys(r, prose, 'prose', ['register', 'session_format']);
    checkEnum(r, prose, 'prose', 'register', REGISTERS, { required: true });
    checkText(r, prose, 'prose', 'session_format');
  }

  const system = mappingField(r, config, '', 'system', { required: true });
  if (system !== null) validateSystem(r, system);

  if (!Object.hasOwn(config, 'structure')) {
    r.warning('no-structure', 'structure', 'the campaign declares no document categories yet; this is fine for a new campaign');
  } else {
    const structure = listField(r, config, '', 'structure');
    if (structure !== null) {
      if (structure.length === 0) {
        r.warning('no-structure', 'structure', 'the campaign declares no document categories yet; this is fine for a new campaign');
      }
      validateStructure(r, structure, campaignRoot);
    }
  }

  const modules = mappingField(r, config, '', 'modules');
  if (modules !== null) validateModules(r, modules);

  const audit = mappingField(r, config, '', 'audit');
  if (audit !== null) validateAudit(r, audit);

  const encyclopedia = mappingField(r, config, '', 'encyclopedia');
  if (encyclopedia !== null) validateEncyclopedia(r, encyclopedia);

  const print = mappingField(r, config, '', 'print');
  if (print !== null) validatePrint(r, print);

  const workflow = mappingField(r, config, '', 'workflow');
  if (workflow !== null) validateWorkflow(r, workflow);
}

/**
 * encyclopedia (optional): title of the public site and the base address its QR codes point to.
 * base_url is an http or https address with no query, no fragment and no credentials; the
 * validated value is stored with exactly one trailing slash.
 */
function validateEncyclopedia(r, encyclopedia) {
  checkUnknownKeys(r, encyclopedia, 'encyclopedia', ENCYCLOPEDIA_KEYS);
  if (checkText(r, encyclopedia, 'encyclopedia', 'title', { nonEmpty: true }) &&
    encyclopedia.title.length > ENCYCLOPEDIA_TITLE_MAX) {
    r.error('bad-value', 'encyclopedia.title', `encyclopedia.title must be at most ${ENCYCLOPEDIA_TITLE_MAX} characters`);
  }
  if (checkText(r, encyclopedia, 'encyclopedia', 'base_url', { nonEmpty: true })) {
    const value = encyclopedia.base_url;
    const at = 'encyclopedia.base_url';
    const problem = baseUrlProblem(value);
    if (problem !== null) {
      r.error('bad-value', at, `${at} ${problem}`);
    } else {
      encyclopedia.base_url = `${value.replace(/\/+$/, '')}/`;
    }
  }
}

/** Why a base address is not usable, or null when it is valid. */
function baseUrlProblem(value) {
  if (value.length > ENCYCLOPEDIA_URL_MAX) return `must be at most ${ENCYCLOPEDIA_URL_MAX} characters`;
  if (value.includes('?') || value.includes('#')) return 'must have no query and no fragment';
  let url;
  try {
    url = new URL(value);
  } catch {
    return 'must be a full http or https address, such as https://example.org/campaign/';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'must start with http:// or https://';
  if (url.username !== '' || url.password !== '') return 'must have no user name or password';
  return null;
}

/** print (optional): defaults of the printing module (format, cmyk, renderer). */
function validatePrint(r, print) {
  checkUnknownKeys(r, print, 'print', PRINT_KEYS);
  checkEnum(r, print, 'print', 'format', PRINT_FORMATS);
  if (Object.hasOwn(print, 'cmyk') && typeof print.cmyk !== 'boolean') {
    r.error('bad-type', 'print.cmyk', 'print.cmyk must be true or false');
  }
  checkEnum(r, print, 'print', 'renderer', PRINT_RENDERERS);
}

/**
 * workflow (optional): auto_accept true lets write-document write without asking the master to confirm the plan first;
 * auto_item_images false switches off the automatic illustration of every new item sheet (missing or true keeps it on).
 * Both must be booleans when present.
 */
function validateWorkflow(r, workflow) {
  checkUnknownKeys(r, workflow, 'workflow', WORKFLOW_KEYS);
  if (Object.hasOwn(workflow, 'auto_accept') && typeof workflow.auto_accept !== 'boolean') {
    r.error('bad-type', 'workflow.auto_accept', 'workflow.auto_accept must be true or false');
  }
  if (Object.hasOwn(workflow, 'auto_item_images') && typeof workflow.auto_item_images !== 'boolean') {
    r.error('bad-type', 'workflow.auto_item_images', 'workflow.auto_item_images must be true or false');
  }
}

function validateCampaign(r, campaign) {
  checkUnknownKeys(r, campaign, 'campaign', ['name', 'slug', 'world', 'description', 'created', 'seed']);
  checkText(r, campaign, 'campaign', 'name', { required: true, nonEmpty: true });
  checkText(r, campaign, 'campaign', 'slug', {
    required: true,
    pattern: SLUG_RE,
    hint: 'lowercase letters, digits and single hyphens, such as my-campaign',
  });
  checkText(r, campaign, 'campaign', 'world');
  checkText(r, campaign, 'campaign', 'description');
  checkDate(r, campaign, 'campaign', 'created', { required: true });
  checkSeed(r, campaign);
}

/**
 * campaign.seed is the file name of the world seed: a relative path to a .md
 * file inside the campaign, without `..`, backslashes or a leading slash. The
 * file may not exist yet (the first write creates it), so it is not checked here.
 */
function checkSeed(r, campaign) {
  if (!Object.hasOwn(campaign, 'seed')) return;
  const at = 'campaign.seed';
  const value = campaign.seed;
  if (typeof value !== 'string') {
    r.error('bad-type', at, `${at} must be the file name of the world seed`);
    return;
  }
  const safe =
    value.trim() !== '' &&
    value.endsWith('.md') &&
    !value.startsWith('/') &&
    !value.includes('\\') &&
    !value.split('/').includes('..');
  if (!safe) {
    r.error('bad-value', at, `${at} must be a relative path to a .md file inside the campaign, without ..`);
  }
}

function validateLanguage(r, language) {
  checkUnknownKeys(r, language, 'language', ['main', 'other']);
  checkText(r, language, 'language', 'main', {
    required: true,
    pattern: LANG_RE,
    hint: 'a two-letter lowercase language code, such as it',
  });
  const other = listField(r, language, 'language', 'other');
  if (other !== null) {
    other.forEach((code, index) => {
      const at = `language.other[${index}]`;
      if (typeof code !== 'string') {
        r.error('bad-type', at, `${at} must be text`);
      } else if (!LANG_RE.test(code)) {
        r.error('bad-value', at, `${at} must be a two-letter lowercase language code`);
      }
    });
  }
}

function validateSystem(r, system) {
  checkUnknownKeys(r, system, 'system', ['adapter', 'version', 'options']);
  const adapterValid = checkText(r, system, 'system', 'adapter', { required: true, nonEmpty: true });
  if (adapterValid && !INSTALLED_ADAPTERS.includes(system.adapter)) {
    r.error('unknown-adapter', 'system.adapter', `the game-rules adapter ${system.adapter} is not installed`);
  }
  if (Object.hasOwn(system, 'version')) {
    if (typeof system.version !== 'number') {
      r.error('bad-type', 'system.version', 'system.version must be a whole number');
    } else if (!Number.isInteger(system.version)) {
      r.error('bad-value', 'system.version', 'system.version must be a whole number');
    }
  }
  if (Object.hasOwn(system, 'options') && !isMapping(system.options)) {
    r.error('bad-type', 'system.options', 'system.options must be a mapping of settings');
  }
}

function validateStructure(r, structure, campaignRoot) {
  const idOwners = new Map();
  const folderOwners = new Map();

  structure.forEach((entry, index) => {
    const base = `structure[${index}]`;
    if (!isMapping(entry)) {
      r.error('bad-type', base, `${base} must be a mapping with id, folder and type`);
      return;
    }
    checkUnknownKeys(r, entry, base, ['id', 'folder', 'type', 'style', 'cards', 'exclude']);

    const idValid = checkText(r, entry, base, 'id', {
      required: true,
      pattern: SLUG_RE,
      hint: 'lowercase letters, digits and single hyphens, such as trama',
    });
    if (idValid) {
      if (idOwners.has(entry.id)) {
        r.error(
          'duplicate-category-id',
          `${base}.id`,
          `the category id ${entry.id} is already used by structure[${idOwners.get(entry.id)}]`,
        );
      } else {
        idOwners.set(entry.id, index);
      }
    }

    const folderAt = `${base}.folder`;
    let folderValid = false;
    if (!Object.hasOwn(entry, 'folder')) {
      r.error('missing-key', folderAt, `${folderAt} is required`);
    } else if (typeof entry.folder !== 'string') {
      r.error('bad-type', folderAt, `${folderAt} must be text`);
    } else if (!isSafeRelativeFolder(entry.folder)) {
      r.error(
        'bad-folder',
        folderAt,
        `${folderAt} must be a relative path inside the campaign folder, without .. and without backslashes`,
      );
    } else {
      folderValid = true;
    }
    if (folderValid) {
      if (folderOwners.has(entry.folder)) {
        r.error(
          'duplicate-folder',
          folderAt,
          `the folder ${entry.folder} is already declared by structure[${folderOwners.get(entry.folder)}]`,
        );
      } else {
        folderOwners.set(entry.folder, index);
      }
      if (!isDirectory(path.join(campaignRoot, entry.folder))) {
        r.error('missing-folder', folderAt, `the folder ${entry.folder} declared in the settings does not exist`);
      }
    }

    checkEnum(r, entry, base, 'type', STRUCTURE_TYPES, { required: true });

    if (Object.hasOwn(entry, 'style')) {
      if (typeof entry.style !== 'string') {
        r.error('bad-type', `${base}.style`, `${base}.style must be text`);
      } else if (!listCampaignStyles(campaignRoot).includes(entry.style)) {
        r.error(
          'unknown-style',
          `${base}.style`,
          `the style ${entry.style} is not among the campaign's styles in .campaign/styles/`,
        );
      }
    }

    if (Object.hasOwn(entry, 'cards')) {
      if (typeof entry.cards !== 'boolean') {
        r.error('bad-type', `${base}.cards`, `${base}.cards must be true or false`);
      } else if (entry.cards && entry.type !== 'objects') {
        r.error('cards-not-objects', `${base}.cards`, 'cards: true is only valid on a category of type objects');
      }
    }

    if (Object.hasOwn(entry, 'exclude')) {
      const exclude = listField(r, entry, base, 'exclude');
      if (exclude !== null) {
        exclude.forEach((item, itemIndex) => {
          const at = `${base}.exclude[${itemIndex}]`;
          if (typeof item !== 'string' || item.trim() === '') {
            r.error('bad-type', at, `${at} must be a non-empty path written as text`);
          } else if (!isSafeRelativeFolder(item)) {
            r.error(
              'bad-exclude',
              at,
              `${at} must be a relative path inside the category folder, without .. and without backslashes`,
            );
          }
        });
      }
      if (entry.type !== 'external') {
        r.error('exclude-not-external', `${base}.exclude`, 'exclude is only valid on a category of type external');
      }
    }
  });
}

function validateModules(r, modules) {
  for (const key of Object.keys(modules)) {
    const at = `modules.${key}`;
    if (!MODULE_KEYS.includes(key)) {
      r.error('unknown-module', at, `the module ${key} does not exist`);
    } else if (typeof modules[key] !== 'boolean') {
      r.error('bad-type', at, `${at} must be true or false`);
    }
  }
}

function validateAudit(r, audit) {
  checkUnknownKeys(r, audit, 'audit', ['exclusions']);
  const exclusions = listField(r, audit, 'audit', 'exclusions');
  if (exclusions !== null) {
    exclusions.forEach((item, index) => validateExclusion(r, item, `audit.exclusions[${index}]`));
  }
}

function validateExclusion(r, item, base) {
  if (!isMapping(item)) {
    r.error('bad-type', base, `${base} must be a mapping with subject, attribute, values, reason and date`);
    return;
  }
  checkUnknownKeys(r, item, base, ['subject', 'attribute', 'values', 'reason', 'date']);
  const exclusionRules = { missingCode: 'bad-exclusion', valueCode: 'bad-exclusion' };

  checkText(r, item, base, 'subject', {
    ...exclusionRules,
    required: true,
    pattern: SLUG_RE,
    hint: 'the id of a subject: lowercase letters, digits and single hyphens',
  });
  checkText(r, item, base, 'attribute', {
    ...exclusionRules,
    required: true,
    pattern: ATTRIBUTE_RE,
    hint: 'an attribute of the audit vocabulary, such as number.depth',
  });

  const valuesAt = `${base}.values`;
  if (!Object.hasOwn(item, 'values')) {
    r.error('bad-exclusion', valuesAt, `${valuesAt} is required`);
  } else if (!Array.isArray(item.values)) {
    r.error('bad-type', valuesAt, `${valuesAt} must be a list`);
  } else if (item.values.length === 0) {
    r.error('bad-exclusion', valuesAt, `${valuesAt} must contain at least one value`);
  } else {
    item.values.forEach((value, index) => {
      if (typeof value !== 'string' && typeof value !== 'number') {
        r.error('bad-type', `${valuesAt}[${index}]`, `${valuesAt}[${index}] must be text or a number`);
      }
    });
  }

  checkText(r, item, base, 'reason', { ...exclusionRules, required: true, nonEmpty: true });
  checkDate(r, item, base, 'date', { ...exclusionRules, required: true });
}
