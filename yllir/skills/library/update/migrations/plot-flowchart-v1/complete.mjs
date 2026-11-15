// plot-flowchart-v1: the guided part is finished when the plot map is in place and passes its checks,
// or when the campaign has no session.
import { plotFlowchartState } from '../../scripts/lib/plot-flowchart.mjs';

export function complete(root) {
  const state = plotFlowchartState(root);
  if (state.status === 'none' || state.status === 'ok') return { status: 'complete', errors: [] };
  if (state.status === 'missing') {
    return { status: 'pending', errors: [{ code: 'plot-flowchart-missing', file: '', message: 'the plot map has not been written yet' }] };
  }
  return { status: 'pending', errors: state.errors.map((error) => ({ code: error.code, file: error.file, message: error.message })) };
}
