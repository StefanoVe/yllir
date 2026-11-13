// Master screen settings: defaults, the one table that maps each camelCase setting to its
// snake_case key in .campaign/master-screen.yaml, the zod schema of a PUT body, and the
// pure merge and sanitise functions. Owner: settings engineer.
import { z } from 'zod';
import type {
  ScreenModel,
  ScreenSettings,
  ScreenSettingsPatch,
} from '../../../shared/src/types.js';

const MODELS: readonly ScreenModel[] = ['haiku', 'sonnet', 'opus'];

export const DEFAULT_SETTINGS: ScreenSettings = {
  live: { model: 'haiku' },
  combat: {
    model: 'haiku',
    showMaps: true,
    panels: { initiative: true, turn: true, chat: false, music: true },
    autoHide: true,
    autoHideSeconds: 4,
  },
  music: { volume: 80, fadeSeconds: 3, loop: true, dock: 'always' },
  ui: {
    density: 'comfortable',
    motion: 'system',
    startPage: 'plot',
    rail: { plot: true, docs: true, music: true, encyclopedia: true, print: true },
  },
};

type Kind =
  | { type: 'bool' }
  | { type: 'int'; min: number; max: number }
  | { type: 'enum'; values: readonly string[] };

/** One setting: its camelCase path (API, types), its snake_case path in the file, and its kind. */
export interface Leaf {
  path: string;
  file: string;
  kind: Kind;
}

const BOOL: Kind = { type: 'bool' };

