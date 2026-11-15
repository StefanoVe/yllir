// State of the plot map for plot-flowchart-v1 (run after a framework update). The map is one file
// at the root of the plot folder, drawn by the plot-mapper agent. This module only reads: it counts
// the sessions and reports whether the map exists and passes its checks. It writes nothing.
import path from 'node:path';
import { plotMap } from '../../../../../scripts/lib/plot/plot-map.mjs';
import { checkPlotFlowchart, plotFlowchartFile } from '../../../../../scripts/lib/plot/plot-flowchart.mjs';

/**
 * - none: the campaign has no session, so there is no map to draw.
 * - missing: sessions exist and no map file exists.
 * - errors: the map file exists and fails the checks of the engine.
 * - ok: the map file exists and passes the checks.
 * @param {string} root campaign folder
 * @returns {{ status: 'none'|'missing'|'errors'|'ok', sessions: number, existing: string|null, errors: Array<{code: string, file: string, message: string}> }}
 */
export function plotFlowchartState(root) {
  const campaign = path.resolve(root);
  const sessions = plotMap(campaign).sessions.length;
  const { existing } = plotFlowchartFile(campaign);
  if (sessions === 0) return { status: 'none', sessions, existing, errors: [] };
  if (existing === null) return { status: 'missing', sessions, existing, errors: [] };
  const errors = checkPlotFlowchart(campaign);
  return { status: errors.length === 0 ? 'ok' : 'errors', sessions, existing, errors };
}
