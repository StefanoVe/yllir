// plot-flowchart-v1: the plot map after a framework update. Needed while the campaign has sessions and
// no plot map file. The guided part runs the plot-mapper agent; this module writes nothing.
import { plotFlowchartState } from '../../scripts/lib/plot-flowchart.mjs';

/** True when the campaign has sessions and no plot map file yet. Nothing is written. */
export function detect(root) {
  try {
    return plotFlowchartState(root).status === 'missing';
  } catch {
    return false;
  }
}

/** Complete when there is nothing to draw or the map is in place and passes its checks; pending otherwise. */
export function apply(root, { dryRun = false } = {}) {
  void dryRun;
  let state;
  try {
    state = plotFlowchartState(root);
  } catch (err) {
    return { status: 'failed', changed: [], errors: [{ code: 'plot-flowchart-failed', message: err.message }] };
  }
  const done = state.status === 'none' || state.status === 'ok';
  return { status: done ? 'complete' : 'pending', changed: [], errors: [] };
}
