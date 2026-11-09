#!/usr/bin/env node
// Feedback log of a campaign: records and reads the usage events in
// .campaign/state/feedback/events.jsonl. Records are skipped outside a campaign.
// Commands:
//   record turn [root] [--session S] [--agent A] [--version V] [--topic T]
//   record end [root] [--session S] [--agent A] [--version V] [--process P]
//   record note [root] --outcome O --friction F --detail "text"
//   summary [root]
//   export [root] --out FILE
// Root defaults to the working directory. Exit codes: 0 success or skipped,
// 1 the log refused a record or export failed, 2 usage error. The last line of
// stdout is always `exit: <code>`.

import fs from 'node:fs';
import path from 'node:path';
import { exitWith, runCli } from './lib/cli-exit.mjs';
import {
  feedbackFile,
  latestSession,
  readEvents,
  recordEnd,
  recordEvent,
  summarize,
} from './lib/feedback.mjs';
import { frameworkVersion, hookAgent, isCampaign } from './lib/feedback-hook.mjs';
import { activeTopic } from './lib/topics.mjs';

const USAGE =
  'usage: node feedback.mjs <record turn|record end|record note|summary|export> [root] [options]';

// Options accepted by each command (the root is a plain argument, not an option).
const OPTIONS = {
  'record turn': ['session', 'agent', 'version', 'topic'],
  'record end': ['session', 'agent', 'version', 'process'],
  'record note': ['outcome', 'friction', 'detail'],
  summary: [],
  export: ['out'],
};

class UsageError extends Error {}

function usageError(message) {
  throw new UsageError(message);
}

function parseArgs(argv) {
  const [first, second, ...rest] = argv;
  let command;
  let tail;
  if (first === 'record') {
    command = `record ${second ?? ''}`.trim();
    tail = rest;
  } else {
    command = first ?? '';
    tail = second === undefined ? [] : [second, ...rest];
  }
  if (!Object.hasOwn(OPTIONS, command)) {
    usageError(`unknown or missing command '${command}'`);
  }

  const allowed = OPTIONS[command];
  const options = {};
  let root;
  for (let i = 0; i < tail.length; i++) {
    const token = tail[i];
    if (token.startsWith('--')) {
      const key = token.slice(2);
      if (!allowed.includes(key)) usageError(`unexpected option '${token}' for ${command}`);
      const value = tail[i + 1];
      if (value === undefined || value.startsWith('--')) usageError(`${token} needs a value`);
      options[key] = value;
      i++;
    } else {
      if (root !== undefined) usageError(`unexpected argument '${token}' for ${command}`);
      root = token;
    }
  }

  if (command === 'record note') {
    if (options.outcome === undefined) usageError('--outcome is required for record note');
    if (options.friction === undefined) usageError('--friction is required for record note');
  }
  if (command === 'export' && options.out === undefined) {
    usageError('--out is required for export');
  }
  return { command, root: path.resolve(root ?? '.'), options };
}

function write(text) {
  process.stdout.write(text);
}

/** Prints the outcome of one record and returns its exit code. */
function report(result) {
  if (!result.ok) {
    write(`error: ${result.error}\n`);
    return 1;
  }
  write(result.skipped ? 'skipped\n' : 'recorded\n');
  return 0;
}

function currentTopic(root) {
  try {
    return activeTopic(root)?.id ?? 'none';
  } catch {
    return 'none';
  }
}

function recordCommand(command, root, options) {
  if (!isCampaign(root)) {
    write('skipped: not a campaign\n');
    return 0;
  }
  const agent = options.agent ?? hookAgent();
  const version = options.version ?? frameworkVersion();

  if (command === 'record turn') {
    return report(
      recordEvent(root, {
        type: 'turn',
        session: options.session ?? `cli-${Date.now()}`,
        agent,
        version,
        topic: options.topic ?? currentTopic(root),
      }),
    );
  }
  if (command === 'record end') {
    return report(
      recordEnd(root, {
        session: options.session,
        agent,
        version,
        process: options.process,
      }),
    );
  }
  return report(
    recordEvent(root, {
      type: 'note',
      session: options.session ?? latestSession(root),
      agent,
      version,
      outcome: options.outcome,
      friction: options.friction,
      detail: options.detail,
    }),
  );
}

function exportLog(root, options) {
  const source = feedbackFile(root);
  if (!fs.existsSync(source)) {
    write('no feedback recorded yet\n');
    return 0;
  }
  const target = path.resolve(options.out);
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  } catch (error) {
    write(`error: ${error.message.split('\n')[0]}\n`);
    return 1;
  }
  write(`exported: ${target}\n`);
  return 0;
}

function main() {
  let parsed;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    process.stderr.write(`${error.message}\n${USAGE}\n`);
    exitWith(2);
    return;
  }

  const { command, root, options } = parsed;
  let code;
  if (command.startsWith('record ')) {
    code = recordCommand(command, root, options);
  } else if (command === 'summary') {
    write(`${summarize(readEvents(root))}\n`);
    code = 0;
  } else {
    code = exportLog(root, options);
  }
  exitWith(code);
}

runCli(main);
