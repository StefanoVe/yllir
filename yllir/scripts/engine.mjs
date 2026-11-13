#!/usr/bin/env node
// Engine command line: the checks, commits, context packs and queries that the
// agents run on a campaign. Prints one JSON document on stdout for every command,
// and ends with `exit: <code>`.
// Usage: node engine.mjs <command> <root> [options]
//   context <root> [--subjects "a,b"] [--place id] [--session id] [--out .campaign/state/<file>]
//   check   <root> [--files "a,b"] [--deletes "c"] [--sources "d"]
//   commit  <root> [--files "a,b"] [--deletes "c"] [--sources "d"] --message "<text>" [--note "<text>"]
//   review  <root> --outcome APPLY|FIX --drafts-hash <hash>   (records the batch reviewer's answer for the last check)
//   query   <root> <name> [args...]
//   index   <root>
//   change-plan <root> --subject <id>   (read-only census of the references to one subject)
//   change-draft <root> --op rename --subject <id> --title "<new title>"
//   change-draft <root> --op delete --subject <id>   (writes the drafts of a whole-subject change)
//   change-draft <root> --op merge --subject <survivor> --other <id>   (two sheets become one; writes the drafts)
// Exit codes: 0 ok, 1 campaign problem (ok:false, or a query error), 2 usage or internal error.

import fs from 'node:fs';
import path from 'node:path';
import { checkBatch, commitBatch, recordReview } from './lib/engine/commit.mjs';
import { buildContext } from './lib/engine/context.mjs';
import { changePlan } from './lib/engine/change-plan.mjs';
import { changeDraft } from './lib/engine/change-draft.mjs';
import { runQuery } from './lib/engine/query.mjs';
import { buildSubjectIndex } from './lib/subjects.mjs';
import { buildWorldIndex, writeWorldIndex } from './lib/world-graph.mjs';
import { exitWith } from './lib/cli-exit.mjs';

const USAGE = [
  'usage: node engine.mjs <command> <root> [options]',
  '  context <root> [--subjects "a,b"] [--place id] [--session id] [--out .campaign/state/<file>]',
  '  check   <root> [--files "a,b"] [--deletes "c"] [--sources "d"]',
  '  commit  <root> [--files "a,b"] [--deletes "c"] [--sources "d"] --message "<text>" [--note "<text>"]',
  '  review  <root> --outcome APPLY|FIX --drafts-hash <hash>',
  '  query   <root> <name> [args...]',
  '  index   <root>',
  '  change-plan <root> --subject <id>',
  '  change-draft <root> --op rename|delete|merge --subject <id> [--title "<new title>"] [--other <id>]',
].join('\n');

const COMMANDS = {
  context: ['subjects', 'place', 'session', 'out'],
  check: ['files', 'deletes', 'sources'],
  commit: ['files', 'deletes', 'sources', 'message', 'note'],
  review: ['outcome', 'drafts-hash'],
  query: null, // positional: <name> [args...], no options
  index: [],
  'change-plan': ['subject'],
  'change-draft': ['op', 'subject', 'title', 'other'],
};

class UsageError extends Error {}

function usageError(message) {
  throw new UsageError(`${message}\n${USAGE}`);
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

/** Comma list: split on `,`, trimmed, empty entries dropped. */
function splitList(value) {
  return value.split(',').map((item) => item.trim()).filter((item) => item !== '');
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
  if (allowed === null) {
    if (rest.length === 0 || rest[0].startsWith('--') || rest[0] === '') usageError('query needs a <name>');
    return { command, root: path.resolve(root), name: rest[0], args: rest.slice(1) };
  }
  const options = {};
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    if (!flag.startsWith('--') || !allowed.includes(flag.slice(2))) {
      usageError(`unexpected argument '${flag}' for ${command}`);
    }
    const value = rest[i + 1];
    if (value === undefined || value.startsWith('--')) usageError(`${flag} needs a value`);
    options[flag.slice(2)] = value;
    i++;
  }
  return { command, root: path.resolve(root), options };
}

function listOption(options, name) {
  return options[name] === undefined ? [] : splitList(options[name]);
}

