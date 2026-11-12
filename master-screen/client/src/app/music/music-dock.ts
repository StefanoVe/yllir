import { Component, ElementRef, HostListener, ViewChild, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideAngularModule, ListMusic, Music, Pause, Play, Repeat, SkipBack, SkipForward, Sunset, ExternalLink, Volume2, VolumeX, X } from 'lucide-angular';
import type { MusicTrack } from '@shared/types';
import { docUrl } from '../core/doc-nav.service';
import { StatusService } from '../core/status.service';
import { I18n, type TranslationKey } from '../i18n';
import { MusicApiService } from './music-api.service';
import { MusicPlayerService, type MusicPlayerState } from './music-player.service';

export type BrowseStatus = 'idle' | 'loading' | 'done' | 'error';

/** One sheet of the browse list: its tracks, in the order the server gave them. */
export interface BrowseGroup {
  docTitle: string;
  tracks: MusicTrack[];
}

/** Lower case, accents removed: the form the browse filter compares in. */
function foldForFilter(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * The bottom bar of the app, shown whenever music is on for the campaign: the current track
 * (or "nothing playing"), a "Tracks" button that opens the campaign's tracks above the bar, and
 * the suggestion tray the assistant showed. Rendered once by the shell, so it survives route
 * changes. The shell gives the bar its own row, so it never covers the page.
 */
@Component({
  selector: 'ms-music-dock',
  imports: [LucideAngularModule, RouterLink],
  templateUrl: './music-dock.html',
  styleUrl: './music-dock.css',
})
export class MusicDock {
  readonly player = inject(MusicPlayerService);
  readonly api = inject(MusicApiService);
  private readonly i18n = inject(I18n);
  private readonly status = inject(StatusService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  @ViewChild('browseButton') private browseButton?: ElementRef<HTMLButtonElement>;
  @ViewChild('searchInput') private searchInput?: ElementRef<HTMLInputElement>;

  readonly icons = { ListMusic, Music, Pause, Play, Repeat, SkipBack, SkipForward, Sunset, ExternalLink, Volume2, VolumeX, X };
  /** The bar is shown for as long as music is on for the campaign. */
  readonly visible = computed(() => this.status.modules()?.music === true);

  readonly browseOpen = signal(false);
  readonly browseQuery = signal('');
  readonly browseTracks = signal<MusicTrack[]>([]);
  readonly browseStatus = signal<BrowseStatus>('idle');
  readonly browseError = signal<string | null>(null);

  /** The browse list after the client-side filter, grouped by sheet. */
  readonly browseGroups = computed<BrowseGroup[]>(() => {
    const terms = foldForFilter(this.browseQuery()).split(/\s+/).filter((term) => term !== '');
    const groups = new Map<string, MusicTrack[]>();
    for (const track of this.browseTracks()) {
      const haystack = foldForFilter(`${track.title} ${track.mood} ${track.docTitle}`);
      if (!terms.every((term) => haystack.includes(term))) continue;
      const list = groups.get(track.docTitle) ?? [];
      list.push(track);
      groups.set(track.docTitle, list);
    }
    return [...groups].map(([docTitle, tracks]) => ({ docTitle, tracks }));
  });

  label(key: TranslationKey): string {
    return this.i18n.t(key);
  }

  playLabel(track: MusicTrack): string {
    return this.i18n.t(track.provider === 'external' ? 'music.open' : 'music.playTrack', { title: track.title });
  }

  docLink(path: string): string {
    return docUrl(path);
  }

  /** A suggestion chip is an explicit request: it plays (or opens an external link). */
  playSuggestion(track: MusicTrack): void {
    this.player.playTrack(track);
  }

  /** A row of the browse list plays that track; the whole campaign list is the play queue. */
  playFromBrowse(track: MusicTrack): void {
    this.player.playTrack(track, this.browseTracks());
  }

  toggleBrowse(): void {
    if (this.browseOpen()) {
      this.closeBrowse(true);
      return;
    }
    this.browseOpen.set(true);
    this.browseQuery.set('');
    void this.loadBrowse();
    setTimeout(() => this.searchInput?.nativeElement.focus());
  }

  closeBrowse(restoreFocus: boolean): void {
    if (!this.browseOpen()) return;
    this.browseOpen.set(false);
    if (restoreFocus) this.browseButton?.nativeElement.focus();
  }

  onSearch(event: Event): void {
    this.browseQuery.set((event.target as HTMLInputElement).value);
  }

  /** Escape closes the browse list. */
  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.closeBrowse(true);
  }

  /** A click outside the browse list and its button closes it. */
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: Event): void {
    if (!this.browseOpen()) return;
    const inside = event.target instanceof Node && this.host.nativeElement.querySelector('.browse-wrap')?.contains(event.target);
    if (!inside) this.closeBrowse(false);
  }

  onVolume(event: Event): void {
    this.player.setVolume(Number((event.target as HTMLInputElement).value));
  }

  /** Plain-language state line shown under the track title. */
  stateText(): string {
    return this.i18n.t(STATE_KEYS[this.player.state()]);
  }

  /** Pause while playing or loading, play otherwise. */
  isBusy(): boolean {
    const state = this.player.state();
    return state === 'playing' || state === 'loading';
  }

  playPauseLabel(): string {
    return this.i18n.t(this.isBusy() ? 'music.pause' : 'music.play');
  }

  volumeIcon(): typeof VolumeX {
    return this.player.volume() === 0 ? VolumeX : Volume2;
  }

  volumeLabel(): string {
    return this.i18n.t('music.volumeValue', { value: this.player.volume() });
  }

  private async loadBrowse(): Promise<void> {
    this.browseStatus.set('loading');
    this.browseError.set(null);
    try {
      const res = await this.api.tracks('');
      this.browseTracks.set(res.tracks);
      this.browseStatus.set('done');
    } catch (failure) {
      this.browseTracks.set([]);
      this.browseError.set(failure instanceof Error ? failure.message : null);
      this.browseStatus.set('error');
    }
  }
}

const STATE_KEYS: Record<MusicPlayerState, TranslationKey> = {
  idle: 'music.state.idle',
  loading: 'music.state.loading',
  playing: 'music.state.playing',
  paused: 'music.state.paused',
  error: 'music.state.error',
};
