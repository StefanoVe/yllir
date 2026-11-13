// GET /music/tracks: the music list of the master-only blocks, searched by `q` and `doc`.
// GET /music/state: the server-side playback state (MusicPlayback).
// POST /music/command: one playback command (MusicCommand), answered with the new state.
// Owner: music engineer.
import type { Router } from 'express';
import type { MusicPlayback as PlaybackState, MusicResponse } from '../../../shared/src/types.js';
import type { Ctx } from '../context.js';
import { wrap } from '../http.js';
import { musicAvailable } from '../music/availability.js';
import { queryMusic } from '../music/service.js';
import { inactivePlayback, parseMusicCommand, playbackFor } from '../music/playback.js';

type MusicBody = MusicResponse & { note?: string };

function queryString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** The state to answer: the module off answers the inactive state quietly, otherwise the controller's. */
async function currentState(ctx: Ctx): Promise<PlaybackState> {
  if (!(await musicAvailable(ctx))) return inactivePlayback();
  return playbackFor(ctx).snapshot();
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

  app.get(
    '/music/state',
    wrap(async (_req, res) => {
      res.json(await currentState(ctx));
    }),
  );

  app.post(
    '/music/command',
    wrap(async (req, res) => {
      const parsed = parseMusicCommand(req.body);
      if (!parsed.ok) {
        res.status(400).json({ error: parsed.error });
        return;
      }
      if (!(await musicAvailable(ctx))) {
        res.json(inactivePlayback());
        return;
      }
      const playback = playbackFor(ctx);
      const command = parsed.command;
      let state: PlaybackState;
      switch (command.command) {
        case 'play':
          state = playback.play(command.trackId);
          break;
        case 'pause':
          state = playback.pause();
          break;
        case 'resume':
          state = playback.resume();
          break;
        case 'stop':
          state = playback.stop();
          break;
        case 'fadeout':
          state = playback.fadeout();
          break;
        case 'seek':
          state = playback.seek(command.value);
          break;
        case 'volume':
          state = playback.volume(command.value);
          break;
        case 'loop':
          state = playback.loop(command.value);
          break;
      }
      res.json(state);
    }),
  );
}
