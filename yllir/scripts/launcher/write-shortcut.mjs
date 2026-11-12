// Writes the double-clickable shortcut of the master screen into a campaign folder.
// Templates live in ./templates. A shortcut that already exists is only replaced when
// it carries the marker (first line, or second line after a shebang); any other file
// with that name is left alone.

import fs from 'node:fs';
import path from 'node:path';

export const MARKER = 'yllir-shortcut v1';
const TEMPLATES = path.join(import.meta.dirname, 'templates');

const NAMES = {
  it: { open: 'Apri master screen', notFound: "Non riesco ad avviare il master screen. Riprova; se continua, chiedi aiuto all'assistente." },
  en: { open: 'Open master screen', notFound: 'I could not start the master screen. Try again; if it keeps happening, ask the assistant for help.' },
};

/** Escapes a value for a double-quoted POSIX shell string. */
function escapeSh(value) {
  return String(value).replace(/[\\"$`]/g, '\\$&');
}

/**
 * Escapes a path for a double-quoted `set "FW=..."` line of a batch file. A literal
 * percent sign is doubled. The template never enables delayed expansion, so `!` is safe.
 * Quotes and line breaks cannot appear in a Windows path and are refused.
 */
function escapeCmd(value) {
  const text = String(value);
  if (/["\r\n\0]/.test(text)) throw new Error('the framework path cannot be written into a Windows shortcut');
  return text.replace(/%/g, '%%');
}

/** Escapes a message for an `echo` line inside a parenthesised block of a batch file. */
function escapeCmdEcho(value) {
  return String(value).replace(/[%^&|<>()]/g, (c) => (c === '%' ? '%%' : `^${c}`));
}

/** A desktop Exec value: one quoted argument, with the escapes the spec requires. */
function escapeExec(value) {
  const quoted = `"${String(value).replace(/[\\"`$]/g, '\\$&')}"`;
  return quoted.replace(/%/g, '%%');
}

function render(template, values) {
  let out = template;
  for (const [key, value] of Object.entries(values)) {
    out = out.split(`{{${key}}}`).join(value);
  }
  if (/\{\{[A-Z_]+\}\}/.test(out)) throw new Error('shortcut template has an unfilled placeholder');
  return out;
}

/** True when the content carries the marker: first line, or second line after a shebang. */
export function isOwnShortcut(content) {
  const lines = String(content).split(/\r?\n/);
  if (lines[0].includes(MARKER)) return true;
  return lines[0].startsWith('#!') && (lines[1] ?? '').includes(MARKER);
}

/** The files a platform gets, in order; the first one is the main shortcut. */
function plan(platform, lang, campaignRoot, frameworkRoot) {
  const names = NAMES[lang];
  const common = { LANG: lang };
  if (platform === 'darwin') {
    return [
      {
        file: `${names.open}.command`,
        template: 'unix-shortcut.sh',
        mode: 0o755,
        values: { ...common, FRAMEWORK_DEFAULT: escapeSh(frameworkRoot), NOT_FOUND: escapeSh(names.notFound) },
      },
    ];
  }
  if (platform === 'linux') {
    const script = path.join(campaignRoot, `${names.open}.sh`);
    return [
      {
        file: `${names.open}.sh`,
        template: 'unix-shortcut.sh',
        mode: 0o755,
        values: { ...common, FRAMEWORK_DEFAULT: escapeSh(frameworkRoot), NOT_FOUND: escapeSh(names.notFound) },
      },
      {
        file: `${names.open}.desktop`,
        template: 'linux-launcher.desktop',
        mode: 0o755,
        values: {
          NAME: names.open,
          EXEC: escapeExec(script),
          CAMPAIGN: campaignRoot,
        },
      },
    ];
  }
  if (platform === 'win32') {
    return [
      {
        file: `${names.open}.cmd`,
        template: 'windows-shortcut.cmd',
        mode: 0o644,
        eol: '\r\n',
        values: { ...common, FRAMEWORK_DEFAULT: escapeCmd(frameworkRoot), NOT_FOUND: escapeCmdEcho(names.notFound) },
      },
    ];
  }
  return null;
}

/** Writes one file unless an unrelated file already holds that name. Returns true when written. */
function writeOne(target, body, mode, platform) {
  if (fs.existsSync(target)) {
    const current = fs.readFileSync(target, 'utf8');
    if (current === body) return false;
    if (!isOwnShortcut(current)) return false;
  }
  const temp = `${target}.tmp-${process.pid}`;
  fs.writeFileSync(temp, body);
  if (platform !== 'win32') fs.chmodSync(temp, mode);
  fs.renameSync(temp, target);
  return true;
}

/**
 * Writes the shortcut(s) for this platform into campaignRoot.
 * Resolves to { path, created }: path is the main shortcut, created is true when a
 * file was written (new, or refreshed because it carried the marker). For a platform
 * without a shortcut it returns { path: null, created: false }.
 */
export function writeShortcut({ campaignRoot, frameworkRoot, language = 'en', platform = process.platform }) {
  const lang = language === 'it' ? 'it' : 'en';
  const root = path.resolve(campaignRoot);
  const files = plan(platform, lang, root, String(frameworkRoot));
  if (files === null) return { path: null, created: false };

  let created = false;
  for (const item of files) {
    let body = render(fs.readFileSync(path.join(TEMPLATES, item.template), 'utf8'), item.values);
    // cmd.exe needs CRLF line endings: a batch file with bare LF lines is misread.
    if (item.eol) body = body.replace(/\r?\n/g, item.eol);
    if (writeOne(path.join(root, item.file), body, item.mode, platform)) created = true;
  }
  return { path: path.join(root, files[0].file), created };
}
