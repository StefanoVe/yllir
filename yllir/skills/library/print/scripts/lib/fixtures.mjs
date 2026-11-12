// Test helpers: a real campaign made with the framework's own tools (init-campaign, add-category),
// a cards category, and object sheets committed in git. Used by the tests of the print skill only.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { FRAMEWORK_ROOT } from './paths.mjs';

const GIT_ARGS = ['-c', 'user.email=test@example.invalid', '-c', 'user.name=test'];

/**
 * An object sheet with the public part and a master block, in the comment metadata form.
 * @param {object} sheet
 */
export function objectSheet({ id, title, template = 'item', location = 'porto-di-selce', print, personal, shortText, longText, extraMeta = [], master = 'Segreto del master.' }) {
  const meta = [`id: ${id}`, `template: ${template}`];
  if (location) meta.push(`location: [${location}]`);
  if (print) meta.push(`print: ${print}`);
  if (personal) meta.push('personal: true');
  meta.push(...extraMeta);
  const parts = [`<!-- yllir\n${meta.join('\n')}\n-->`, '', `# ${title}`, ''];
  if (shortText !== undefined) parts.push('## In breve', '', shortText, '');
  if (longText !== undefined) parts.push('## Descrizione', '', longText, '');
  parts.push('## Effetti', '', 'Nessun effetto di gioco.', '', '<!-- master -->', '## Master', '### Indicazioni per il master', '', master, '<!-- /master -->', '');
  return parts.join('\n');
}

/**
 * Creates a campaign with one objects category `Oggetti` (cards: true unless `cards` is false),
 * writes the given sheets, and commits everything in git.
 * @param {{ sheets?: Record<string, string>, cards?: boolean, folder?: string, extraFiles?: Record<string, string>, categories?: Array<{id: string, folder: string, type: string}> }} options
 * @returns {string} absolute campaign folder
 */
export function makeCampaign({ sheets = {}, cards = true, folder = 'Oggetti', extraFiles = {}, categories = [] } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-print-'));
  execFileSync(process.execPath, [
    path.join(FRAMEWORK_ROOT, 'skills/library/new-campaign/scripts/init-campaign.mjs'),
    root, '--name', 'T', '--language', 'en', '--register', 'plain', '--world', 'W', '--seed', 'World seed.md',
  ], { stdio: 'ignore' });
  execFileSync(process.execPath, [
    path.join(FRAMEWORK_ROOT, 'scripts/add-category.mjs'), root, '--id', 'objects', '--folder', folder, '--type', 'objects',
  ], { stdio: 'ignore' });
  for (const category of categories) {
    execFileSync(process.execPath, [
      path.join(FRAMEWORK_ROOT, 'scripts/add-category.mjs'), root, '--id', category.id, '--folder', category.folder, '--type', category.type,
    ], { stdio: 'ignore' });
  }
  if (cards) {
    const yamlPath = path.join(root, 'campaign.yaml');
    const yaml = fs.readFileSync(yamlPath, 'utf8');
    fs.writeFileSync(yamlPath, yaml.replace(/(\n {4}type: objects)/, '$1\n    cards: true'));
  }
  const write = (rel, text) => {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, text);
  };
  for (const [rel, text] of Object.entries({ ...sheets, ...extraFiles })) write(rel, text);
  execFileSync('git', ['add', '-A'], { cwd: root });
  execFileSync('git', [...GIT_ARGS, 'commit', '-qm', 'fixtures'], { cwd: root });
  return root;
}

/** Name of a file in the campaign that the test can read back. */
export function readText(root, rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

/** Removes a campaign made by makeCampaign. */
export function removeCampaign(root) {
  fs.rmSync(root, { recursive: true, force: true });
}

/** A 40 x 60 pixel JPEG (an illustration for the vector card), base64. */
export const TINY_JPEG_BASE64 = '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';
