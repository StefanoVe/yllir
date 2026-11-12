// The battle screen of the live session: the map and the chips' cells (battle.json next to the
// combat, written atomically), the players' list, the battle maps of the campaign with the sheet
// that embeds them, and the stats tooltip of a combatant (the game system's own summary of the
// public part of its sheet). Owner: cockpit host.
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import type { BattleView, CombatState, CombatantStats, LivePlayer } from '../../../shared/src/types.js';
import { readCampaignConfig } from '../cockpit/campaign-config.js';
import type { BattleMapOption, CockpitBattle, Detail } from '../cockpit/ports.js';
import { campaignLanguage, type Lang } from '../chat/text.js';
import type { Ctx } from '../context.js';
import { loadFrameworkModule } from '../engine.js';
import { writeAtomic } from '../live/board.js';
import { callCombat } from '../live/framework.js';
import { ID_PATTERN, isCampaignRef } from '../live/schemas.js';
import { liveDirOf, readActiveId } from '../live/snapshot.js';
import type { CampaignCategories } from './categories.js';
import { loadCategoryEntries } from './categories.js';
import { listMapAssets } from './maps.js';
import { referencesOf } from './refs.js';

export const MAX_POSITIONS = 300;
const MAP_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const MASTER_BLOCK = /<!--\s*master\s*-->[\s\S]*?<!--\s*\/master\s*-->/g;
const HEAD_BYTES = 8192;
const SKIPPED_DIRS = new Set(['node_modules', 'dist', 'test-results']);
const ADAPTER_ID = /^[a-z0-9-]+$/;
const RULES_FILE = /^[A-Za-z0-9_-]+\.mjs$/;
/** The adapter loader checks setting names against a fixed list that does not know encounter_ops yet. */
const EXPECTED_ADAPTER_ERROR = (error: { code?: string; path?: string }) =>
  error.code === 'unknown-key' && error.path === 'encounter_ops';

/** A refusal of the battle screen with the HTTP status the route answers with. */
export class BattleError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const positionSchema = z.object({
  x: z.number().finite().min(-10000).max(10000),
  y: z.number().finite().min(-10000).max(10000),
});

const mapSchema = z.strictObject({
  ref: z.string().min(1).max(500),
  cols: z.number().int().min(1).max(200).optional(),
  rows: z.number().int().min(1).max(200).optional(),
});

/** PUT body. `positions` is merged into the stored ones (null removes a chip); `map` null clears the map. */
export const battlePatchSchema = z.strictObject({
  positions: z
    .record(z.string().regex(ID_PATTERN, { message: 'bad id' }), positionSchema.nullable())
    .refine((value) => Object.keys(value).length <= MAX_POSITIONS, { message: 'too many positions' })
    .optional(),
  map: mapSchema.nullable().optional(),
});

export type BattlePatch = z.infer<typeof battlePatchSchema>;

const storedSchema = z.object({
  map: z.object({ ref: z.string(), cols: z.number().int().optional(), rows: z.number().int().optional() }).nullable().optional(),
  positions: z.record(z.string(), z.object({ x: z.number(), y: z.number() })),
  revision: z.number().int().min(0),
});

export interface BattleHost extends CockpitBattle {
  /** Player characters of the players' folder: title from the first heading, else the file name. */
  players(): Promise<LivePlayer[]>;
  /** The battle view of the active live session, or null when no session is open. */
  view(): Promise<BattleView | null>;
  /** Merges a PUT body into the battle view of the active session and saves it. */
  put(patch: BattlePatch): Promise<BattleView>;
  /** The tooltip of a combatant of the active combat, or null when there is no such combatant. */
  stats(combatantId: string): Promise<CombatantStats | null>;
}

export interface BattleDeps {
  archive: { readonly docs: Map<string, Detail>; idle(): Promise<void> };
  categories: CampaignCategories;
}

const EMPTY_VIEW: BattleView = { map: null, positions: {}, revision: 0 };

/** Lower-case, no accents: the comparison of place names. */
export function foldText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLocaleLowerCase('it');
}

