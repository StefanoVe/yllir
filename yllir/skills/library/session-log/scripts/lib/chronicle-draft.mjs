// Working text for the after-session process: the live log of one session as plain
// Markdown. It is NOT a campaign document: no metadata block, nothing written to disk.
// The entries keep the master's words; the after-session process decides what to keep.

import { getActive, readSession } from './log-store.mjs';
import { fail, isCampaignRoot, listSessionIds } from './live-files.mjs';

/** One line per entry: the text, then the scene and the subjects when they are set. */
function entryLine(entry) {
  const text = entry.text.replace(/\s*\n\s*/g, ' ').trim();
  const notes = [];
  if (entry.scene) notes.push(`scene: ${entry.scene}`);
  if (entry.subjects?.length) notes.push(`subjects: ${entry.subjects.join(', ')}`);
  return notes.length > 0 ? `- ${text} [${notes.join('; ')}]` : `- ${text}`;
}

function section(heading, lines) {
  return [`## ${heading}`, '', ...(lines.length > 0 ? lines : ['- none recorded']), ''];
}

/**
 * Session to use when none is named: the active one, otherwise the last session of the
 * campaign (ended or not).
 */
function defaultSessionId(root) {
  const active = getActive(root);
  if (!active.ok) return active;
  if (active.session) return { ok: true, sessionId: active.session.id };
  const ids = listSessionIds(root);
  if (ids.length === 0) return fail('no-session', 'There is no live session in this campaign yet.');
  return { ok: true, sessionId: ids[ids.length - 1] };
}

/**
 * Builds the working text of one session. Facts, decisions and intentions keep the order
 * of the log; open and resolved threads are listed separately. The sessionId is optional:
 * without it the active session, or else the last one, is used.
 */
export function buildChronicleSource(root, sessionId) {
  if (!isCampaignRoot(root)) {
    return fail('not-a-campaign', 'This folder is not a campaign: there is no campaign file in it.');
  }
  let id = sessionId;
  if (id === undefined) {
    const chosen = defaultSessionId(root);
    if (!chosen.ok) return chosen;
    id = chosen.sessionId;
  }
  const read = readSession(root, id);
  if (!read.ok) return read;

  const { session, entries } = read;
  const byKind = (kind) => entries.filter((entry) => entry.kind === kind);
  const threads = byKind('thread');
  const date = session.id.slice(0, 10);

  const header = [`# ${session.title}`, '', `Session date: ${date}`];
  if (session.sessionRef) header.push(`Plot session: ${session.sessionRef}`);
  header.push('');

  const markdown = [
    ...header,
    ...section('Facts', byKind('fact').map(entryLine)),
    ...section('Decisions', byKind('decision').map(entryLine)),
    ...section('Intentions', byKind('intention').map(entryLine)),
    '## Threads',
    '',
    '### Open',
    '',
    ...(threads.some((t) => !t.resolved) ? threads.filter((t) => !t.resolved).map(entryLine) : ['- none recorded']),
    '',
    '### Resolved',
    '',
    ...(threads.some((t) => t.resolved) ? threads.filter((t) => t.resolved).map(entryLine) : ['- none recorded']),
    '',
  ].join('\n');

  return { ok: true, sessionId: session.id, markdown };
}
