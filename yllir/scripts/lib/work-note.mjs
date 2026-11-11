// Reads the work note that the engine writes at each commit
// (.campaign/state/work-note.md) and returns its `note:` line for the hooks.
// Read-only; never throws.

import fs from 'node:fs';
import path from 'node:path';

const NOTE_FILE = path.join('.campaign', 'state', 'work-note.md');

/** Text of the `note:` line of the work note, or 'none' when there is none. */
export function workNote(root) {
  try {
    const text = fs.readFileSync(path.join(path.resolve(root), NOTE_FILE), 'utf8');
    for (const line of text.split('\n')) {
      const match = /^note:(.*)$/.exec(line.trim());
      if (match) return match[1].trim() === '' ? 'none' : match[1].trim();
    }
    return 'none';
  } catch {
    return 'none';
  }
}
