import { Component, DestroyRef, ElementRef, HostListener, ViewChild, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  ExternalLink,
  ListMusic,
  LucideAngularModule,
  Music,
  Pause,
  Play,
  Repeat,
  RotateCw,
  SkipBack,
  SkipForward,
  Square,
  Sunset,
  Volume2,
  VolumeX,
  X,
} from 'lucide-angular';
import type { MusicTrack } from '@shared/types';
import { docUrl } from '../core/doc-nav.service';
import { TooltipDirective } from '../core/tooltip.directive';
import { StatusService } from '../core/status.service';
import { I18n, type TranslationKey } from '../i18n';
import { MusicApiService, MusicSearch } from './music-api.service';
import { groupTracks, type TrackGroup } from './music-groups';
import { formatClock } from './music-highlight';
import { MusicPlayerService, type MusicUiState } from './music-player.service';
import { MusicResult } from './music-result';
import { MusicArt } from './music-art';
import { MusicSlider } from './music-slider';

/**
 * The bottom bar of the app, shown whenever music is on for the campaign. Three zones: the track
 * (title, sheet and state, or the idle and error lines), the transport (previous, play, next, loop,
 * fade-out and a seek bar under them) and the side (volume, stop and the Tracks popover). The
 * suggestion tray the assistant showed opens above it. Rendered once by the shell, so it survives
 * route changes, and it shows only what the server reports (see MusicPlayerService).
 */
