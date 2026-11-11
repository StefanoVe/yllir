// category-first-geography-v1: the sheets of places and subjects are arranged by
// place. This module only checks whether that arrangement is still to be done; the
// guided part (guided.md) moves and links the sheets, through the write cycle.
import { planGeographicLayout } from '../../../../../scripts/lib/geographic-layout.mjs';

/** True when the layout is blocked or a migration is still required. */
export function detect(root) {
  const plan = planGeographicLayout(root);
  return plan.status === 'blocked' || plan.migrationRequired === true;
}

/** Pending while the layout needs work; nothing is written here. */
export function apply(root) {
  const plan = planGeographicLayout(root);
  const pending = plan.status === 'blocked' || plan.migrationRequired === true;
  return { status: pending ? 'pending' : 'complete', changed: [], errors: plan.errors ?? [] };
}
