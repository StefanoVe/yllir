// Builds the change groups (one per git commit that touched canon) newest first, with
// plain-language summaries, undo state and the chat message each one belongs to.
// Owner: history engineer.
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ChangedFile, ChangeGroup } from '../../../shared/src/types.js';
import { readCampaignSummary } from '../campaign.js';
import type { Ctx } from '../context.js';
import { isLocalPath, log, revList, SHA_PATTERN, type LogEntry } from './git.js';
import { langOf, messages, type Lang, type Messages } from './text.js';

/** Commits read from the log. Groups beyond the requested limit are kept for undo lookups. */
export const HISTORY_WINDOW = 1000;
export const UNDO_PREFIX = 'Undo: ';

export interface HistoryItem {
  group: ChangeGroup;
  /** Raw commit subject. An undo commit carries the original subject after UNDO_PREFIX. */
  subject: string;
}

interface TurnRecord {
  messageId: string;
  fromSha: string;
  toSha: string;
}

/** Canon files only. A rename from .campaign/ into canon is an addition. */
export function canonFiles(files: ChangedFile[]): ChangedFile[] {
  const out: ChangedFile[] = [];
  for (const file of files) {
    if (isLocalPath(file.path)) continue;
    const from = file.from !== undefined && !isLocalPath(file.from) ? file.from : undefined;
    const status = file.status === 'renamed' && from === undefined ? 'added' : file.status;
    out.push(from === undefined ? { path: file.path, status } : { path: file.path, status, from });
  }
  return out;
}

/** Identity of a change for pairing an undo with the change it reverts (renames include both names). */
function pairKey(files: ChangedFile[]): string {
  const names = new Set<string>();
  for (const file of files) {
    names.add(file.path);
    if (file.from !== undefined) names.add(file.from);
  }
  return [...names].sort().join('\n');
}

const VERSION_TAIL = /\s*[;,]?\s*\(?\bv(?:ersion)?\s*\d+(?:\.\d+)+[\w.-]*\)?\s*$/i;
const VERSION_HEAD = /^\s*v?\d+(?:\.\d+)+[\w.-]*\s*[-:]\s*/i;
const IDS_TAIL = /\s*[[(]\s*(?:ids?|sha)\b[^\])]*[\])]\s*$/i;
const HEX_ID = /\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b/i;

/** Removes version numbers and ids from a commit subject. */
export function cleanSubject(raw: string): string {
  let text = raw.trim().replace(VERSION_HEAD, '');
  text = text.replace(VERSION_TAIL, '').replace(IDS_TAIL, '');
  return text.replace(/\s+/g, ' ').replace(/[\s;,:-]+$/, '').trim();
}

/** A subject is a usable sentence when it reads as one and shows no git-like token. */
function isSentence(text: string): boolean {
  return /^\p{Lu}/u.test(text) && text.split(' ').length >= 3 && !HEX_ID.test(text) && !/[_/\\]/.test(text);
}

/** Plain-language summary of one group. Never shows a sha. */
export function summarize(subject: string, isUndo: boolean, fileCount: number, lang: Lang): string {
  const texts: Messages = messages(lang);
  const base = isUndo ? subject.replace(/^Undo:\s*/, '') : subject;
  const cleaned = cleanSubject(base);
  const body = isSentence(cleaned) ? cleaned : texts.changedDocs(fileCount);
  return isUndo ? texts.undone(body) : body;
}

function isTurnRecord(value: unknown): value is TurnRecord {
  if (typeof value !== 'object' || value === null) return false;
  const turn = value as Record<string, unknown>;
  return (
    typeof turn.messageId === 'string' &&
    turn.messageId !== '' &&
    typeof turn.fromSha === 'string' &&
    SHA_PATTERN.test(turn.fromSha) &&
    typeof turn.toSha === 'string' &&
    SHA_PATTERN.test(turn.toSha)
  );
}

/** Turns written by the chat engine. A missing or unreadable file means no turns. */
async function readTurns(ctx: Ctx): Promise<TurnRecord[]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await fs.readFile(path.join(ctx.state.dir, 'turns.json'), 'utf8'));
  } catch {
    return [];
  }
  return Array.isArray(parsed) ? parsed.filter(isTurnRecord) : [];
}

/** Maps each commit sha to the message of the first turn whose range contains it. */
async function associateTurns(root: string, turns: TurnRecord[]): Promise<Map<string, string>> {
  const bySha = new Map<string, string>();
  for (const turn of turns) {
    let shas: string[];
    try {
      shas = await revList(root, turn.fromSha, turn.toSha);
    } catch {
      continue;
    }
    for (const sha of shas) {
      if (!bySha.has(sha)) bySha.set(sha, turn.messageId);
    }
  }
  return bySha;
}

/**
 * Every change group of the campaign, newest first. Commits that touch only .campaign/ are
 * left out. A group is undone when a later undo commit carries its subject and its files.
 */
export async function loadHistory(ctx: Ctx): Promise<HistoryItem[]> {
  const root = ctx.campaignRoot;
  const entries: LogEntry[] = await log(root, HISTORY_WINDOW);
  const lang = langOf((await readCampaignSummary(ctx)).campaign.language);
  const kept = entries
    .map((entry) => ({ entry, files: canonFiles(entry.files) }))
    .filter((item) => item.files.length > 0);
  const keys = kept.map((item) => pairKey(item.files));

  const undone = new Set<string>();
  kept.forEach((item, i) => {
    if (!item.entry.subject.startsWith(UNDO_PREFIX)) return;
    const original = item.entry.subject.slice(UNDO_PREFIX.length);
    for (let j = i + 1; j < kept.length; j++) {
      const older = kept[j].entry;
      if (older.subject.startsWith(UNDO_PREFIX) || undone.has(older.sha)) continue;
      if (older.subject === original && keys[j] === keys[i]) {
        undone.add(older.sha);
        break;
      }
    }
  });

  const turnOf = await associateTurns(root, await readTurns(ctx));
  return kept.map((item, i) => {
    const entry = item.entry;
    const isUndo = entry.subject.startsWith(UNDO_PREFIX);
    const group: ChangeGroup = {
      id: entry.sha,
      at: entry.at,
      summary: summarize(entry.subject, isUndo, item.files.length, lang),
      files: item.files,
      undone: undone.has(entry.sha),
      isUndo,
    };
    const messageId = turnOf.get(entry.sha);
    if (messageId !== undefined) group.chatMessageId = messageId;
    return { group, subject: entry.subject };
  });
}
