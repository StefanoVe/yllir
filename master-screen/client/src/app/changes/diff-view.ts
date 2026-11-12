import type { DiffHunk, DiffLine, FileDiff } from '@shared/types';

/** One line of the inline diff, ready for the template. `sign` is always text, never colour alone. */
export interface DiffRow {
  kind: 'hunk' | DiffLine['kind'];
  sign: '' | '+' | '-' | ' ';
  text: string;
}

const SIGN: Record<DiffLine['kind'], DiffRow['sign']> = { add: '+', del: '-', ctx: ' ' };

/** Flattens hunks into rows: each hunk header first, then its lines in order. */
export function diffRows(hunks: readonly DiffHunk[]): DiffRow[] {
  const rows: DiffRow[] = [];
  for (const hunk of hunks) {
    rows.push({ kind: 'hunk', sign: '', text: hunk.header });
    for (const line of hunk.lines) {
      rows.push({ kind: line.kind, sign: SIGN[line.kind], text: line.text });
    }
  }
  return rows;
}

/** Rows of one file of a diff response; empty when the file is not in it. */
export function fileDiffRows(files: readonly FileDiff[], path: string): DiffRow[] {
  const file = files.find((f) => f.path === path);
  return file ? diffRows(file.hunks) : [];
}
