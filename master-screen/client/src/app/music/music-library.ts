import { Component, DestroyRef, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ExternalLink, LucideAngularModule, Pause, Play, Star } from 'lucide-angular';
import type { MusicTrack } from '@shared/types';
import { StatusService } from '../core/status.service';
import { docUrl } from '../core/doc-nav.service';
import { I18n, type TranslationKey } from '../i18n';
import { MusicApiService, MusicSearch } from './music-api.service';
import { MusicPlayerService } from './music-player.service';

export interface TrackGroup {
  docPath: string;
  docTitle: string;
  tracks: MusicTrack[];
}

/**
 * Groups tracks by the sheet that lists them. Groups are ordered by sheet title; inside a group
 * the preferred tracks come first, and the rest keep the order the server sent.
 */
export function groupTracks(tracks: readonly MusicTrack[]): TrackGroup[] {
  const groups = new Map<string, TrackGroup>();
  for (const track of tracks) {
    let group = groups.get(track.docPath);
    if (!group) {
      group = { docPath: track.docPath, docTitle: track.docTitle, tracks: [] };
      groups.set(track.docPath, group);
    }
    group.tracks.push(track);
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      tracks: [...group.tracks.filter((track) => track.preferred), ...group.tracks.filter((track) => !track.preferred)],
    }))
    .sort((a, b) => a.docTitle.localeCompare(b.docTitle) || a.docPath.localeCompare(b.docPath));
}

/** The music library page (`/music`): search, grouped by sheet, preferred first. */
@Component({
  selector: 'ms-music-library',
  imports: [LucideAngularModule, RouterLink],
  templateUrl: './music-library.html',
  styleUrl: './music-library.css',
})
export class MusicLibrary {
  private readonly api = inject(MusicApiService);
  private readonly status = inject(StatusService);
  private readonly i18n = inject(I18n);
  readonly player = inject(MusicPlayerService);

  readonly icons = { ExternalLink, Pause, Play, Star };
  readonly search = new MusicSearch(this.api);
  readonly groups = computed(() => groupTracks(this.search.tracks()));
  /** The order the tracks are shown in: next and previous follow it. */
  readonly playOrder = computed(() => this.groups().flatMap((group) => group.tracks));
  readonly off = computed(() => {
    const modules = this.status.modules();
    if (modules !== null && modules.music !== true) return true;
    return this.search.status() === 'done' && this.search.enabled() === false;
  });

  constructor() {
    this.search.start();
    inject(DestroyRef).onDestroy(() => this.search.dispose());
  }

  label(key: TranslationKey): string {
    return this.i18n.t(key);
  }

  docLink(path: string): string {
    return docUrl(path);
  }

  isCurrent(track: MusicTrack): boolean {
    return this.player.current()?.id === track.id;
  }

  isBusy(track: MusicTrack): boolean {
    if (!this.isCurrent(track)) return false;
    const state = this.player.state();
    return state === 'playing' || state === 'loading';
  }

  playLabel(track: MusicTrack): string {
    return this.i18n.t(this.isBusy(track) ? 'music.pauseTrack' : 'music.playTrack', { title: track.title });
  }

  /** Current track: play/pause of the player. Any other track starts the list from there. */
  toggleTrack(track: MusicTrack): void {
    if (this.isCurrent(track)) this.player.toggle();
    else this.player.playTrack(track, this.playOrder());
  }

  open(track: MusicTrack): void {
    this.player.openExternal(track);
  }

  onInput(value: string): void {
    this.search.type(value);
  }

  /** Empty-state text: nothing yet, or nothing matches the words typed. */
  emptyKey(): TranslationKey {
    return this.search.text().trim() === '' ? 'music.empty' : 'music.noResults';
  }
}