@Component({
  selector: 'ms-music-dock',
  imports: [LucideAngularModule, RouterLink, MusicResult, MusicArt, MusicSlider, TooltipDirective],
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

  readonly icons = {
    ExternalLink,
    ListMusic,
    Music,
    Pause,
    Play,
    Repeat,
    RotateCw,
    Square,
    SkipBack,
    SkipForward,
    Sunset,
    Volume2,
    VolumeX,
    X,
  };
  /** The bar is shown for as long as music is on for the campaign. */
  readonly visible = computed(() => this.status.modules()?.music === true);

  /** Phone only: the volume slider opens from the mute button. */
  readonly volumeOpen = signal(false);

  readonly browseOpen = signal(false);
  /** The popover's search: the server ranks, the client only shows what it sent. */
  readonly browse = new MusicSearch(this.api);
  /** A typed query: the server ranking, flat. */
  readonly browseFlat = computed(() => this.browse.text().trim() !== '');
  /** The empty query: grouped by sheet. */
  readonly browseGroups = computed<TrackGroup<MusicTrack>[]>(() => (this.browseFlat() ? [] : groupTracks(this.browse.tracks())));
  /** The order the popover shows its rows in: a play from it queues them in this order. */
  readonly browseResults = computed<MusicTrack[]>(() =>
    this.browseFlat() ? this.browse.tracks() : this.browseGroups().flatMap((group) => group.tracks),
  );

  /** Error text for the bar: the server's phase error, or the last failed command. Null when fine. */
  readonly errorText = computed<string | null>(() => {
    const error = this.player.error();
    if (error !== null) return this.label(error === 'unavailable' ? 'music.error.unavailable' : 'music.error.failed');
    const failure = this.player.failure();
    return failure ?? null;
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => this.browse.dispose());
  }

  label(key: TranslationKey): string {
    return this.i18n.t(key);
  }

  docLink(path: string): string {
    return docUrl(path);
  }

  /** The track the bar shows: its title, or a plain note when the app has not seen the track. */
  titleOf(track: MusicTrack): string {
    return track.title || this.i18n.t('music.unknownTrack');
  }

  /** Label of a tray card's play button. */
  playLabel(track: MusicTrack): string {
    return this.i18n.t(track.provider === 'external' ? 'music.open' : 'music.playTrack', { title: this.titleOf(track) });
  }

  /** The title the error line shows: the track's, or the plain error name when nothing is loaded. */
  currentTitle(): string {
    const track = this.player.current();
    return track ? this.titleOf(track) : this.label('music.state.error');
  }

  /** A suggestion row: the assistant's reason stands where the snippet of a search result stands. */
  suggestionTrack(track: MusicTrack, reason?: string): MusicTrack {
    return reason ? { ...track, snippet: reason, matches: [] } : track;
  }

  /** A suggestion is an explicit request: it plays (or opens an external link). */
  playSuggestion(track: MusicTrack): void {
    this.player.playTrack(track);
  }

  isCurrent(track: MusicTrack): boolean {
    return this.player.current()?.id === track.id;
  }

  isBusy(track: MusicTrack): boolean {
    if (!this.isCurrent(track)) return false;
    const state = this.player.state();
    return state === 'playing' || state === 'loading';
  }

  isPlaying(track: MusicTrack): boolean {
    return this.isCurrent(track) && this.player.state() === 'playing';
  }

  /** A row of the popover: the loaded track toggles pause, any other starts with the popover's list as the queue. */
  toggleFromBrowse(track: MusicTrack): void {
    if (this.isCurrent(track)) this.player.toggle();
    else this.player.playTrack(track, this.browseResults());
  }

  toggleBrowse(): void {
    if (this.browseOpen()) {
      this.closeBrowse(true);
      return;
    }
    this.browseOpen.set(true);
    this.browse.type('');
    setTimeout(() => this.searchInput?.nativeElement.focus());
  }

  closeBrowse(restoreFocus: boolean): void {
    if (!this.browseOpen()) return;
    this.browseOpen.set(false);
    if (restoreFocus) this.browseButton?.nativeElement.focus();
  }

  onSearch(event: Event): void {
    this.browse.type((event.target as HTMLInputElement).value);
  }

  /** Escape closes the popover, or the phone volume panel. */
  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.volumeOpen.set(false);
    this.closeBrowse(true);
  }

  /** A click outside the popover and its button closes it. */
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: Event): void {
    if (!event.target || !(event.target instanceof Node)) return;
    if (this.browseOpen()) {
      const inside = this.host.nativeElement.querySelector('.browse-wrap')?.contains(event.target);
      if (!inside) this.closeBrowse(false);
    }
    if (this.volumeOpen()) {
      const inside = this.host.nativeElement.querySelector('.volume')?.contains(event.target);
      if (!inside) this.volumeOpen.set(false);
    }
  }

  onVolume(value: number): void {
    this.player.setVolume(value);
  }

  /** The seek line: each move jumps the track to that second. */
  onSeek(value: number): void {
    this.player.seek(value);
  }

  seekMax(): number {
    return Math.max(0, this.player.duration());
  }

  clock(seconds: number): string {
    return formatClock(seconds);
  }

  seekValueText(): string {
    return this.i18n.t('music.seekValue', { position: formatClock(this.player.position()), duration: formatClock(this.player.duration()) });
  }

  /** Plain-language state line shown under the track title. */
  stateText(): string {
    return this.i18n.t(STATE_KEYS[this.player.state()]);
  }

  /** Transport works only when playback is available and a track is loaded. */
  canPlay(): boolean {
    return this.player.available() && this.player.current() !== null;
  }

  /** Pause while playing or loading, play otherwise. */
  isBusyNow(): boolean {
    const state: MusicUiState = this.player.state();
    return state === 'playing' || state === 'loading';
  }

  playPauseLabel(): string {
    return this.i18n.t(this.isBusyNow() ? 'music.pause' : 'music.play');
  }

  volumeIcon(): typeof VolumeX {
    return this.player.volume() === 0 ? VolumeX : Volume2;
  }

  volumeLabel(): string {
    return this.i18n.t('music.volumeValue', { value: this.player.volume() });
  }

  toggleVolumePanel(): void {
    this.volumeOpen.update((open) => !open);
  }
}

const STATE_KEYS: Record<MusicUiState, TranslationKey> = {
  idle: 'music.state.idle',
  loading: 'music.state.loading',
  playing: 'music.state.playing',
  paused: 'music.state.paused',
  error: 'music.state.error',
};
