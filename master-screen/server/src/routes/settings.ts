// GET /api/settings and PUT /api/settings: the master screen settings. Owner: settings engineer.
import type { Router } from 'express';
import type { SettingsResponse } from '../../../shared/src/types.js';
import type { Ctx } from '../context.js';
import { wrap } from '../http.js';
import { DEFAULT_SETTINGS, settingsPatchSchema } from '../settings/schema.js';
import { existingPlayback } from '../music/playback.js';
import { gitAvailable, readSettings, saveSettings } from '../settings/store.js';

export function registerSettingsRoutes(app: Router, ctx: Ctx): void {
  app.get(
    '/settings',
    wrap(async (_req, res) => {
      const [canSave, stored] = await Promise.all([
        gitAvailable(ctx.campaignRoot),
        readSettings(ctx),
      ]);
      const body: SettingsResponse = {
        settings: stored.settings,
        defaults: DEFAULT_SETTINGS,
        canSave,
        explicit: stored.explicit,
      };
      res.json(body);
    }),
  );

  app.put(
    '/settings',
    wrap(async (req, res) => {
      const parsed = settingsPatchSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid settings' });
        return;
      }
      const result = await saveSettings(ctx, parsed.data);
      if (!result.ok) {
        if (result.reason === 'no-git') {
          res.status(409).json({
            error: 'This campaign folder has no saved history, so settings cannot be saved.',
          });
        } else {
          res.status(500).json({ error: 'Settings could not be saved.' });
        }
        return;
      }
      ctx.bus.publish('settings', result.settings);
      existingPlayback(ctx)?.applySettings(result.settings.music);
      const body: SettingsResponse = {
        settings: result.settings,
        defaults: DEFAULT_SETTINGS,
        canSave: true,
        explicit: result.explicit,
      };
      res.json(body);
    }),
  );
}
