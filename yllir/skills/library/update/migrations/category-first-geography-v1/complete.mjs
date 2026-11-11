// The guided part is finished when a fresh plan is ready and needs no migration.
import { planGeographicLayout } from '../../../../../scripts/lib/geographic-layout.mjs';

export function complete(root) {
  const plan = planGeographicLayout(root);
  if (plan.status !== 'ready' || plan.migrationRequired === true) {
    const errors = plan.errors?.length ? plan.errors : [{ code: 'geography-migration-incomplete', message: 'the geographic layout still has pending work or errors' }];
    return { status: 'pending', errors };
  }
  return { status: 'complete', errors: [] };
}
