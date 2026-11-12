// Loads the framework parser of the music list (music-search/scripts/lib/links.mjs) at run
// time, by dynamic import. A framework without that file is an old framework: the music
// module then reports itself off with a plain note and never throws. Owner: music engineer.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export interface MusicItem {
  title: string;
  url: string;
  mood: string;
}

export interface LinksModule {
  readMusicItems(text: string): { items: MusicItem[]; skipped: number };
}

export type LinksLoad = { ok: true; links: LinksModule } | { ok: false; note: string };

export const OLD_FRAMEWORK_NOTE = 'The music list needs a newer Yllir. Update Yllir, then try again.';
const LOAD_FAILED_NOTE = 'The music list could not be loaded. Update Yllir, then try again.';

const loading = new Map<string, Promise<LinksModule>>();

export function linksFile(frameworkRoot: string): string {
  return path.join(frameworkRoot, 'skills', 'library', 'music-search', 'scripts', 'lib', 'links.mjs');
}

/** The framework parser of the music list, or a plain note when it cannot be used. Never throws. */
export async function loadLinksModule(frameworkRoot: string): Promise<LinksLoad> {
  const file = linksFile(frameworkRoot);
  if (!fs.existsSync(file)) return { ok: false, note: OLD_FRAMEWORK_NOTE };
  try {
    let pending = loading.get(file);
    if (pending === undefined) {
      pending = import(pathToFileURL(file).href) as Promise<LinksModule>;
      loading.set(file, pending);
      pending.catch(() => loading.delete(file));
    }
    const links = await pending;
    if (typeof links?.readMusicItems !== 'function') return { ok: false, note: OLD_FRAMEWORK_NOTE };
    return { ok: true, links };
  } catch {
    return { ok: false, note: LOAD_FAILED_NOTE };
  }
}
