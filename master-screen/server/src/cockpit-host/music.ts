// The cockpit's music bridge over the master screen's music service. The library is the
// campaign's own music list (music/service.ts); playback runs in the browser (the music dock),
// so the table can only show a track on the screen, never start it. Owner: cockpit host.
import type { MusicTrack as SharedMusicTrack } from '../../../shared/src/types.js';
import type { CockpitMusic, MusicCommand, MusicStateLike, MusicTrack } from '../cockpit/ports.js';
import { readCampaignSummary } from '../campaign.js';
import { campaignLanguage, type Lang } from '../chat/text.js';
import type { Ctx } from '../context.js';
import { queryMusic } from '../music/service.js';

const TEXTS: Record<Lang, { off: string; shown: string; stop: string; unknown: string }> = {
  en: {
    off: 'The music module is off for this campaign.',
    shown: 'The track is shown on the screen. The master starts it from the music dock.',
    stop: 'The table cannot stop the music. Use the music dock on the master screen.',
    unknown: 'That track is not in the music library.',
  },
  it: {
    off: 'Il modulo musica è disattivato per questa campagna.',
    shown: 'Il brano è mostrato sullo schermo. Il master lo avvia dal lettore musicale.',
    stop: 'Dal tavolo non si può fermare la musica. Usa il lettore musicale dello schermo del master.',
    unknown: 'Quel brano non è nella libreria musicale.',
  },
};

/** The part of the archive the music bridge needs: its change notices and a counter. */
export interface MusicArchiveLike {
  generation(): number;
  onChange(listener: () => void): () => void;
}

function toCockpitTrack(track: SharedMusicTrack): MusicTrack {
  const slash = track.docPath.lastIndexOf('/');
  return {
    id: track.id,
    title: track.title,
    scene: track.docTitle,
    path: track.docPath,
    line: 0,
    area: slash < 0 ? '' : track.docPath.slice(0, slash),
    provider: track.provider,
    context: track.mood,
  };
}

export function createCockpitMusic(ctx: Ctx, archive: MusicArchiveLike): CockpitMusic {
  const language = (): Lang => campaignLanguage(ctx.campaignRoot);
  const enabled = async (): Promise<boolean> => (await readCampaignSummary(ctx)).modules.music;

  async function tracks(query?: string): Promise<MusicTrack[]> {
    if (!(await enabled())) return [];
    const result = await queryMusic(ctx, query === undefined ? {} : { query });
    if (result.note !== undefined) throw new Error(result.note);
    return result.enabled ? result.tracks.map(toCockpitTrack) : [];
  }

  return {
    search: (query) => tracks(query),
    library: () => tracks(),
    async request(command: MusicCommand) {
      const text = TEXTS[language()];
      if (!(await enabled())) throw new Error(text.off);
      if (command.command === 'stop') throw new Error(text.stop);
      const result = await queryMusic(ctx, {});
      if (result.note !== undefined) throw new Error(result.note);
      const track = result.tracks.find((item) => item.id === command.trackId);
      if (track === undefined) throw new Error(text.unknown);
      ctx.bus.publish('music', { tracks: [track], reason: text.shown });
      return { shown: true, note: text.shown };
    },
    subscribe(listener: (state: MusicStateLike) => void) {
      const emit = async () => {
        const on = await enabled().catch(() => false);
        listener({ phase: on ? 'ready' : 'off', libraryVersion: archive.generation() });
      };
      void emit();
      return archive.onChange(() => void emit());
    },
  };
}
