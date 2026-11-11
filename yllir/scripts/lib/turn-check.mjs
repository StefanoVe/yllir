// Read-only check run on every user message (UserPromptSubmit hook). Its text
// is added to the assistant's context so it keeps the work note in view.
// It never writes and never throws: on an error it prints the header, the
// campaign root and the next line only.

import fs from 'node:fs';
import path from 'node:path';
import { planLinks } from './links/link-plan.mjs';
import { workNote } from './work-note.mjs';

const HEADER = 'YLLIR TURN CHECK (for the assistant, not for the master)';
const NEXT_STEP = 'next: invoke the skill yllir:yllir before answering the master.';
const MAX_UNLINKED_FILES = 5;

/** Plain-text check for the assistant, one message at a time. */
export function turnCheck(root) {
  const dir = path.resolve(root);
  const rootLine = `campaign root: ${realRoot(dir)}`;
  try {
    return build(dir, rootLine);
  } catch {
    return [HEADER, rootLine, NEXT_STEP].join('\n');
  }
}

function build(dir, rootLine) {
  const lines = [HEADER, rootLine, `work note: ${workNote(dir)}`];
  if (fs.existsSync(path.join(dir, 'campaign.yaml'))) lines.push(unlinkedLine(dir));
  lines.push(NEXT_STEP);
  return lines.join('\n');
}

/**
 * One line with the campaign files that still have unlinked mentions, from a
 * plan over the whole campaign (read-only). Never throws.
 */
function unlinkedLine(dir) {
  try {
    const plan = planLinks(dir);
    const files = [...new Set([...plan.proposals, ...plan.review].map((entry) => entry.file))];
    if (files.length === 0) {
      return plan.errors.length === 0 ? 'unlinked mentions: none' : 'unlinked mentions: unknown';
    }
    files.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const shown = files.slice(0, MAX_UNLINKED_FILES).join(', ');
    const more = files.length > MAX_UNLINKED_FILES ? `, and ${files.length - MAX_UNLINKED_FILES} more` : '';
    return `unlinked mentions: ${files.length} files: ${shown}${more}`;
  } catch {
    return 'unlinked mentions: unknown';
  }
}

/** Absolute real path of the folder, or the resolved path when it does not exist. */
function realRoot(dir) {
  try {
    return fs.realpathSync(dir);
  } catch {
    return dir;
  }
}

