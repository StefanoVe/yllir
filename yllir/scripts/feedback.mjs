#!/usr/bin/env node
// Feedback log of a campaign: records and reads the usage events in
// .campaign/state/feedback/events.jsonl plus optional local invocation transcripts.
// Legacy aggregate events contain no campaign text; skill events may contain
// caller-provided text in local metadata and transcript files.
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
  recordSkillStart,
  recordSkillEnd,
  skillReport,
  summarize,
} from './lib/feedback.mjs';
import { frameworkVersion, hookAgent, isCampaign } from './lib/feedback-hook.mjs';
import { activeTopic } from './lib/topics.mjs';

const USAGE =
  'usage: node feedback.mjs <record turn|record end|record note|record skill-start|record skill-end|summary|report|export> [root] [options]';

// Options accepted by each command (the root is a plain argument, not an option).
const OPTIONS = {
  'record turn': ['session', 'agent', 'version', 'topic'],
  'record end': ['session', 'agent', 'version', 'process'],
  'record note': ['outcome', 'friction', 'detail'],
  'record skill-start': ['session', 'invocation', 'parent', 'skill', 'input', 'model'],
  'record skill-end': ['session', 'invocation', 'parent', 'skill', 'status', 'artifacts', 'issues', 'transcript', 'transcript-status', 'model'],
  summary: [],
  report: ['include-transcripts'],
  export: ['out', 'include-details'],
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
  if (command === 'record skill-start' && (!options.invocation || !options.skill)) usageError('--invocation and --skill are required for record skill-start');
  if (command === 'record skill-end' && (!options.invocation || !options.skill || !options.status)) usageError('--invocation, --skill and --status are required for record skill-end');
  if (command === 'report' && options['include-transcripts'] !== undefined && options['include-transcripts'] !== 'yes') usageError('--include-transcripts accepts only yes');
  if (command === 'export' && options['include-details'] !== undefined && options['include-details'] !== 'yes') usageError('--include-details accepts only yes');
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
  if (command === 'record skill-start') {
    return report(recordSkillStart(root, { ...options, agent, version, session: options.session ?? latestSession(root) }));
  }
  if (command === 'record skill-end') {
    const { 'transcript-status': transcriptStatus, transcript, ...rest } = options;
    let transcriptText;
    if (transcript !== undefined) {
      try { transcriptText = fs.readFileSync(path.resolve(root, transcript), 'utf8'); }
      catch (error) { write(`error: transcript could not be read: ${error.message.split('\n')[0]}\n`); return 1; }
    }
    return report(recordSkillEnd(root, { ...rest, agent, version, transcript: transcriptText, transcriptStatus }));
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
  const feedbackDir = path.dirname(source);
  try {
    const canonicalTarget = resolveThroughExistingAncestor(target);
    const canonicalFeedbackDir = fs.realpathSync(feedbackDir);
    if (canonicalTarget === canonicalFeedbackDir || canonicalTarget.startsWith(`${canonicalFeedbackDir}${path.sep}`)) {
      write('error: export destination must be outside local feedback storage\n');
      return 1;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const lines = readEvents(root).flatMap((event) => {
      // Export aggregate metadata by default. Per-skill metadata is opt-in;
      // paths, free text, topic, transcript references and bodies stay local.
      if ((event.type === 'skill-start' || event.type === 'skill-end') && options['include-details'] !== 'yes') return [];
      const safe = {};
      for (const key of ['type', 'ts', 'session', 'agent', 'version', 'duration_s', 'process', 'status', 'model', 'files', 'outcome', 'friction']) {
        if (event[key] !== undefined) safe[key] = event[key];
      }
      if (event.type === 'skill-start' || event.type === 'skill-end') {
        for (const key of ['invocation', 'parent', 'skill', 'model']) if (event[key] !== undefined) safe[key] = event[key];
        if (event.type === 'skill-end' && event.transcript?.status) safe.transcript = { status: event.transcript.status };
      }
      return [JSON.stringify(safe)];
    });
    fs.writeFileSync(target, `${lines.join('\n')}${lines.length ? '\n' : ''}`);
  } catch (error) {
    write(`error: ${error.message.split('\n')[0]}\n`);
    return 1;
  }
  write(`exported: ${target}\n`);
  return 0;
}

function resolveThroughExistingAncestor(target) {
  if (fs.existsSync(target)) return fs.realpathSync(target);
  let ancestor = target;
  const suffix = [];
  while (!fs.existsSync(ancestor)) {
    suffix.unshift(path.basename(ancestor));
    const parent = path.dirname(ancestor);
    if (parent === ancestor) throw new Error('cannot resolve export destination');
    ancestor = parent;
  }
  return path.join(fs.realpathSync(ancestor), ...suffix);
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
  } else if (command === 'report') {
    write(`${JSON.stringify(skillReport(root, readEvents(root), { includeTranscripts: options['include-transcripts'] === 'yes' }), null, 2)}\n`);
    code = 0;
  } else {
    code = exportLog(root, options);
  }
  exitWith(code);
}

runCli(main);
