// Read-only check run on every user message (UserPromptSubmit hook). Its text
// is added to the assistant's context so it keeps the active topic in view.
// It never writes and never throws: on an error it prints the header and the
// next line only.

import fs from 'node:fs';
import path from 'node:path';
import { activeTopic, listTopics, readSection } from './topics.mjs';

const HEADER = 'YLLIR TURN CHECK (for the assistant, not for the master)';
const NEXT_STEP = 'next: invoke the skill yllir:yllir before answering the master.';
const MAX_OTHER_TOPICS = 5;
const DASH = '—';

/** Plain-text check for the assistant, one message at a time. */
export function turnCheck(root) {
  try {
    return build(path.resolve(root));
  } catch {
    return [HEADER, NEXT_STEP].join('\n');
  }
}

function build(dir) {
  const lines = [HEADER];
  const active = fs.existsSync(path.join(dir, 'campaign.yaml')) ? activeTopic(dir) : null;
  if (!active) {
    lines.push('active topic: none', NEXT_STEP);
    return lines.join('\n');
  }

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
  lines.push(NEXT_STEP);
  return lines.join('\n');
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
