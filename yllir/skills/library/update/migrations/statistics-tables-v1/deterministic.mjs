// statistics-tables-v1: sheets whose Statistics section still has an old or
// ambiguous table. The deterministic conversions are staged as write-sequence
// drafts by the guided part (guided.md), not by the update itself.
import { preparePostUpdate } from '../../scripts/lib/post-update.mjs';

/** True when a sheet has a legacy Statistics table, or the scan cannot run. */
export function detect(root) {
  const scan = preparePostUpdate(root);
  return scan.candidates.length > 0 || scan.errors.length > 0;
}

/**
 * Scans the sheets. Nothing is written: the drafts are staged by the guided part
 * (post-update.mjs --prepare). Pending while a legacy table remains.
 */
export function apply(root) {
  const scan = preparePostUpdate(root);
  const changed = [...new Set([...scan.drafted, ...scan.pending.map((item) => item.file)])].sort();
  if (scan.status === 'failed') return { status: 'failed', changed, errors: scan.errors };
  return { status: scan.status === 'complete' ? 'complete' : 'pending', changed, errors: scan.errors };
}
