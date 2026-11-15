// GET /api/plot: the plot flowchart of the campaign (the framework's readPlotFlowchart joined with plotMap).
// GET /api/plot/sheets: the plot sheets in navigator order, for previous and next sheet.
// Owner: plot engineer.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Response, Router } from 'express';
import type { PlotResponse, PlotSheetsResponse } from '../../../shared/src/types.js';
import { campaignLanguage, type Lang } from '../chat/text.js';
import type { Ctx } from '../context.js';
import { wrap } from '../http.js';
import { toPlotFlow, toPlotSheets, type PlotFlowchartResult, type PlotMapResult } from '../plot/map.js';

export const PLOT_MODULE = 'scripts/lib/plot/plot-map.mjs';
export const FLOWCHART_MODULE = 'scripts/lib/plot/plot-flowchart.mjs';

interface PlotMapModule {
  plotMap(root: string): PlotMapResult;
}

interface PlotFlowchartModule {
  readPlotFlowchart(root: string): PlotFlowchartResult;
}

const TEXTS: Record<Lang, { unsupported: string; failed: string }> = {
  en: {
    unsupported: 'This version of Yllir does not support the plot map yet.',
    failed: 'The plot map could not be built. Try again.',
  },
  it: {
    unsupported: 'Questa versione di Yllir non supporta ancora la mappa della trama.',
    failed: 'Non è stato possibile costruire la mappa della trama. Riprova.',
  },
};

/**
 * Loads the framework modules a route needs and sends what `build` makes of them.
 * 503 when one of the modules is absent, 500 when loading or building fails; plain messages.
 */
async function sendPlot<T>(
  ctx: Ctx,
  res: Response,
  files: string[],
  build: (modules: { map: PlotMapModule; flowchart: PlotFlowchartModule | undefined }) => T,
): Promise<void> {
  const lang = campaignLanguage(ctx.campaignRoot);
  const texts = TEXTS[lang];
  const absent = files.some((file) => !fs.existsSync(path.join(ctx.frameworkRoot, file)));
  if (absent) {
    res.status(503).json({ error: texts.unsupported });
    return;
  }
  try {
    const map = (await import(pathToFileURL(path.join(ctx.frameworkRoot, PLOT_MODULE)).href)) as PlotMapModule;
    const flowchart = files.includes(FLOWCHART_MODULE)
      ? ((await import(pathToFileURL(path.join(ctx.frameworkRoot, FLOWCHART_MODULE)).href)) as PlotFlowchartModule)
      : undefined;
    const body: T = build({ map, flowchart });
    res.json(body);
  } catch (err) {
    ctx.log(`plot failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    res.status(500).json({ error: texts.failed });
  }
}

export function registerPlotRoutes(app: Router, ctx: Ctx): void {
  app.get(
    '/plot',
    wrap(async (_req, res) => {
      await sendPlot<PlotResponse>(ctx, res, [PLOT_MODULE, FLOWCHART_MODULE], ({ map, flowchart }) => {
        const flow = flowchart?.readPlotFlowchart(ctx.campaignRoot);
        if (flow === undefined) throw new Error('flowchart module not loaded');
        return toPlotFlow(flow, map.plotMap(ctx.campaignRoot));
      });
    }),
  );
  app.get(
    '/plot/sheets',
    wrap(async (_req, res) => {
      await sendPlot<PlotSheetsResponse>(ctx, res, [PLOT_MODULE], ({ map }) =>
        toPlotSheets(map.plotMap(ctx.campaignRoot)),
      );
    }),
  );
}
