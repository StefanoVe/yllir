// Campaign categories for the cockpit: maps the folders of the campaign.yaml structure to
// what they hold (plot, session, npc, enemy, item, location, lore, pc). Matched on the
// category id first (Italian and English), then on its type. Unknown is "other".
// Owner: cockpit host.
import type { CockpitCategories, CockpitKind } from '../cockpit/ports.js';
import type { Ctx } from '../context.js';
import { loadFrameworkModule } from '../engine.js';

/** One category of the structure list of campaign.yaml. */
export interface CategoryEntry {
  id: string;
  folder: string;
  type: string;
}

const ID_KINDS: Record<string, CockpitKind> = {
  trama: 'plot',
  plot: 'plot',
  cronaca: 'session',
  chronicle: 'session',
  sessioni: 'session',
  sessions: 'session',
  personaggi: 'npc',
  characters: 'npc',
  npc: 'npc',
  npcs: 'npc',
  creature: 'enemy',
  creatures: 'enemy',
  nemici: 'enemy',
  enemies: 'enemy',
  mostri: 'enemy',
  monsters: 'enemy',
  oggetti: 'item',
  items: 'item',
  objects: 'item',
  luoghi: 'location',
  mondo: 'location',
  world: 'location',
  places: 'location',
  locations: 'location',
  storia: 'lore',
  history: 'lore',
  lore: 'lore',
  giocatori: 'pc',
  players: 'pc',
  pg: 'pc',
  pc: 'pc',
};

const TYPE_KINDS: Record<string, CockpitKind> = {
  plot: 'plot',
  chronicle: 'session',
  places: 'location',
  objects: 'item',
};

const SESSION_EVENT_FOLDERS = new Set(['Eventi', 'Events']);

/** The kind of a category: its id first, then its type. */
export function kindOfCategory(entry: CategoryEntry): CockpitKind {
  return ID_KINDS[entry.id.toLowerCase()] ?? TYPE_KINDS[entry.type] ?? 'other';
}

/** A plot file is a session when it is the main file of its own folder or lies in an Eventi/Events folder. */
export function isSessionFile(insideFolder: string): boolean {
  const segments = insideFolder.split('/');
  if (segments.some((segment) => SESSION_EVENT_FOLDERS.has(segment))) return true;
  return segments.length >= 2 && segments[segments.length - 1] === `${segments[segments.length - 2]}.md`;
}

/** Normalizes a structure list of campaign.yaml: entries with a folder, without "." or trailing slashes. */
export function categoryEntries(structure: unknown[]): CategoryEntry[] {
  const out: CategoryEntry[] = [];
  for (const raw of structure) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const entry = raw as Record<string, unknown>;
    if (typeof entry.folder !== 'string') continue;
    const folder = entry.folder.replace(/\\/g, '/').replace(/\/+$/, '');
    if (folder === '' || folder === '.') continue;
    out.push({
      id: typeof entry.id === 'string' ? entry.id : '',
      folder,
      type: typeof entry.type === 'string' ? entry.type : '',
    });
  }
  return out;
}

/** The structure of the campaign, read through the framework's subjects module. Empty when unreadable. */
export async function loadCategoryEntries(ctx: Ctx): Promise<CategoryEntry[]> {
  try {
    const subjects = await loadFrameworkModule<{
      readStructure(root: string): { structure: unknown[] | null };
    }>(ctx, 'subjects');
    const { structure } = subjects.readStructure(ctx.campaignRoot);
    return structure ? categoryEntries(structure) : [];
  } catch (error) {
    ctx.log(`cockpit categories: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

/** The category table of the campaign. Loaded by the archive on every refresh; before that every path is "other". */
export class CampaignCategories implements CockpitCategories {
  private entries: CategoryEntry[] = [];

  load(entries: CategoryEntry[]): void {
    this.entries = entries.slice();
  }

  /** The category whose folder is the longest prefix of the path. */
  entryFor(relPath: string): CategoryEntry | undefined {
    let best: CategoryEntry | undefined;
    for (const entry of this.entries) {
      if (!relPath.startsWith(`${entry.folder}/`)) continue;
      if (best === undefined || entry.folder.length > best.folder.length) best = entry;
    }
    return best;
  }

  /** The folder of the category that contains the path, if any. */
  folderOf(relPath: string): string | undefined {
    return this.entryFor(relPath)?.folder;
  }

  kindOf(relPath: string): CockpitKind {
    const entry = this.entryFor(relPath);
    if (entry === undefined) return 'other';
    const kind = kindOfCategory(entry);
    if (kind === 'plot' && isSessionFile(relPath.slice(entry.folder.length + 1))) return 'session';
    return kind;
  }

  folderFor(kind: 'npc' | 'enemy' | 'item' | 'location'): string | null {
    return this.entries.find((entry) => kindOfCategory(entry) === kind)?.folder ?? null;
  }

  playersFolder(): string | null {
    return this.entries.find((entry) => kindOfCategory(entry) === 'pc')?.folder ?? null;
  }
}
