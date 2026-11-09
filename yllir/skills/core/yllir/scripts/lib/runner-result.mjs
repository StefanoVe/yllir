// Runner result: the process runner writes its result to a file instead of
// printing it. This module parses that file, checks the message meant for the
// master with deterministic rules, and applies the topic bookkeeping (ask for
// QUESTION, finish for DONE). Only the message is checked; a result with any
// problem touches nothing.
// Every call is synchronous and uses only Node built-ins.

import fs from 'node:fs';
import path from 'node:path';
import { askTopic, finishTopic } from '../../../../../scripts/lib/topics.mjs';

const DEFAULT_LEXICON = path.resolve(import.meta.dirname, '..', '..', 'lexicon.md');

const STATUSES = ['DONE', 'QUESTION', 'FAILED'];
const HEADER = 'RUNNER RESULT';
const MARKER = 'message for the master:';
const VERSION_CODE = /(?<![\p{L}\p{N}])[0-9a-f]{7,40}(?![\p{L}\p{N}])/gu;
const PATH_EXTENSION = /\.(md|json|yaml|mjs|txt)$/;
const DESCRIPTIVE = ['for example', 'names of', 'codes of', 'text in'];
const SIMPLE_TERM = /^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*(?: [\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*)?$/u;
const ASK = 'ask:';
const MAX_ASKS = 4;
const HEADER_MAX = 12;
const OPTIONS_MIN = 2;
const OPTIONS_MAX = 4;
const OPTION_MAX = 40;

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The text of one ask line, in the exact form the runner writes it. */
export function formatAskLine(ask) {
  return `${ASK} ${ask.header} | ${ask.question} | ${ask.options.join(' ; ')}`;
}

/**
 * Parses and checks the `ask:` lines of a QUESTION result. Each line is
 * `ask: <header> | <question> | <option 1> ; <option 2>`. The ask text gets the
 * same forbidden-word and format checks as the message.
 */
function parseAsks(lines, neverSay) {
  const problems = [];
  const asks = [];
  if (lines.length > MAX_ASKS) {
    problems.push(`there are ${lines.length} ask lines, at most ${MAX_ASKS} are allowed`);
  }
  lines.forEach((line, index) => {
    const n = index + 1;
    const body = line.slice(ASK.length).trim();
    const parts = body.split(' | ');
    if (parts.length !== 3) {
      problems.push(`ask line ${n} must have three parts separated by " | "`);
      return;
    }
    const [header, question, optionText] = parts.map((p) => p.trim());

    if (header === '') {
      problems.push(`ask line ${n}: the header is empty`);
    } else if ([...header].length > HEADER_MAX) {
      problems.push(`ask line ${n}: the header is longer than ${HEADER_MAX} characters: ${header}`);
    }
    if (question === '') {
      problems.push(`ask line ${n}: the question is empty`);
    } else if (!question.endsWith('?')) {
      problems.push(`ask line ${n}: the question does not end with a question mark`);
    }

    const options = optionText.split(' ; ').map((o) => o.trim());
    if (options.length < OPTIONS_MIN || options.length > OPTIONS_MAX) {
      problems.push(
        `ask line ${n}: there must be ${OPTIONS_MIN} to ${OPTIONS_MAX} options, not ${options.length}`,
      );
    }
    options.forEach((option, k) => {
      if (option === '') {
        problems.push(`ask line ${n}: option ${k + 1} is empty`);
      } else if ([...option].length > OPTION_MAX) {
        problems.push(`ask line ${n}: option ${k + 1} is longer than ${OPTION_MAX} characters`);
      }
    });

    problems.push(...checkMessage(body, neverSay).problems);
    asks.push({ header, question, options });
  });
  return { asks, problems };
}

/** Problems found in the message for the master. Each is one short English sentence. */
export function checkMessage(text, neverSay = []) {
  const problems = [];
  const s = typeof text === 'string' ? text : '';
  if (s.trim() === '') {
    return { ok: false, problems: ['the message is empty'] };
  }

  for (const word of neverSay) {
    const re = new RegExp(
      `(?<![\\p{L}\\p{N}])${escapeRegExp(word)}(?![\\p{L}\\p{N}])`,
      'iu',
    );
    if (re.test(s)) {
      problems.push(`the message contains the word "${word}", which the master must never see`);
    }
  }

  if (s.includes('`')) {
    problems.push('the message contains a backtick character');
  }

  const codes = new Set(s.match(VERSION_CODE) ?? []);
  for (const code of codes) {
    if (/\d/.test(code) && /[a-f]/.test(code)) {
      problems.push(`the message contains a version code: ${code}`);
    }
  }

  const paths = new Set();
  for (const token of s.split(/\s+/)) {
    const core = token.replace(/^[^\p{L}\p{N}./]+/u, '').replace(/[^\p{L}\p{N}]+$/u, '');
    if ((core.includes('/') && PATH_EXTENSION.test(core)) || core.startsWith('.campaign')) {
      paths.add(core);
    }
  }
  for (const p of paths) {
    problems.push(`the message contains a file path: ${p}`);
  }

  return { ok: problems.length === 0, problems };
}

/**
 * The never-say words of the lexicon: the comma-separated terms of the
 * `## Never say` sentence, without the descriptive parts.
 */
export function loadNeverSay(lexiconPath = DEFAULT_LEXICON) {
  const lines = fs.readFileSync(lexiconPath, 'utf8').split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === '## Never say');
  if (start === -1) {
    throw new Error(`${lexiconPath} has no "## Never say" section`);
  }
  const paragraph = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('## ')) break;
    if (line.trim() === '') {
      if (paragraph.length > 0) break;
      continue;
    }
    paragraph.push(line.trim());
  }
  const sentence = paragraph.join(' ');
  const colon = sentence.indexOf(':');
  if (colon === -1) {
    throw new Error(`${lexiconPath}: the "## Never say" sentence has no list after a colon`);
  }
  const list = sentence.slice(colon + 1).trim().replace(/\.$/, '');
  const withoutExamples = list.replace(/\([^)]*\)/g, '');

  const words = [];
  for (const raw of withoutExamples.split(',')) {
    const part = raw.trim().replace(/^(and|or)\s+/i, '');
    const original = raw.toLowerCase();
    if (DESCRIPTIVE.some((marker) => original.includes(marker) || part.toLowerCase().includes(marker))) {
      continue;
    }
    if (!SIMPLE_TERM.test(part)) continue;
    if (!words.includes(part)) words.push(part);
  }
  return words;
}

