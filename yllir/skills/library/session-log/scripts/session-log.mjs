#!/usr/bin/env node
// Live session log of a campaign. Prints one JSON document and ends with `exit: <code>`.
// Usage: node session-log.mjs <open|add|update|remove|list|end|status|source> <root> [options]
//   open    [--title "<title>"] [--session-ref "<campaign path of the plot session>"]
//   add     --kind <fact|decision|intention|thread> --text "<text>" [--scene "<path>"]
//           [--subjects "a,b"] [--by <master|agent>] [--resolved true|false]
//   update  --id <e-0001> [--kind ...] [--text ...] [--scene "<path>" | --scene ""]
//           [--subjects "a,b" | --subjects ""] [--resolved true|false]
//   remove  --id <e-0001>
//   list | end | status
//   source  [--session <id>]     working text of the session, Markdown on stdout as JSON
// Exit codes: 0 done, 1 domain error (see error.code in the JSON), 2 usage error.

import path from 'node:path';
import * as store from './lib/log-store.mjs';
import { buildChronicleSource } from './lib/chronicle-draft.mjs';
import { exitWith, runCli } from '../../../../scripts/lib/cli-exit.mjs';

const USAGE =
  'usage: node session-log.mjs <open|add|update|remove|list|end|status|source> <root> [options]';

const OPTIONS_BY_OP = {
  open: ['--title', '--session-ref'],
  add: ['--kind', '--text', '--scene', '--subjects', '--by', '--resolved'],
  update: ['--id', '--kind', '--text', '--scene', '--subjects', '--resolved'],
  remove: ['--id'],
  list: [],
  end: [],
  status: [],
  source: ['--session'],
};
const REQUIRED_BY_OP = { add: ['--kind', '--text'], update: ['--id'], remove: ['--id'] };

class UsageError extends Error {}

/** Splits "a, b,,c" into ["a", "b", "c"]. An empty text gives an empty list. */
function splitSubjects(text) {
  return text.split(',').map((part) => part.trim()).filter((part) => part !== '');
}

/** Reads argv into { op, root, options }. Throws UsageError on any mistake in the command line. */
function parseArgv(argv) {
  const [op, root, ...rest] = argv;
  if (!Object.hasOwn(OPTIONS_BY_OP, op) || root === undefined || root.startsWith('--')) {
    throw new UsageError(USAGE);
  }
  const allowed = OPTIONS_BY_OP[op];
  const options = {};
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    if (!allowed.includes(flag)) throw new UsageError(`${flag} is not an option of ${op}. ${USAGE}`);
    if (i + 1 >= rest.length) throw new UsageError(`${flag} needs a value.`);
    if (Object.hasOwn(options, flag)) throw new UsageError(`${flag} is given more than once.`);
    options[flag] = rest[++i];
  }
  for (const flag of REQUIRED_BY_OP[op] ?? []) {
    if (!Object.hasOwn(options, flag)) throw new UsageError(`${op} needs ${flag}. ${USAGE}`);
  }
  if (Object.hasOwn(options, '--resolved') && !['true', 'false'].includes(options['--resolved'])) {
    throw new UsageError('--resolved takes true or false.');
  }
  return { op, root, options };
}

/** Turns the parsed options into the arguments of the library function. */
function runOperation({ op, root, options }) {
  switch (op) {
    case 'open':
      return store.openSession(root, {
        title: options['--title'],
        sessionRef: options['--session-ref'],
      });
    case 'add':
      return store.addEntry(root, {
        kind: options['--kind'],
        text: options['--text'],
        scene: options['--scene'],
        subjects: options['--subjects'] === undefined ? undefined : splitSubjects(options['--subjects']),
        by: options['--by'],
        resolved: options['--resolved'] === undefined ? undefined : options['--resolved'] === 'true',
      });
    case 'update': {
      const patch = {};
      if (options['--kind'] !== undefined) patch.kind = options['--kind'];
      if (options['--text'] !== undefined) patch.text = options['--text'];
      if (options['--scene'] !== undefined) patch.scene = options['--scene'] === '' ? null : options['--scene'];
      if (options['--subjects'] !== undefined) {
        const subjects = splitSubjects(options['--subjects']);
        patch.subjects = subjects.length === 0 ? null : subjects;
      }
      if (options['--resolved'] !== undefined) patch.resolved = options['--resolved'] === 'true';
      return store.updateEntry(root, options['--id'], patch);
    }
    case 'remove':
      return store.removeEntry(root, options['--id']);
    case 'list':
      return store.listEntries(root);
    case 'end':
      return store.endSession(root);
    case 'status': {
      const active = store.getActive(root);
      if (!active.ok) return active;
      if (!active.session) return { ok: true, session: null, entryCount: 0 };
      const listed = store.listEntries(root);
      if (!listed.ok) return listed;
      return { ok: true, session: active.session, entryCount: listed.entries.length };
    }
    case 'source':
      return buildChronicleSource(root, options['--session']);
    default:
      throw new UsageError(USAGE);
  }
}

function main() {
  let parsed;
  try {
    parsed = parseArgv(process.argv.slice(2));
  } catch (err) {
    if (!(err instanceof UsageError)) throw err;
    process.stdout.write(`${JSON.stringify({ ok: false, error: { code: 'usage', message: err.message } }, null, 2)}\n`);
    exitWith(2);
    return;
  }
  parsed.root = path.resolve(parsed.root);
  const result = runOperation(parsed);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  exitWith(result.ok ? 0 : 1);
}

runCli(main);
