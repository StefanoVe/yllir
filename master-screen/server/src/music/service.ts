// The one entry point of the music list for the HTTP route and the agent tool: checks the
// module flag, reads the library and searches it. Never throws. Owner: music engineer.
import type { MusicTrack } from '../../../shared/src/types.js';
import type { Ctx } from '../context.js';
import { loadFrameworkModule } from '../engine.js';
import { musicAvailable } from './availability.js';
import { loadMusicLibrary } from './library.js';
import { searchTracks, type FoldModule } from './search.js';

export interface MusicQueryInput {
  query?: string;
  doc?: string;
  limit?: number;
}

export interface MusicQueryResult {
  enabled: boolean;
  tracks: MusicTrack[];
  /** Plain-language reason when the list cannot be shown. */
  note?: string;
}

const FAILED_NOTE = 'The music list could not be read. Try again.';

export async function queryMusic(ctx: Ctx, input: MusicQueryInput): Promise<MusicQueryResult> {
  try {
    if (!(await musicAvailable(ctx))) return { enabled: false, tracks: [] };
    const library = await loadMusicLibrary(ctx);
    if (!library.ok) return { enabled: false, tracks: [], note: library.note };
    const fold = await loadFrameworkModule<FoldModule>(ctx, 'fold');
    const tracks = searchTracks(library.tracks, { ...input, fold });
    return { enabled: true, tracks };
  } catch (err) {
    ctx.log(`music list failed: ${err instanceof Error ? err.message : String(err)}`);
    return { enabled: false, tracks: [], note: FAILED_NOTE };
  }
}