function parseResult(text, neverSay) {
  const problems = [];
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  if (lines[0].trim() !== HEADER) {
    problems.push(`the first line must be ${HEADER}`);
  }

  const fields = {};
  const askLines = [];
  let markerIndex = -1;
  let markerText = '';
  for (let i = 1; i < lines.length; i++) {
    const marker = lines[i].startsWith(MARKER) ? lines[i].slice(MARKER.length) : null;
    if (marker !== null) {
      markerIndex = i;
      markerText = marker.trim();
      break;
    }
    if (lines[i].startsWith(ASK)) {
      askLines.push(lines[i]);
      continue;
    }
    const field = /^([a-z][a-z ]*?):(.*)$/.exec(lines[i]);
    if (field && !Object.hasOwn(fields, field[1])) {
      fields[field[1]] = field[2].trim();
    }
  }

  const status = fields.status;
  if (status === undefined || status === '') {
    problems.push('the status field is missing');
  } else if (!STATUSES.includes(status)) {
    problems.push(`the status must be DONE, QUESTION or FAILED, not ${status}`);
  }

  const required = {
    QUESTION: ['question', 'next step'],
    DONE: ['done', 'files written'],
  }[status] ?? [];
  for (const name of required) {
    if (!fields[name]) problems.push(`the ${status} result has no ${name}`);
  }

  const message = [markerText, ...lines.slice(markerIndex + 1)].join('\n').trim();
  if (markerIndex === -1) {
    problems.push(`the ${MARKER.replace(/:$/, '')} section is missing`);
  } else {
    problems.push(...checkMessage(message, neverSay).problems);
  }

  const parsedAsks = parseAsks(askLines, neverSay);
  problems.push(...parsedAsks.problems);
  if (askLines.length > 0 && status !== 'QUESTION') {
    problems.push('ask lines are allowed only with status QUESTION');
  }

  const files = (fields['files written'] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '' && s !== 'none');

  return {
    status: STATUSES.includes(status) ? status : null,
    question: fields.question ?? '',
    next: fields['next step'] ?? '',
    done: fields.done ?? '',
    files,
    message,
    asks: parsedAsks.asks,
    problems,
  };
}

/**
 * Parses a runner result file, checks its message, and when that passes applies
 * the topic bookkeeping: QUESTION asks the topic, DONE finishes it, FAILED
 * leaves it alone.
 * @returns {{ ok: boolean, status: string|null, message: string, problems: string[] }}
 */
export function applyRunnerResult(
  root,
  { file, topic, lexiconPath = DEFAULT_LEXICON } = {},
) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return { ok: false, status: null, message: '', problems: ['result file missing'] };
  }

  const neverSay = loadNeverSay(lexiconPath);
  const parsed = parseResult(text, neverSay);
  const { status, message } = parsed;
  if (parsed.problems.length > 0) {
    return { ok: false, status, message, problems: parsed.problems };
  }

  if (topic !== undefined && topic !== 'none') {
    try {
      if (status === 'QUESTION') {
        askTopic(root, { id: topic, question: parsed.question, next: parsed.next });
      } else if (status === 'DONE') {
        finishTopic(root, { id: topic, done: parsed.done, files: parsed.files });
      }
    } catch (err) {
      return {
        ok: false,
        status,
        message,
        problems: [`the topic could not be updated: ${err.message}`],
      };
    }
  }

  return { ok: true, status, message, asks: parsed.asks, problems: [] };
}
