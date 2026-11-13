// The update notice memory, .campaign/state/update-notice.yaml. It is the same file the framework's
// update check writes (yllir/scripts/lib/update-check.mjs); this server reads it and writes only the
// snooze, in the same three keys. Owner: update engineer.
import fs from 'node:fs';
import path from 'node:path';

export const NOTICE_RELATIVE_PATH = path.join('.campaign', 'state', 'update-notice.yaml');
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface NoticeMemory {
  lastNotifiedVersion: string | null;
  lastNotifiedOn: string | null;
  snoozedUntil: string | null;
}

/** The memory, or empty values when the file is missing or unreadable. Never throws. */
export function readNotice(campaignRoot: string): NoticeMemory {
  const memory: NoticeMemory = { lastNotifiedVersion: null, lastNotifiedOn: null, snoozedUntil: null };
  let text: string;
  try {
    text = fs.readFileSync(path.join(campaignRoot, NOTICE_RELATIVE_PATH), 'utf8');
  } catch {
    return memory;
  }
  for (const line of text.split(/\r?\n/)) {
    const found = /^(last_notified_version|last_notified_on|snoozed_until):\s*"?([^"\s]*)"?\s*$/.exec(line);
    if (found === null) continue;
    if (found[1] === 'last_notified_version') memory.lastNotifiedVersion = found[2];
    if (found[1] === 'last_notified_on') memory.lastNotifiedOn = found[2];
    if (found[1] === 'snoozed_until') memory.snoozedUntil = found[2];
  }
  return memory;
}

/** True when a snooze runs past today. */
export function isSnoozed(memory: NoticeMemory, today: string): boolean {
  return memory.snoozedUntil !== null && DATE_RE.test(memory.snoozedUntil) && memory.snoozedUntil > today;
}

/** Writes the notice memory with a one-day snooze for the published version. */
export function writeSnooze(campaignRoot: string, opts: { version: string; today: string }): void {
  const lines = [
    `last_notified_version: "${opts.version}"`,
    `last_notified_on: "${opts.today}"`,
    `snoozed_until: "${addDays(opts.today, 1)}"`,
  ];
  const file = path.join(campaignRoot, NOTICE_RELATIVE_PATH);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${lines.join('\n')}\n`, 'utf8');
}

/** Local calendar date as YYYY-MM-DD, the same rule as the framework's update check. */
export function localDate(now: Date): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

export function addDays(date: string, days: number): string {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}
