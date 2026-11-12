// GET /api/status and POST /api/shutdown. Owner: server skeleton.
import { execFile } from 'node:child_process';
import type { Router } from 'express';
import type { StatusResponse } from '../../../shared/src/types.js';
import { readCampaignSummary, readFrameworkVersion } from '../campaign.js';
import type { Ctx } from '../context.js';
import { wrap } from '../http.js';
import { musicAvailable } from '../music/availability.js';

/** True when the campaign folder is inside a git repository (git rev-parse succeeds). */
function gitOk(campaignRoot: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['-C', campaignRoot, 'rev-parse', '--git-dir'],
      { timeout: 5000, windowsHide: true },
      (err) => resolve(!err),
    );
  });
}

export async function buildStatus(ctx: Ctx): Promise<StatusResponse> {
  const [summary, frameworkVersion, git, music] = await Promise.all([
    readCampaignSummary(ctx),
    readFrameworkVersion(ctx.frameworkRoot),
    gitOk(ctx.campaignRoot),
    musicAvailable(ctx),
  ]);
  return {
    ok: summary.ok,
    campaign: summary.campaign,
    frameworkVersion,
    modules: { ...summary.modules, music },
    agent: ctx.agentStatus(),
    git: { ok: git },
  };
}

export function registerStatusRoutes(app: Router, ctx: Ctx): void {
  app.get(
    '/status',
    wrap(async (_req, res) => {
      res.json(await buildStatus(ctx));
    }),
  );

  app.post('/shutdown', (_req, res) => {
    res.json({ ok: true });
    res.once('finish', () => ctx.requestShutdown());
  });
}
