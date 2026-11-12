// /api/print: the card list, state and render actions, sheets, and the generated PDFs.
// Off module: no framework call. Render is always the Node renderer here; Photoshop cards are
// made by the assistant in the chat. Owner: master-screen server.
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Request, Response, Router } from 'express';
import type { PrintStatus } from '../../../shared/src/types.js';
import type { Ctx } from '../context.js';
import { wrap } from '../http.js';
import { isInside } from '../encyclopedia/site.js';
import { PDF_NAME, renderBody, sheetsBody, stateBody } from '../print/schemas.js';
import {
  failureSentence,
  generateSheets,
  printEnabled,
  printTexts,
  readPrintStatus,
  runCardCommand,
} from '../print/service.js';

/** Where the sheets PDFs are written by the framework. */
export function printDirOf(campaignRoot: string): string {
  return path.join(campaignRoot, '.campaign', 'cache', 'print');
}

/** The real path of a generated sheets file, or null: name checked, containment checked. */
export async function resolvePrintFile(campaignRoot: string, name: string): Promise<string | null> {
  if (!PDF_NAME.test(name)) return null;
  try {
    const dir = await fs.realpath(printDirOf(campaignRoot));
    const real = await fs.realpath(path.join(dir, name));
    if (!isInside(dir, real) || real === dir) return null;
    return (await fs.stat(real)).isFile() ? real : null;
  } catch {
    return null;
  }
}

function sendStatus(ctx: Ctx, res: Response, status: PrintStatus | null): void {
  if (status === null) {
    res.status(500).json({ error: printTexts(ctx).readFailed });
    return;
  }
  res.json(status);
}

async function currentStatus(ctx: Ctx): Promise<PrintStatus | null> {
  try {
    return await readPrintStatus(ctx);
  } catch (err) {
    ctx.log(`print list failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

function invalid(ctx: Ctx, res: Response): void {
  res.status(400).json({ error: printTexts(ctx).invalid });
}

export function registerPrintRoutes(api: Router, ctx: Ctx): void {
  const texts = () => printTexts(ctx);

  api.get(
    '/print',
    wrap(async (_req, res) => {
      sendStatus(ctx, res, await currentStatus(ctx));
    }),
  );

  api.post(
    '/print/state',
    wrap(async (req: Request, res: Response) => {
      if (!(await printEnabled(ctx))) {
        res.status(409).json({ error: texts().notEnabled });
        return;
      }
      const parsed = stateBody.safeParse(req.body ?? {});
      if (!parsed.success) return invalid(ctx, res);
      const result = await runCardCommand(ctx, [
        'state',
        ctx.campaignRoot,
        '--id',
        parsed.data.id,
        '--state',
        parsed.data.state,
      ]);
      if (!result.ok) {
        res.status(409).json({ error: failureSentence(result.json, texts(), texts().stateFailed) });
        return;
      }
      // A canon commit happened: the same change event the other canon-changing paths publish.
      ctx.bus.publish('changes', {});
      sendStatus(ctx, res, await currentStatus(ctx));
    }),
  );

  api.post(
    '/print/render',
    wrap(async (req: Request, res: Response) => {
      if (!(await printEnabled(ctx))) {
        res.status(409).json({ error: texts().notEnabled });
        return;
      }
      const parsed = renderBody.safeParse(req.body ?? {});
      if (!parsed.success) return invalid(ctx, res);
      if (parsed.data.renderer === 'photoshop') {
        res.status(409).json({ error: texts().photoshop });
        return;
      }
      // auto and node both run the Node renderer: the server never calls Photoshop.
      const result = await runCardCommand(ctx, [
        'render-card',
        ctx.campaignRoot,
        '--id',
        parsed.data.id,
        '--renderer',
        'node',
      ]);
      if (!result.ok) {
        res.status(409).json({ error: failureSentence(result.json, texts(), texts().renderFailed) });
        return;
      }
      sendStatus(ctx, res, await currentStatus(ctx));
    }),
  );

  api.post(
    '/print/sheets',
    wrap(async (req: Request, res: Response) => {
      if (!(await printEnabled(ctx))) {
        res.status(409).json({ error: texts().notEnabled });
        return;
      }
      const parsed = sheetsBody.safeParse(req.body ?? {});
      if (!parsed.success) return invalid(ctx, res);
      const body = parsed.data;
      const args: string[] = [];
      if (body.ids) args.push('--ids', body.ids.join(','));
      if (body.format) args.push('--format', body.format);
      if (body.copies) {
        const pairs = Object.entries(body.copies).map(([id, count]) => `${id}=${count}`);
        if (pairs.length > 0) args.push('--copies', pairs.join(','));
      }
      if (body.cmyk !== undefined) args.push('--cmyk', String(body.cmyk));
      const answer = await generateSheets(ctx, args);
      res.status(answer.status).json(answer.body);
    }),
  );

  api.get(
    '/print/files/:name',
    wrap(async (req: Request, res: Response) => {
      const name = String(req.params.name);
      const notFound = (): void => {
        res.status(404).json({ error: texts().notFound });
      };
      if (!PDF_NAME.test(name) || !(await printEnabled(ctx))) return notFound();
      const file = await resolvePrintFile(ctx.campaignRoot, name);
      if (file === null) return notFound();
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${name}"`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'no-cache');
      // root is the real folder of the file: dotfiles are checked on the name only, not on the
      // campaign's own `.campaign` folder, which is part of the absolute path.
      res.sendFile(path.basename(file), { root: path.dirname(file), dotfiles: 'deny' }, (err) => {
        if (err && !res.headersSent) notFound();
      });
    }),
  );
}
