// Creates the cockpit of one campaign: sessions under .campaign/state/live/cockpit, the
// Claude provider, the framework (log, combat, engine, review) and the host ports (cockpit-host)
// over the server's own modules. The battle screen is returned for the battle routes.
import path from "node:path";
import type { Ctx } from "../context.js";
import { createCockpit, type Cockpit } from "./index.js";
import { ClaudeProvider } from "./providers/claude.js";
import { createCampaignFramework } from "./framework.js";
import { createHostPorts } from "../cockpit-host/index.js";
import type { BattleHost } from "../cockpit-host/battle.js";

export interface CampaignCockpit {
  cockpit: Cockpit;
  battle: BattleHost;
}

export function createCampaignCockpit(ctx: Ctx): CampaignCockpit {
  const ports = createHostPorts(ctx);
  const cockpit = createCockpit({
    root: ctx.campaignRoot,
    sessionsRoot: path.join(ctx.campaignRoot, ".campaign", "state", "live", "cockpit"),
    port: ctx.port,
    provider: new ClaudeProvider({ cacheDir: ctx.state.dir }),
    ports,
    framework: createCampaignFramework(ctx),
  });
  return { cockpit, battle: ports.battle };
}
