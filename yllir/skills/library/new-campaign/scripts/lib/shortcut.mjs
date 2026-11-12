// The master screen shortcut of a campaign folder: writes it through the launcher and
// makes sure git ignores it, so it is never saved as campaign content. Used by
// init-campaign (new campaigns) and by the shortcut-v1 migration (existing ones).

import fs from 'node:fs';
import path from 'node:path';
import { writeShortcut } from '../../../../../scripts/launcher/write-shortcut.mjs';
import { pluginRootFromHere } from '../../../../../scripts/lib/adapter.mjs';

// Same names and extensions as the launcher uses (write-shortcut.mjs).
const OPEN_NAMES = { it: 'Apri master screen', en: 'Open master screen' };
const MAIN_EXTENSIONS = { darwin: '.command', linux: '.sh', win32: '.cmd' };

/** The git ignore rules that cover every file of the shortcut, on every platform. */
export const SHORTCUT_IGNORE_RULES = [`${OPEN_NAMES.en}.*`, `${OPEN_NAMES.it}.*`];

/** The language the launcher uses for a campaign language code. */
export function shortcutLanguage(language) {
  return language === 'it' ? 'it' : 'en';
}

/** True on the platforms that get a shortcut. */
export function shortcutSupported(platform = process.platform) {
  return platform in MAIN_EXTENSIONS;
}

/** The main shortcut file name for a language and platform, or null without a shortcut. */
export function shortcutFileName(language, platform = process.platform) {
  if (!shortcutSupported(platform)) return null;
  return `${OPEN_NAMES[shortcutLanguage(language)]}${MAIN_EXTENSIONS[platform]}`;
}

/** The framework root: the folder that holds scripts/ (the plugin root). */
export function frameworkRoot() {
  return pluginRootFromHere();
}

/** The shortcut ignore rules that the campaign .gitignore lacks. */
export function missingShortcutIgnoreRules(root) {
  const file = path.join(root, '.gitignore');
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const present = new Set(text.split(/\r?\n/).map((line) => line.trim()));
  return SHORTCUT_IGNORE_RULES.filter((rule) => !present.has(rule));
}

/**
 * Appends the missing shortcut ignore rules to the campaign .gitignore.
 * Returns true when the file changed.
 */
export function ensureShortcutIgnoreRules(root) {
  const missing = missingShortcutIgnoreRules(root);
  if (missing.length === 0) return false;
  const file = path.join(root, '.gitignore');
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const separator = text === '' || text.endsWith('\n') ? '' : '\n';
  fs.writeFileSync(file, `${text}${separator}${missing.join('\n')}\n`);
  return true;
}

/**
 * True when the folder has no file of the shortcut name yet, so the launcher would
 * write one. The launcher never overwrites a file without its marker.
 */
export function shortcutMissing(root, language) {
  const name = OPEN_NAMES[shortcutLanguage(language)];
  return !fs.readdirSync(root).some((entry) => entry.startsWith(`${name}.`));
}

/**
 * Writes the shortcut for this platform and ignores it in git. Throws on a write error.
 * @returns {{ path: string | null, created: boolean, ignoreChanged: boolean }}
 */
export function installShortcut(campaignRoot, { language }) {
  const root = path.resolve(campaignRoot);
  const ignoreChanged = ensureShortcutIgnoreRules(root);
  const result = writeShortcut({ campaignRoot: root, frameworkRoot: frameworkRoot(), language: shortcutLanguage(language) });
  return { path: result.path, created: result.created, ignoreChanged };
}
