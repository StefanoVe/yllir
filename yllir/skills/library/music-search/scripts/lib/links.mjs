// Music section of a place sheet. The section is `### Musica` (campaign language
// it) or `### Music` (en), inside the master-only block. Each item is one line:
//   - [<title>](<https url>) — <mood, scene use>
// This module reads those items and formats new ones. It never writes a file.

import { MASTER_MARKER } from '../../../../../scripts/lib/public-text.mjs';
import { fail } from './common.mjs';

export const MUSIC_HEADINGS = ['### Musica', '### Music'];
const MASTER_CLOSE = '<!-- /master -->';
const LINK_ITEM = /^- \[([^[\]\n]+)\]\((https:\/\/[^()\s]+)\)(?:\s+[—–-]\s+(.*))?$/;
const URL_OK = /^https:\/\/[^\s()<>[\]]+$/;
const MAX_TITLE_CHARS = 150;
const MAX_MOOD_CHARS = 300;

/**
 * Lines of the master-only block of a sheet, without the marker lines.
 * @param {string} text full file content
 * @returns {string[]|null} null when the sheet has no master block
 */
export function masterBlockLines(text) {
  const lines = String(text).split(/\r?\n/);
  const open = lines.findIndex((line) => line.trim() === MASTER_MARKER);
  if (open < 0) return null;
  const block = [];
  for (let i = open + 1; i < lines.length; i++) {
    if (lines[i].trim() === MASTER_CLOSE) break;
    block.push(lines[i]);
  }
  return block;
}

/**
 * Reads the music items of a sheet.
 * @param {string} text full file content
 * @returns {{ items: { title: string, url: string, mood: string }[], skipped: number }}
 *   items: the well-formed links under the music heading; skipped: other non-empty lines there
 */
export function readMusicItems(text) {
  const block = masterBlockLines(text);
  if (block === null) return { items: [], skipped: 0 };
  const start = block.findIndex((line) => MUSIC_HEADINGS.includes(line.trim()));
  if (start < 0) return { items: [], skipped: 0 };
  const items = [];
  let skipped = 0;
  for (let i = start + 1; i < block.length; i++) {
    const line = block[i];
    if (/^#{1,3}\s/.test(line)) break;
    if (line.trim() === '') continue;
    const match = LINK_ITEM.exec(line.trim());
    if (match === null) {
      skipped += 1;
      continue;
    }
    items.push({ title: match[1], url: match[2], mood: (match[3] ?? '').trim() });
  }
  return { items, skipped };
}

/**
 * Formats one music item as the Markdown line of the sheet.
 * @param {{ title: string, url: string, mood: string }} item
 * @returns {{ ok: true, line: string } | { ok: false, error: string, message: string }}
 */
export function formatMusicLine({ title, url, mood }) {
  const cleanTitle = String(title ?? '').trim();
  const cleanMood = String(mood ?? '').trim();
  if (cleanTitle === '' || cleanTitle.length > MAX_TITLE_CHARS || /[[\]\r\n]/.test(cleanTitle)) {
    return fail('bad-title', `the title must be 1 to ${MAX_TITLE_CHARS} characters, without brackets or line breaks`);
  }
  if (typeof url !== 'string' || !URL_OK.test(url)) {
    return fail('bad-url', 'the link must be an https address without spaces or brackets');
  }
  if (cleanMood === '' || cleanMood.length > MAX_MOOD_CHARS || /[\r\n]/.test(cleanMood)) {
    return fail('bad-mood', `the mood must be 1 to ${MAX_MOOD_CHARS} characters, on one line`);
  }
  if (/<!--|-->/.test(cleanMood) || /<!--|-->/.test(cleanTitle)) {
    return fail('bad-mood', 'the text must not contain comment markers');
  }
  return { ok: true, line: `- [${cleanTitle}](${url}) — ${cleanMood}` };
}
