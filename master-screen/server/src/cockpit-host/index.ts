// The host side of the cockpit ports: the campaign archive, maps, images, plot graph, music,
// categories and the battle screen, all read from the master screen's own modules. Owner: cockpit host.
import type { CockpitPorts, Detail, ImageAsset, MapAsset, PlotGraph } from '../cockpit/ports.js';
import type { Ctx } from '../context.js';
import { createArchive, type HostArchive } from './archive.js';
import { CampaignCategories } from './categories.js';
import { createBattleHost, type BattleHost } from './battle.js';
import { createCockpitMusic } from './music.js';
import { createPlotGraphSource } from './plot.js';
import { listImageAssets } from './images.js';
import { listMapAssets } from './maps.js';

/** The cockpit ports, with the host archive (refresh, idle, change notices), the categories and the battle screen. */
export type HostPorts = Omit<CockpitPorts, 'archive' | 'battle'> & {
  archive: HostArchive;
  categories: CampaignCategories;
  battle: BattleHost;
};

export function createHostPorts(ctx: Ctx): HostPorts {
  const categories = new CampaignCategories();
  const plot = createPlotGraphSource(ctx);
  const archive = createArchive(ctx, categories, () => plot.load());
  const folderOf = (rel: string) => categories.folderOf(rel);
  ctx.onClose(() => archive.close());
  return {
    archive,
    music: createCockpitMusic(ctx, archive),
    listMaps: (documents: Iterable<Detail>): Promise<MapAsset[]> =>
      listMapAssets(ctx.campaignRoot, documents, folderOf),
    listImages: (documents: Iterable<Detail>, maps: MapAsset[]): Promise<ImageAsset[]> =>
      listImageAssets(ctx.campaignRoot, documents, maps, folderOf),
    buildPlotGraph: (): PlotGraph => plot.build(),
    categories,
    battle: createBattleHost(ctx, { archive, categories }),
  };
}
