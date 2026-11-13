// GET /api/plot: the plot map of the campaign, built by the framework's plot-map module.
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
import { toPlotResponse, toPlotSheets, type PlotMapResult } from '../plot/map.js';

export const PLOT_MODULE = 'scripts/lib/plot/plot-map.mjs';

interface PlotMapModule {
  plotMap(root: string): PlotMapResult;
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

/** Loads the framework's plot map and sends what `build` makes of it; 503 and 500 as plain messages. */
async function sendPlot<T>(
  ctx: Ctx,
  res: Response,
  build: (result: PlotMapResult) => T,
): Promise<void> {
  const lang = campaignLanguage(ctx.campaignRoot);
  const texts = TEXTS[lang];
  const file = path.join(ctx.frameworkRoot, PLOT_MODULE);
  if (!fs.existsSync(file)) {
    res.status(503).json({ error: texts.unsupported });
    return;
  }
  try {
    const mod = (await import(pathToFileURL(file).href)) as PlotMapModule;
    const body: T = build(mod.plotMap(ctx.campaignRoot));
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
      await sendPlot<PlotResponse>(ctx, res, toPlotResponse);
    }),
  );
  app.get(
    '/plot/sheets',
    wrap(async (_req, res) => {
      await sendPlot<PlotSheetsResponse>(ctx, res, toPlotSheets);
    }),
  );
}
