#!/usr/bin/env node
// Saved versions of a campaign (git history), for the framework's own use.
// Prints one JSON document on stdout for every command.
// Usage: node versions.mjs <command> <root> [options]
//   ensure <root>
//   status <root>
//   save <root> --message "<sentence>" [--kind framework|manual]
//   save-manual <root> --message "<sentence>"
//   list <root> [--limit N] [--paths a.md,b.md]
//   restore <root> --to <hash> [--paths a.md,b.md] --message "<sentence>"
// Exit codes: 0 success, 1 known error, 2 usage error.

import path from 'node:path';
import {
  ensureRepo,
  status,
  saveVersion,
  saveManualChanges,
  listVersions,
  restore,
} from './lib/versions.mjs';
import { exitWith, runCli } from './lib/cli-exit.mjs';

const COMMANDS = {
  ensure: [],
  status: [],
  save: ['message', 'kind'],
  'save-manual': ['message'],
  list: ['limit', 'paths'],
  restore: ['to', 'paths', 'message'],
};

const USAGE =
  'usage: node versions.mjs <ensure|status|save|save-manual|list|restore> <root> [options]';

class UsageError extends Error {}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function usageError(message) {
  throw new UsageError(`${message}. ${USAGE}`);
}

function parseArgs(argv) {
  const [command, root, ...rest] = argv;
  if (command === undefined || !Object.hasOwn(COMMANDS, command)) {
    usageError(`unknown or missing command '${command ?? ''}'`);
  }
  if (root === undefined || root.startsWith('--') || root === '') {
    usageError('missing <root>');
  }
  const allowed = COMMANDS[command];
  const options = {};
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    if (!flag.startsWith('--') || !allowed.includes(flag.slice(2))) {
      usageError(`unexpected argument '${flag}' for ${command}`);
    }
    const value = rest[i + 1];
    if (value === undefined || value.startsWith('--')) {
      usageError(`${flag} needs a value`);
    }
    options[flag.slice(2)] = value;
    i++;
  }
  return { command, root: path.resolve(root), options };
}

function parsePaths(value) {
  const paths = value.split(',');
  return paths.some((item) => item === '') ? null : paths;
}

function requireMessage(options) {
  if (options.message === undefined || options.message.trim() === '') {
    usageError('--message is required');
  }
  return options.message;
}

function run(command, root, options) {
  switch (command) {
    case 'ensure':
      return ensureRepo(root);
    case 'status':
      return status(root);
    case 'save': {
      const message = requireMessage(options);
      const kind = options.kind ?? 'framework';
      if (kind !== 'framework' && kind !== 'manual') {
        usageError('--kind must be framework or manual');
      }
      return saveVersion(root, { message, kind });
    }
    case 'save-manual': {
      const message = requireMessage(options);
      return saveManualChanges(root, message);
    }
    case 'list': {
      const listOptions = {};
      if (options.limit !== undefined) {
        if (!/^[1-9]\d*$/.test(options.limit)) {
          usageError('--limit must be a positive integer');
        }
        listOptions.limit = Number(options.limit);
      }
      if (options.paths !== undefined) {
        const paths = parsePaths(options.paths);
        if (paths === null) usageError('--paths has an empty entry');
        listOptions.paths = paths;
      }
      return listVersions(root, listOptions);
    }
    case 'restore': {
      if (options.to === undefined) usageError('--to is required');
      const message = requireMessage(options);
      const restoreOptions = { to: options.to, message };
      if (options.paths !== undefined) {
        const paths = parsePaths(options.paths);
        if (paths === null) usageError('--paths has an empty entry');
        restoreOptions.paths = paths;
      }
      return restore(root, restoreOptions);
    }
    default:
      usageError(`unknown command '${command}'`);
  }
}

function main() {
  try {
    const parsed = parseArgs(process.argv.slice(2));
    print(run(parsed.command, parsed.root, parsed.options));
  } catch (err) {
    if (err instanceof UsageError) {
      print({ error: 'usage', message: err.message });
      exitWith(2);
      return;
    }
    print({ error: err.code ?? 'internal', message: err.message });
    exitWith(1);
    return;
  }
  exitWith(0);
}

runCli(main);
