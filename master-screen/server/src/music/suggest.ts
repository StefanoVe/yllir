// The agent tool suggest_music: resolves a query or a sheet to at most five tracks and SHOWS
// them on the screen (bus event `music`). It never plays anything and never writes a file;
// the model gets titles only, never the master text of a sheet. Owner: music engineer.
import type { Ctx } from '../context.js';
import { queryMusic } from './service.js';

export interface SuggestInput {
  query?: string;
  /** Generic vibe words (mood, genre, setting). Searched together with query, as one OR query. */
  keywords?: string[];
  doc?: string;
  reason?: string;
}

export interface SuggestOutput {
  text: string;
  isError?: boolean;
}

const MAX_SUGGESTIONS = 5;
const MAX_KEYWORDS = 8;
const OFF_TEXT = 'The music module is off for this campaign, so no music can be suggested.';

export async function suggestMusic(ctx: Ctx, input: SuggestInput): Promise<SuggestOutput> {
  const keywords = (input.keywords ?? []).map((word) => word.trim()).filter((word) => word !== '').slice(0, MAX_KEYWORDS);
  const doc = input.doc?.trim() ?? '';
  // The query and the keywords are one OR query: any of their words may match.
  const query = [input.query?.trim() ?? '', ...keywords].filter((part) => part !== '').join(' ');
  if (query === '' && doc === '') {
    return { text: 'Give generic keywords, a query, a document path or both to look for music.', isError: true };
  }
  const result = await queryMusic(ctx, {
    query: query === '' ? undefined : query,
    doc: doc === '' ? undefined : doc,
    limit: MAX_SUGGESTIONS,
  });
  if (!result.enabled) return { text: result.note ?? OFF_TEXT };
  if (result.tracks.length === 0) {
    return {
      text: 'No music matches that. Nothing was shown on the screen. Retry with more generic words (mood, genre, setting), not names.',
    };
  }

  const reason = input.reason?.trim();
  ctx.bus.publish('music', {
    tracks: result.tracks,
    ...(reason ? { reason } : {}),
  });
  const titles = result.tracks.map((track) => track.title).join('; ');
  return {
    text: `Showed ${result.tracks.length} suggested track(s) on the screen: ${titles}. Nothing plays until the master chooses one.`,
  };
}