/** A map reference the battle screen may show: a campaign file with a raster extension. */
async function checkMapRef(root: string, ref: string): Promise<void> {
  const bad = () => new BattleError('The battle map must be an image of the campaign.', 400);
  if (!isCampaignRef(ref) || !MAP_EXTENSIONS.has(path.posix.extname(ref).toLowerCase())) throw bad();
  const stat = await fs.stat(path.join(root, ref)).catch(() => null);
  if (!stat?.isFile()) throw bad();
}

/** The sheet without its master-only block, and without anything after an unclosed opening marker. */
export function publicPartOf(text: string): string {
  let visible = text.replace(MASTER_BLOCK, '');
  const open = visible.search(/<!--\s*master\s*-->/);
  if (open >= 0) visible = visible.slice(0, open);
  return visible.replace(/<!--\s*\/master\s*-->/g, '');
}

/** Reads at most the first bytes of a file and returns its first `# ` heading, or null. */
async function firstHeading(file: string): Promise<string | null> {
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(file, 'r');
    const buffer = Buffer.alloc(HEAD_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, HEAD_BYTES, 0);
    const match = /^# (.+)$/m.exec(buffer.toString('utf8', 0, bytesRead));
    return match ? match[1]!.trim() || null : null;
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

/** Every markdown file under a folder of the campaign, campaign-relative, dot folders and symlinks left out. */
async function markdownUnder(root: string, folder: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (rel: string): Promise<void> => {
    let entries;
    try {
      entries = await fs.readdir(path.join(root, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || SKIPPED_DIRS.has(entry.name) || entry.isSymbolicLink()) continue;
      const child = `${rel}/${entry.name}`;
      if (entry.isDirectory()) await walk(child);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) found.push(child);
    }
  };
  await walk(folder);
  return found.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** Map cells (cols, rows) of the sheets, from the map jobs the images skill saved: the latest job of each sheet. */
async function mapCellsBySheet(root: string): Promise<Map<string, { cols: number; rows: number }>> {
  const out = new Map<string, { cols: number; rows: number }>();
  const dir = path.join(root, '.campaign', 'state', 'maps');
  let jobs: string[];
  try {
    jobs = await fs.readdir(dir);
  } catch {
    return out;
  }
  const seen: Array<{ document: string; cols: number; rows: number; mtime: number }> = [];
  for (const job of jobs) {
    const file = path.join(dir, job, 'job.json');
    try {
      const data = JSON.parse(await fs.readFile(file, 'utf8')) as { document?: unknown; cols?: unknown; rows?: unknown };
      const stat = await fs.stat(file);
      if (typeof data.document === 'string' && Number.isInteger(data.cols) && Number.isInteger(data.rows))
        seen.push({ document: data.document, cols: data.cols as number, rows: data.rows as number, mtime: stat.mtimeMs });
    } catch {
      // A job without a readable job.json has no cells to report.
    }
  }
  seen.sort((a, b) => a.mtime - b.mtime);
  for (const job of seen) out.set(job.document, { cols: job.cols, rows: job.rows });
  return out;
}

/** The game system's rules module and adapter, or nothing when the campaign has none or it cannot be loaded. */
interface Rules {
  adapter?: { creature_sheet?: { required?: Array<{ id?: unknown; label_it?: unknown; label_en?: unknown }> } } & Record<string, unknown>;
  statSummary?: (adapter: unknown, markdown: string) => { lines: CombatantStats['lines']; actions: CombatantStats['actions'] };
}

async function loadRules(ctx: Ctx, root: string): Promise<Rules> {
  const systemId = readCampaignConfig(root).systemName;
  if (!systemId || !ADAPTER_ID.test(systemId)) return {};
  try {
    const lib = await loadFrameworkModule<{
      loadAdapter(pluginRoot: string, id: string): { adapter: Rules['adapter'] | null; errors: Array<{ code?: string; path?: string }> };
    }>(ctx, 'adapter');
    const loaded = lib.loadAdapter(ctx.frameworkRoot, systemId);
    if (!loaded.adapter || loaded.errors.some((error) => !EXPECTED_ADAPTER_ERROR(error))) return {};
    const file = loaded.adapter.encounter_ops;
    if (typeof file !== 'string' || !RULES_FILE.test(file)) return { adapter: loaded.adapter };
    const modulePath = path.join(ctx.frameworkRoot, 'modules', 'systems', systemId, file);
    const rules = (await import(pathToFileURL(modulePath).href)) as Rules;
    return { adapter: loaded.adapter, statSummary: rules.statSummary };
  } catch (error) {
    ctx.log(`battle stats: ${error instanceof Error ? error.message : String(error)}`);
    return {};
  }
}

/** Labels of the tooltip in the campaign language; the game system's own labels for HP and AC. */
function labelsOf(lang: Lang, rules: Rules) {
  const required = rules.adapter?.creature_sheet?.required ?? [];
  const labelOf = (id: string, fallback: string) => {
    const row = required.find((item) => item.id === id);
    const label = lang === 'it' ? row?.label_it : row?.label_en;
    return typeof label === 'string' && label !== '' ? label : fallback;
  };
  return {
    initiative: lang === 'it' ? 'Iniziativa' : 'Initiative',
    hp: labelOf('hp', lang === 'it' ? 'PF' : 'HP'),
    ac: labelOf('ac', lang === 'it' ? 'CA' : 'AC'),
    conditions: lang === 'it' ? 'Condizioni' : 'Conditions',
  };
}

/** The battle screen of one campaign. Reads the framework's combat through the live library, never canon except for the sheets it summarizes. */
export function createBattleHost(ctx: Ctx, deps: BattleDeps): BattleHost {
  const root = ctx.campaignRoot;
  let queue: Promise<unknown> = Promise.resolve();
  const serialize = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.catch(() => undefined).then(task);
    queue = run.catch(() => undefined);
    return run;
  };
  const file = (sessionId: string) => path.join(liveDirOf(root), sessionId, 'battle.json');

  const activeSession = async (): Promise<string | null> => readActiveId(root);

  const readStored = async (sessionId: string): Promise<BattleView> => {
    let raw: string;
    try {
      raw = await fs.readFile(file(sessionId), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ...EMPTY_VIEW, positions: {} };
      ctx.log('battle.json cannot be read; showing an empty battle screen');
      return { ...EMPTY_VIEW, positions: {} };
    }
    let parsed: z.infer<typeof storedSchema>;
    try {
      const checked = storedSchema.safeParse(JSON.parse(raw));
      if (!checked.success) throw new Error('invalid');
      parsed = checked.data;
    } catch {
      ctx.log('battle.json is damaged; showing an empty battle screen');
      return { ...EMPTY_VIEW, positions: {} };
    }
    return {
      map: parsed.map ?? null,
      positions: parsed.positions,
      revision: parsed.revision,
    };
  };

  const loadCategories = async () => {
    deps.categories.load(await loadCategoryEntries(ctx));
  };

  const host: BattleHost = {
    async players() {
      await loadCategories();
      const folder = deps.categories.playersFolder();
      if (!folder) return [];
      const files = await markdownUnder(root, folder);
      const players: LivePlayer[] = [];
      for (const rel of files) {
        if (deps.categories.kindOf(rel) !== 'pc') continue;
        const title = (await firstHeading(path.join(root, rel))) ?? path.posix.basename(rel, '.md');
        players.push({ name: title, ref: rel });
      }
      return players;
    },

    async view() {
      const sessionId = await activeSession();
      if (sessionId === null) return null;
      return serialize(() => readStored(sessionId));
    },

    async put(patch) {
      const sessionId = await activeSession();
      if (sessionId === null) throw new BattleError('No session is open right now. Open one first.', 409);
      const checked = battlePatchSchema.safeParse(patch);
      if (!checked.success) throw new BattleError('Some of the information is not valid. Check it and try again.', 400);
      const body = checked.data;
      if (body.map) await checkMapRef(root, body.map.ref);
      return serialize(async () => {
        const current = await readStored(sessionId);
        const positions: BattleView['positions'] = { ...current.positions };
        for (const [id, value] of Object.entries(body.positions ?? {})) {
          if (value === null) delete positions[id];
          else positions[id] = { x: value.x, y: value.y };
        }
        if (Object.keys(positions).length > MAX_POSITIONS) throw new BattleError('Too many chips on the battle screen.', 400);
        let map: BattleView['map'] = current.map ?? null;
        if (body.map !== undefined) map = body.map === null ? null : { ...body.map };
        const next: BattleView = { map, positions, revision: current.revision + 1 };
        await writeAtomic(file(sessionId), `${JSON.stringify(next, null, 2)}\n`);
        return next;
      });
    },

    async find(place = '') {
      await deps.archive.idle();
      await loadCategories();
      const docs = [...deps.archive.docs.values()];
      const maps = await listMapAssets(root, docs, (rel) => deps.categories.folderOf(rel));
      const references = referencesOf(docs);
      const cells = await mapCellsBySheet(root);
      const wanted = foldText(place.trim());
      const titleOf = new Map(docs.map((doc) => [doc.path, doc.title]));
      const out: BattleMapOption[] = [];
      for (const map of maps) {
        if (map.category !== 'Battlemap') continue;
        const sheet = [...(references.get(map.path)?.docs.keys() ?? [])].sort()[0] ?? '';
        const sheetTitle = sheet ? (titleOf.get(sheet) ?? '') : '';
        if (wanted !== '' && !foldText(`${sheetTitle} ${sheet}`).includes(wanted)) continue;
        const size = sheet ? cells.get(sheet) : undefined;
        out.push({
          ref: map.path,
          url: map.src,
          sheet,
          title: map.title,
          ...(size ? { cols: size.cols, rows: size.rows } : {}),
        });
      }
      return out;
    },

    async setMap(map) {
      return host.put({ map: { ref: map.ref, ...(map.cols !== undefined ? { cols: map.cols } : {}), ...(map.rows !== undefined ? { rows: map.rows } : {}) } });
    },

    async move(id, x, y) {
      return host.put({ positions: { [id]: { x, y } } });
    },

    async stats(combatantId) {
      if (!ID_PATTERN.test(combatantId)) return null;
      const combat = await callCombat(ctx, (lib) => lib.getCombat(root));
      if (!combat.ok || !combat.combat) return null;
      const state = combat.combat as CombatState;
      const who = state.combatants.find((item) => item.id === combatantId);
      if (!who) return null;
      const lang = campaignLanguage(root);
      const lines: CombatantStats['lines'] = [];
      if (who.initiative !== null && who.initiative !== undefined) {
        lines.push({ label: lang === 'it' ? 'Iniziativa' : 'Initiative', value: String(who.initiative) });
      }
      if (who.side === 'pc') return { lines, actions: [] };
      const rules = await loadRules(ctx, root);
      const labels = labelsOf(lang, rules);
      if (who.hp !== undefined) {
        lines.push({ label: labels.hp, value: who.hpMax !== undefined ? `${who.hp}/${who.hpMax}` : String(who.hp) });
      }
      if (who.ac !== undefined) lines.push({ label: labels.ac, value: String(who.ac) });
      if (who.conditions.length > 0) {
        lines.push({ label: labels.conditions, value: who.conditions.map((condition) => condition.id).join(', ') });
      }
      const taken = new Set([labels.hp, labels.ac].map((label) => label.toLocaleLowerCase('it')));
      let sheetLines: CombatantStats['lines'] = [];
      let actions: CombatantStats['actions'] = [];
      if (who.sheet && isCampaignRef(who.sheet) && rules.statSummary) {
        const text = await fs.readFile(path.join(root, who.sheet), 'utf8').catch(() => null);
        if (text !== null) {
          const summary = rules.statSummary(rules.adapter, publicPartOf(text));
          sheetLines = summary.lines.filter((line) => !taken.has(line.label.toLocaleLowerCase('it')));
          actions = summary.actions;
        }
      }
      return { lines: [...lines, ...sheetLines], actions };
    },
  };
  return host;
}

