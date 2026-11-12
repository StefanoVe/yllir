// GET /api/music/tracks. The music list of the master-only blocks, searched by `q` and `doc`.
// Owner: music engineer.
import type { Router } from 'express';
import type { MusicResponse } from '../../../shared/src/types.js';
import type { Ctx } from '../context.js';
import { wrap } from '../http.js';
import { queryMusic } from '../music/service.js';

type MusicBody = MusicResponse & { note?: string };

function queryString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function registerMusicRoutes(app: Router, ctx: Ctx): void {
  app.get(
    '/music/tracks',
    wrap(async (req, res) => {
      const result = await queryMusic(ctx, {
        query: queryString(req.query.q),
        doc: queryString(req.query.doc),
      });
      const body: MusicBody = {
        enabled: result.enabled,
        tracks: result.tracks,
        ...(result.note !== undefined ? { note: result.note } : {}),
      };
      res.json(body);
    }),
  );
}