/** --out must be a file under .campaign/state/ of the campaign. */
function checkedOutPath(out) {
  const parts = out.split('/');
  if (path.posix.isAbsolute(out) || parts.includes('..') || !out.startsWith('.campaign/state/') || out.endsWith('/')) {
    usageError('--out must be a file under .campaign/state/ of the campaign');
  }
  return out;
}

async function run(parsed) {
  const { command, root, options } = parsed;
  switch (command) {
    case 'context': {
      const pack = buildContext(root, {
        subjects: listOption(options, 'subjects'),
        place: options.place ?? null,
        session: options.session ?? null,
      });
      if (options.out !== undefined) {
        const rel = checkedOutPath(options.out);
        const full = path.join(root, rel);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, `${JSON.stringify(pack, null, 2)}\n`);
      }
      return { code: 0, value: pack };
    }
    case 'check': {
      const result = await checkBatch(root, {
        files: listOption(options, 'files'),
        deletes: listOption(options, 'deletes'),
        sources: listOption(options, 'sources'),
      });
      return { code: result.ok ? 0 : 1, value: result };
    }
    case 'commit': {
      if (options.message === undefined || options.message.trim() === '') {
        usageError('--message is required');
      }
      const result = await commitBatch(root, {
        files: listOption(options, 'files'),
        deletes: listOption(options, 'deletes'),
        sources: listOption(options, 'sources'),
        message: options.message,
        note: options.note ?? '',
      });
      return { code: result.ok ? 0 : 1, value: result };
    }
    case 'review': {
      if (options.outcome !== 'APPLY' && options.outcome !== 'FIX') {
        usageError('--outcome must be APPLY or FIX');
      }
      const result = recordReview(root, {
        outcome: options.outcome,
        draftsHash: options['drafts-hash']?.trim(),
      });
      return { code: result.ok ? 0 : 1, value: result };
    }
    case 'query': {
      const result = runQuery(root, parsed.name, parsed.args);
      return { code: result.error ? 1 : 0, value: result };
    }
    case 'index': {
      const subjects = buildSubjectIndex(root);
      const cacheDir = path.join(root, '.campaign', 'cache');
      fs.mkdirSync(cacheDir, { recursive: true });
      fs.writeFileSync(path.join(cacheDir, 'subjects.json'), `${JSON.stringify(subjects, null, 2)}\n`);
      const world = buildWorldIndex(root);
      writeWorldIndex(root, world);
      const errors = subjects.errors.length + world.errors.length;
      return { code: 0, value: { ok: errors === 0, subjects: subjects.subjects.length, errors } };
    }
    case 'change-plan': {
      if (options.subject === undefined || options.subject.trim() === '') {
        usageError('--subject is required');
      }
      const result = changePlan(root, options.subject.trim());
      return { code: result.ok ? 0 : 1, value: result };
    }
    case 'change-draft': {
      if (!['rename', 'delete', 'merge'].includes(options.op)) {
        usageError('--op must be rename, delete or merge');
      }
      if (options.subject === undefined || options.subject.trim() === '') {
        usageError('--subject is required');
      }
      if (options.op === 'rename' && options.title === undefined) usageError('--title is required for rename');
      if (options.op !== 'rename' && options.title !== undefined) {
        usageError(`--title is not allowed for ${options.op}`);
      }
      if (options.op === 'merge' && (options.other === undefined || options.other.trim() === '')) {
        usageError('--other is required for merge');
      }
      if (options.op !== 'merge' && options.other !== undefined) usageError(`--other is not allowed for ${options.op}`);
      const result = changeDraft(root, {
        op: options.op,
        subject: options.subject.trim(),
        title: options.title,
        other: options.other?.trim(),
      });
      return { code: result.ok ? 0 : 1, value: result };
    }
    default:
      usageError(`unknown command '${command}'`);
  }
  return null;
}

async function main() {
  let outcome;
  try {
    outcome = await run(parseArgs(process.argv.slice(2)));
  } catch (err) {
    if (err instanceof UsageError) {
      print({ error: 'usage', message: err.message });
      exitWith(2);
      return;
    }
    throw err;
  }
  print(outcome.value);
  exitWith(outcome.code);
}

// Unexpected failures are reported on stderr and exit 2, like every CLI of the framework.
main().catch((err) => {
  process.stderr.write(`${err?.message ?? String(err)}\n`);
  exitWith(2);
});
