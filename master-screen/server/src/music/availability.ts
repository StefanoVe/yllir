// Whether the music feature is on for a campaign: on when campaign.yaml sets modules.music, or
// when any campaign document holds a soundtrack link in its master-only block. The result is
// remembered per campaign root, so the synchronous Content-Security-Policy can read it.
// Owner: music engineer.
import { readCampaignSummary } from '../campaign.js';
import type { Ctx } from '../context.js';
import { loadMusicLibrary } from './library.js';
import { musicEnabledAtStartup } from './config.js';

const lastComputed = new Map<string, boolean>();

/**
 * True when the module flag is on, or when the library has at least one track. Never throws:
 * any failure answers false. Each call refreshes the value remembered for the campaign.
 */
export async function musicAvailable(ctx: Ctx): Promise<boolean> {
  let available = false;
  try {
    const summary = await readCampaignSummary(ctx);
    if (summary.modules.music) {
      available = true;
    } else {
      const library = await loadMusicLibrary(ctx);
      available = library.ok && library.tracks.length > 0;
    }
  } catch {
    available = false;
  }
  lastComputed.set(ctx.campaignRoot, available);
  return available;
}

/**
 * The last value computed by musicAvailable for this campaign. Before the first computation it
 * is the module flag read from campaign.yaml at startup.
 */
export function musicAvailableCached(campaignRoot: string): boolean {
  const known = lastComputed.get(campaignRoot);
  return known !== undefined ? known : musicEnabledAtStartup(campaignRoot);
}
