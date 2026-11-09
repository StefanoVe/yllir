// Read-only check run on every user message (UserPromptSubmit hook). Its text
// is added to the assistant's context so it keeps the active topic in view.
// It never writes and never throws: on an error it prints the header, the
// campaign root and the next line only.

import fs from 'node:fs';
import path from 'node:path';
import { activeTopic, listTopics, readSection } from './topics.mjs';
import { planLinks } from '../../skills/library/linker/scripts/lib/link-plan.mjs';

const HEADER = 'YLLIR TURN CHECK (for the assistant, not for the master)';
const NEXT_STEP = 'next: invoke the skill yllir:yllir before answering the master.';
const MAX_OTHER_TOPICS = 5;
const MAX_UNLINKED_FILES = 5;
const DASH = '—';

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
  const lines = [HEADER, rootLine];
  const hasCampaign = fs.existsSync(path.join(dir, 'campaign.yaml'));
  const active = hasCampaign ? activeTopic(dir) : null;
  if (active) {
    lines.push(...activeLines(dir, active));
  } else {
    lines.push('active topic: none');
  }
  if (hasCampaign) lines.push(unlinkedLine(dir));
  lines.push(NEXT_STEP);
  return lines.join('\n');
}

function activeLines(dir, active) {
  const lines = [];
  const nextStep = firstLine(section(dir, active.id, 'Next step'));
  const questions = firstLine(section(dir, active.id, 'Questions for the master'));
  lines.push(`active topic: ${active.id} ${DASH} ${active.goal} ${DASH} next step: ${nextStep}`);
  lines.push(`pending questions: ${questions}`);

  const others = listTopics(dir)
    .filter((topic) => topic.status !== 'closed' && topic.id !== active.id)
    .slice(0, MAX_OTHER_TOPICS);
  if (others.length > 0) {
    lines.push(`other open topics: ${others.map((topic) => `${topic.id} ${DASH} ${topic.goal}`).join('; ')}`);
  }
  return lines;
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

/** Section text, or null when the section cannot be read. */
function section(dir, id, name) {
  try {
    return readSection(dir, { id, section: name });
  } catch {
    return null;
  }
}

function firstLine(text) {
  if (typeof text !== 'string') return 'none';
  const line = text.trim().split('\n')[0].trim();
  return line === '' ? 'none' : line;
}
