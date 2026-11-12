#!/usr/bin/env node
// Print CLI of the print skill.
// Usage:
//   node print.mjs list <root>
//   node print.mjs state <root> --id <id> --state <to-print|printed|reprint>
//   node print.mjs render-card <root> --id <id> [--renderer auto|photoshop|node] [--overwrite]
//   node print.mjs sheets <root> [--ids a,b] [--format 5x7|a4] [--copies id=n,...] [--cmyk true|false]
// Output: one JSON document, then a final `exit: <code>` line. Exit codes: 0 done,
// 1 refused (a domain error, see the JSON), 2 usage error.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exitWith, runCli } from '../../../../scripts/lib/cli-exit.mjs';
import { FORMATS, RENDERERS } from './lib/settings.mjs';
import { listCommand, stateCommand, renderCardCommand, sheetsCommand, clockFromEnv } from './lib/commands.mjs';
import { PRINT_STATES } from './lib/cards.mjs';

const USAGE = [
  'usage:',
  '  node print.mjs list <root>',
  '  node print.mjs state <root> --id <id> --state <to-print|printed|reprint>',
  '  node print.mjs render-card <root> --id <id> [--renderer auto|photoshop|node] [--overwrite]',
  '  node print.mjs sheets <root> [--ids a,b] [--format 5x7|a4] [--copies id=n,...] [--cmyk true|false]',
].join('\n');

const FLAGS = {
  list: {},
  state: { '--id': 'value', '--state': 'value' },
  'render-card': { '--id': 'value', '--renderer': 'value', '--overwrite': 'flag' },
  sheets: { '--ids': 'value', '--format': 'value', '--copies': 'value', '--cmyk': 'value' },
};
const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/** Parses argv into { command, root, options } or returns a usage message. */
export function parseArgs(argv) {
  const [command, rootArg, ...rest] = argv;
  if (!Object.hasOwn(FLAGS, command)) return { error: `unknown command ${command ?? ''}`.trim() };
  if (rootArg === undefined || rootArg.startsWith('--')) return { error: 'the campaign folder is required' };
  const allowed = FLAGS[command];
  const options = {};
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    if (!Object.hasOwn(allowed, flag)) return { error: `unknown option ${flag}` };
    if (Object.hasOwn(options, flag)) return { error: `${flag} given twice` };
    if (allowed[flag] === 'flag') {
      options[flag] = true;
      continue;
    }
    if (i + 1 >= rest.length || rest[i + 1].startsWith('--')) return { error: `${flag} needs a value` };
    options[flag] = rest[++i];
  }
  return { command, root: path.resolve(rootArg), options };
}

/** Validates the options of a command against their allowed values; returns a message or null. */
export function validateOptions(command, options) {
  if (command === 'state') {
    if (!options['--id'] || !ID_PATTERN.test(options['--id'])) return 'state needs --id with a valid id';
    if (!PRINT_STATES.includes(options['--state'])) return `--state must be one of ${PRINT_STATES.join(', ')}`;
  }
  if (command === 'render-card') {
    if (!options['--id'] || !ID_PATTERN.test(options['--id'])) return 'render-card needs --id with a valid id';
    if (options['--renderer'] !== undefined && !RENDERERS.includes(options['--renderer'])) {
      return `--renderer must be one of ${RENDERERS.join(', ')}`;
    }
  }
  if (command === 'sheets') {
    if (options['--format'] !== undefined && !FORMATS.includes(options['--format'])) {
      return `--format must be one of ${FORMATS.join(', ')}`;
    }
    if (options['--cmyk'] !== undefined && !['true', 'false'].includes(options['--cmyk'])) {
      return '--cmyk must be true or false';
    }
    if (options['--ids'] !== undefined) {
      const ids = options['--ids'].split(',').map((id) => id.trim());
      if (ids.some((id) => !ID_PATTERN.test(id))) return '--ids must be a list of valid ids';
    }
  }
  return null;
}

/** Parses `id=n,id=n` into a map; returns { error } on a bad entry. */
export function parseCopies(text) {
  const copies = {};
  if (text === undefined) return { copies };
  for (const entry of text.split(',').map((item) => item.trim()).filter(Boolean)) {
    const match = /^([a-z0-9][a-z0-9-]*)=(\d+)$/.exec(entry);
    if (!match) return { error: '--copies must be id=n pairs, for example lanterna-da-bordo=2' };
    const count = Number(match[2]);
    if (count < 1 || count > 50) return { error: '--copies counts must be between 1 and 50' };
    copies[match[1]] = count;
  }
  return { copies };
}

function emit(value, code) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  exitWith(code);
}

async function main(argv) {
  const parsed = parseArgs(argv);
  if (parsed.error) {
    emit({ ok: false, error: 'usage', message: `${parsed.error}\n${USAGE}` }, 2);
    return;
  }
  const { command, root, options } = parsed;
  const usage = validateOptions(command, options);
  if (usage) {
    emit({ ok: false, error: 'usage', message: usage }, 2);
    return;
  }

  if (command === 'list') {
    const { code, value } = listCommand(root);
    emit(value, code);
    return;
  }
  if (command === 'state') {
    const { code, value } = await stateCommand(root, options['--id'], options['--state']);
    emit(value, code);
    return;
  }
  if (command === 'render-card') {
    const { code, value } = renderCardCommand(root, {
      id: options['--id'],
      renderer: options['--renderer'] ?? 'auto',
      overwrite: options['--overwrite'] === true,
    });
    emit(value, code);
    return;
  }
  const copies = parseCopies(options['--copies']);
  if (copies.error) {
    emit({ ok: false, error: 'usage', message: copies.error }, 2);
    return;
  }
  let clock;
  try {
    clock = clockFromEnv();
  } catch (err) {
    emit({ ok: false, error: 'usage', message: err.message }, 2);
    return;
  }
  const ids = options['--ids'] === undefined ? null : options['--ids'].split(',').map((id) => id.trim());
  const cmyk = options['--cmyk'] === undefined ? undefined : options['--cmyk'] === 'true';
  const { code, value } = await sheetsCommand(root, {
    ids,
    format: options['--format'],
    copies: copies.copies,
    cmyk,
    clock,
  });
  emit(value, code);
}

// Runs only when this file is the program, so the tests can import the parsers.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli(() => main(process.argv.slice(2)));
}