/** The single mapping table. Order is the order of keys in the file. */
export const LEAVES: readonly Leaf[] = [
  { path: 'live.model', file: 'live.model', kind: { type: 'enum', values: MODELS } },
  { path: 'combat.model', file: 'combat.model', kind: { type: 'enum', values: MODELS } },
  { path: 'combat.showMaps', file: 'combat.show_maps', kind: BOOL },
  { path: 'combat.panels.initiative', file: 'combat.panels.initiative', kind: BOOL },
  { path: 'combat.panels.turn', file: 'combat.panels.turn', kind: BOOL },
  { path: 'combat.panels.chat', file: 'combat.panels.chat', kind: BOOL },
  { path: 'combat.panels.music', file: 'combat.panels.music', kind: BOOL },
  { path: 'combat.autoHide', file: 'combat.auto_hide', kind: BOOL },
  { path: 'combat.autoHideSeconds', file: 'combat.auto_hide_seconds', kind: { type: 'int', min: 2, max: 15 } },
  { path: 'music.volume', file: 'music.volume', kind: { type: 'int', min: 0, max: 100 } },
  { path: 'music.fadeSeconds', file: 'music.fade_seconds', kind: { type: 'int', min: 1, max: 10 } },
  { path: 'music.loop', file: 'music.loop', kind: BOOL },
  { path: 'music.dock', file: 'music.dock', kind: { type: 'enum', values: ['always', 'playing'] } },
  { path: 'ui.density', file: 'ui.density', kind: { type: 'enum', values: ['comfortable', 'compact'] } },
  { path: 'ui.motion', file: 'ui.motion', kind: { type: 'enum', values: ['system', 'reduced'] } },
  { path: 'ui.startPage', file: 'ui.start_page', kind: { type: 'enum', values: ['live', 'plot', 'docs'] } },
  { path: 'ui.rail.plot', file: 'ui.rail.plot', kind: BOOL },
  { path: 'ui.rail.docs', file: 'ui.rail.docs', kind: BOOL },
  { path: 'ui.rail.music', file: 'ui.rail.music', kind: BOOL },
  { path: 'ui.rail.encyclopedia', file: 'ui.rail.encyclopedia', kind: BOOL },
  { path: 'ui.rail.print', file: 'ui.rail.print', kind: BOOL },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getPath(obj: unknown, dotted: string): unknown {
  let cur: unknown = obj;
  for (const key of dotted.split('.')) {
    if (!isRecord(cur)) return undefined;
    cur = cur[key];
  }
  return cur;
}

function setPath(obj: Record<string, unknown>, dotted: string, value: unknown): void {
  const keys = dotted.split('.');
  let cur = obj;
  for (const key of keys.slice(0, -1)) {
    if (!isRecord(cur[key])) cur[key] = {};
    cur = cur[key] as Record<string, unknown>;
  }
  cur[keys[keys.length - 1]] = value;
}

const int = (min: number, max: number) => z.number().int().min(min).max(max);
const model = z.enum(MODELS);
const bool = z.boolean();

/** Body of PUT /api/settings: any subset of the settings, unknown keys rejected. */
export const settingsPatchSchema: z.ZodType<ScreenSettingsPatch> = z
  .object({
    live: z.object({ model: model.optional() }).strict().optional(),
    combat: z
      .object({
        model: model.optional(),
        showMaps: bool.optional(),
        panels: z
          .object({
            initiative: bool.optional(),
            turn: bool.optional(),
            chat: bool.optional(),
            music: bool.optional(),
          })
          .strict()
          .optional(),
        autoHide: bool.optional(),
        autoHideSeconds: int(2, 15).optional(),
      })
      .strict()
      .optional(),
    music: z
      .object({
        volume: int(0, 100).optional(),
        fadeSeconds: int(1, 10).optional(),
        loop: bool.optional(),
        dock: z.enum(['always', 'playing']).optional(),
      })
      .strict()
      .optional(),
    ui: z
      .object({
        density: z.enum(['comfortable', 'compact']).optional(),
        motion: z.enum(['system', 'reduced']).optional(),
        startPage: z.enum(['live', 'plot', 'docs']).optional(),
        rail: z
          .object({
            plot: bool.optional(),
            docs: bool.optional(),
            music: bool.optional(),
            encyclopedia: bool.optional(),
            print: bool.optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

/** Deep merge of a patch over a base. Returns a new object; neither argument is changed. */
export function mergeSettings(base: ScreenSettings, patch: ScreenSettingsPatch): ScreenSettings {
  const out = structuredClone(base) as unknown as Record<string, unknown>;
  for (const leaf of LEAVES) {
    const value = getPath(patch, leaf.path);
    if (value !== undefined) setPath(out, leaf.path, value);
  }
  return out as unknown as ScreenSettings;
}

/** Newer values win; a path the newer patch does not set keeps the base value. */
export function combinePatches(base: ScreenSettingsPatch, next: ScreenSettingsPatch): ScreenSettingsPatch {
  const out: Record<string, unknown> = {};
  for (const leaf of LEAVES) {
    const value = getPath(next, leaf.path) ?? getPath(base, leaf.path);
    if (value !== undefined) setPath(out, leaf.path, value);
  }
  return out as ScreenSettingsPatch;
}

/** Dotted camelCase paths of every leaf a patch sets. */
export function explicitPaths(patch: ScreenSettingsPatch): string[] {
  const paths: string[] = [];
  const walk = (value: unknown, prefix: string): void => {
    if (isRecord(value)) {
      for (const [key, child] of Object.entries(value)) {
        if (child !== undefined) walk(child, prefix === '' ? key : `${prefix}.${key}`);
      }
    } else if (prefix !== '') {
      paths.push(prefix);
    }
  };
  walk(patch, '');
  return paths;
}

/** Accepts one raw YAML value for a setting: a native value or its string form. */
function coerce(raw: unknown, kind: Kind): unknown {
  if (kind.type === 'bool') {
    if (typeof raw === 'boolean') return raw;
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    return undefined;
  }
  if (kind.type === 'int') {
    let n = Number.NaN;
    if (typeof raw === 'number') n = raw;
    else if (typeof raw === 'string' && /^\s*-?\d+\s*$/.test(raw)) n = Number(raw);
    return Number.isInteger(n) && n >= kind.min && n <= kind.max ? n : undefined;
  }
  return typeof raw === 'string' && kind.values.includes(raw) ? raw : undefined;
}

/**
 * Reads the settings a parsed file sets: keeps each known key whose value is valid, drops
 * the rest. Takes the snake_case structure the file has. Never throws.
 */
export function storedPatch(data: unknown): { patch: ScreenSettingsPatch; explicit: string[] } {
  const patch: Record<string, unknown> = {};
  const explicit: string[] = [];
  for (const leaf of LEAVES) {
    const value = coerce(getPath(data, leaf.file), leaf.kind);
    if (value !== undefined) {
      setPath(patch, leaf.path, value);
      explicit.push(leaf.path);
    }
  }
  return { patch: patch as ScreenSettingsPatch, explicit };
}

/** Settings and explicit paths from whatever the YAML parser returned. Never throws. */
export function sanitizeStored(data: unknown): { settings: ScreenSettings; explicit: string[] } {
  const { patch, explicit } = storedPatch(data);
  return { settings: mergeSettings(DEFAULT_SETTINGS, patch), explicit };
}

/** Writes the snake_case tree of the explicit leaves, in LEAVES order. */
export function fileTree(patch: ScreenSettingsPatch): Record<string, unknown> {
  const tree: Record<string, unknown> = {};
  for (const leaf of LEAVES) {
    const value = getPath(patch, leaf.path);
    if (value !== undefined) setPath(tree, leaf.file, value);
  }
  return tree;
}
