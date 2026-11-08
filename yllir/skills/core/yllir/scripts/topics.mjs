#!/usr/bin/env node
// Command line for topics (handoffs of work in progress). Prints JSON on stdout.
// Usage: node topics.mjs <command> <root> [options]
//   new --process <p> --goal "<g>"
//   touch --id <id> [--files "a.md,b.md"]
//   activate --id <id> | close --id <id> | check --id <id>
//   ask --id <id> --question "<q>" --next "<n>"
//   finish --id <id> --done "<d>" [--files "a.md,b.md"]
//   list | active
// Exit codes: 0 ok, 1 known error ({ "error", "message" }), 2 usage error.

import path from 'node:path';
import {
  activateTopic,
  activeTopic,
  askTopic,
  checkTopic,
  closeTopic,
  finishTopic,
  listTopics,
  newTopic,
  touchTopic,
} from '../../../../scripts/lib/topics.mjs';
import { exitWith, runCli } from '../../../../scripts/lib/cli-exit.mjs';

const USAGE =
  'usage: node topics.mjs <new|touch|activate|close|ask|finish|list|active|check> <root> [options]';

const KNOWN_CODES = ['no-topic', 'bad-handoff', 'bad-input'];

// Options accepted by each command, and the ones it requires.
const SPEC = {
  new: { options: ['process', 'goal'], required: ['process', 'goal'] },
  touch: { options: ['id', 'files'], required: ['id'] },
  activate: { options: ['id'], required: ['id'] },
  close: { options: ['id'], required: ['id'] },
  check: { options: ['id'], required: ['id'] },
  ask: { options: ['id', 'question', 'next'], required: ['id', 'question', 'next'] },
  finish: { options: ['id', 'done', 'files'], required: ['id', 'done'] },
  list: { options: [], required: [] },
  active: { options: [], required: [] },
};

function parseArgs(argv) {
  const [command, root, ...rest] = argv;
  if (command === undefined || !Object.hasOwn(SPEC, command)) return null;
  if (root === undefined || root.startsWith('--')) return null;
  const spec = SPEC[command];
  const opts = {};
  for (let i = 0; i < rest.length; i += 2) {
    const flag = rest[i];
    if (flag === undefined || !flag.startsWith('--') || i + 1 >= rest.length) return null;
    const name = flag.slice(2);
    if (!spec.options.includes(name) || Object.hasOwn(opts, name)) return null;
    opts[name] = rest[i + 1];
  }
  for (const name of spec.required) {
    if (!Object.hasOwn(opts, name)) return null;
  }
  return { command, root: path.resolve(root), opts };
}

function splitFiles(value) {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

function run({ command, root, opts }) {
  switch (command) {
    case 'new':
      return newTopic(root, { process: opts.process, goal: opts.goal });
    case 'touch':
      return touchTopic(root, {
        id: opts.id,
        files: opts.files === undefined ? [] : splitFiles(opts.files),
      });
    case 'activate':
      return activateTopic(root, { id: opts.id });
    case 'close':
      return closeTopic(root, { id: opts.id });
    case 'check':
      return checkTopic(root, { id: opts.id });
    case 'ask':
      return askTopic(root, { id: opts.id, question: opts.question, next: opts.next });
    case 'finish':
      return finishTopic(root, {
        id: opts.id,
        done: opts.done,
        files: opts.files === undefined ? [] : splitFiles(opts.files),
      });
    case 'list':
      return listTopics(root);
    case 'active':
      return activeTopic(root);
    default:
      throw new Error(`unknown command ${command}`);
  }
}

function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed === null) throw new Error(USAGE);

  try {
    const result = run(parsed);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    exitWith(0);
  } catch (err) {
    const code = KNOWN_CODES.includes(err.code) ? err.code : 'internal';
    process.stdout.write(`${JSON.stringify({ error: code, message: err.message }, null, 2)}\n`);
    exitWith(1);
  }
}

runCli(main);
