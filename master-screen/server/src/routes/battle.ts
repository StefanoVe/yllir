// The battle screen endpoints: players, the battle view of the active live session (GET, PUT with
// a merge of the positions), battle maps by place, and the stats tooltip of a combatant.
// The host (cockpit-host/battle.ts) does the work; a write re-publishes the cockpit state through
// the framework watch, since battle.json lives under the live state folder. Owner: live engineer.
import type { Router } from 'express';
import { BattleError, type BattleHost } from '../cockpit-host/battle.js';
import { wrap } from '../http.js';
import { ID_PATTERN } from '../live/schemas.js';

function sendBattleError(res: import('express').Response, error: unknown): void {
  if (error instanceof BattleError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  throw error;
}

export function registerBattleRoutes(app: Router, battle: BattleHost): void {
  app.get(
    '/battle/players',
    wrap(async (_req, res) => {
      res.json({ players: await battle.players() });
    }),
  );

  app.get(
    '/battle',
    wrap(async (_req, res) => {
      res.json(await battle.view());
    }),
  );

  app.put(
    '/battle',
    wrap(async (req, res) => {
      try {
        res.json(await battle.put((req.body ?? {}) as Parameters<BattleHost['put']>[0]));
      } catch (error) {
        sendBattleError(res, error);
      }
    }),
  );

  app.get(
    '/battle/maps',
    wrap(async (req, res) => {
      const place = typeof req.query.place === 'string' ? req.query.place : undefined;
      res.json(await battle.find(place));
    }),
  );

  app.get(
    '/battle/rules',
    wrap(async (_req, res) => {
      res.json(await battle.rules());
    }),
  );

  app.get(
    '/battle/stats/:combatantId',
    wrap(async (req, res) => {
      const id = String(req.params.combatantId);
      const stats = ID_PATTERN.test(id) ? await battle.stats(id) : null;
      if (stats === null) {
        res.status(404).json({ error: 'There is no such combatant in the fight.' });
        return;
      }
      res.json(stats);
    }),
  );
}
