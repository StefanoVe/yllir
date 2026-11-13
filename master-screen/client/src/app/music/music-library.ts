import {
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  Injector,
  ViewChild,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { Copy, LucideAngularModule, Music, Pause, Play, RotateCw, Search, SkipBack, SkipForward } from 'lucide-angular';
import type { MusicTrack } from '@shared/types';
import { StatusService } from '../core/status.service';
import { docUrl } from '../core/doc-nav.service';
import { I18n, type TranslationKey } from '../i18n';
import { MusicApiService, MusicSearch } from './music-api.service';
import { groupTracks, type TrackGroup } from './music-groups';
import { MusicPlayerService, isInAppTrack } from './music-player.service';
import { MusicResult } from './music-result';
import { MusicArt, artUrl } from './music-art';
import { snippetParts } from './music-highlight';
import { VIBES, hasTerm, toggleTerm, type Vibe } from './music-vibes';

/** A track that the player can start in the app. External links open in a new tab. */
export function isPlayable(track: MusicTrack): boolean {
  return isInAppTrack(track);
}

/** Text entry: keys typed here belong to the element, never to the page shortcuts. */
function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement) {
    return !['checkbox', 'radio', 'range', 'button', 'submit', 'reset'].includes(target.type);
  }
  return false;
}

/** Buttons, links and form controls already act on Space and Enter, so the page leaves those keys alone. */
function isActivatable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.closest('button, a[href], input, select, textarea') !== null;
}

/** The command the phone and desktop share for the unavailable panel. */
export const INSTALL_COMMAND = 'brew install mpv yt-dlp deno';

/**
 * The music page (`/music`), the scene player: the search is the centre of the page, the atmosphere
 * chips fill it, and the results come below. A typed query shows the server ranking as one flat
 * list; the empty query shows the tracks grouped by sheet with a count. The now-playing bar is the
 * shell's dock.
 */
@Component({
  selector: 'ms-music-library',
  imports: [LucideAngularModule, RouterLink, MusicResult, MusicArt],
  templateUrl: './music-library.html',
  styleUrl: './music-library.css',
})
export class MusicLibrary {
  private readonly api = inject(MusicApiService);
  private readonly status = inject(StatusService);
  private readonly i18n = inject(I18n);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly player = inject(MusicPlayerService);

  @ViewChild('searchInput') private searchInput?: ElementRef<HTMLInputElement>;

  readonly icons = { Copy, Music, Pause, Play, RotateCw, Search, SkipBack, SkipForward };
  readonly vibes: readonly Vibe[] = VIBES;
  readonly installCommand = INSTALL_COMMAND;
  readonly search = new MusicSearch(this.api);
  /** Set for a moment after the command was copied. */
  readonly copied = signal(false);
  /** A typed query: the server ranking, flat. */
  readonly flat = computed(() => this.search.text().trim() !== '');
  /** The empty query: grouped by sheet. */
  readonly groups = computed<TrackGroup<MusicTrack>[]>(() => (this.flat() ? [] : groupTracks(this.search.tracks())));
  /** Every visible result in on-screen order. Selection, digits, Enter and next/previous all follow it. */
  readonly results = computed<MusicTrack[]>(() => (this.flat() ? this.search.tracks() : this.groups().flatMap((group) => group.tracks)));
  /** Position of each result in `results`, for the digit labels. */
  private readonly indexById = computed(() => new Map(this.results().map((track, index) => [track.id, index])));
  readonly selectedIndex = signal(0);
  readonly selected = computed<MusicTrack | null>(() => this.results()[this.selectedIndex()] ?? null);
  /** The campaign has no music module: the page only says so. */
  readonly off = computed(() => {
    const modules = this.status.modules();
    if (modules !== null && modules.music !== true) return true;
    return this.search.status() === 'done' && this.search.enabled() === false;
  });

  constructor() {
    this.search.start();
    inject(DestroyRef).onDestroy(() => this.search.dispose());
    // Every new result list starts with its first playable row selected.
    effect(() => {
      const list = this.results();
      untracked(() => this.selectedIndex.set(Math.max(0, list.findIndex(isPlayable))));
    });
  }

  label(key: TranslationKey): string {
    return this.i18n.t(key);
  }

  docLink(path: string): string {
    return docUrl(path);
  }

  countText(): string {
    return this.i18n.t('music.results.count', { count: this.results().length });
  }

  groupCountText(count: number): string {
    return count === 1 ? this.i18n.t('music.group.one') : this.i18n.t('music.group.other', { count });
  }

  /** Plain-language reason the playback tools are missing, or the generic line. */
  unavailableReasonText(): string {
    switch (this.player.unavailableReason()) {
      case 'mpv-missing':
        return this.i18n.t('music.unavailable.mpv');
      case 'ytdlp-missing':
        return this.i18n.t('music.unavailable.ytdlp');
      default:
        return this.i18n.t('music.unavailable.generic');
    }
  }

  vibeLabel(vibe: Vibe): string {
    return this.i18n.t(`music.vibe.${vibe}` as TranslationKey);
  }

  /** A chip is on when its word is in the query. */
  vibeOn(vibe: Vibe): boolean {
    return hasTerm(this.search.text(), this.vibeLabel(vibe));
  }

  /** A chip fills the query with its word, or takes the word out again. The search runs at once. */
  toggleVibe(vibe: Vibe): void {
    this.search.type(toggleTerm(this.search.text(), this.vibeLabel(vibe)));
    this.searchInput?.nativeElement.focus();
  }

  async copyCommand(): Promise<void> {
    try {
      await navigator.clipboard.writeText(INSTALL_COMMAND);
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 1500);
    } catch {
      // The command is on screen to be selected by hand.
    }
  }

  /** The track of the now-playing card: the one in the player, or null. */
  /** Play or pause label for the card's big button. */
  playPauseLabel(): string {
    return this.i18n.t(this.isBusyNow() ? 'music.pause' : 'music.play');
  }

  /** The card shows pause while the track plays or loads. */
  isBusyNow(): boolean {
    const state = this.player.state();
    return state === 'playing' || state === 'loading';
  }

  readonly card = computed<MusicTrack | null>(() => this.player.current());
  /** Card title: the track's, or the plain prompt when nothing is loaded. */
  cardTitle(): string {
    const track = this.card();
    return track && track.title ? track.title : this.i18n.t('music.card.empty');
  }
  /** The blurred backdrop of the card: the artwork, or nothing (the card keeps its own tone). */
  backdrop(): string | null {
    const url = artUrl(this.card());
    return url ? `url("${url}")` : null;
  }
  /** The matched sentence of the card's track, split for highlighting. */
  cardWhy(): { text: string; hit: boolean }[] {
    const track = this.card();
    return track?.snippet ? snippetParts(track.snippet, track.matches ?? []) : [];
  }
  /** Results are dimmed while a new search runs and old results are still shown. */
  isStale(): boolean {
    return this.search.status() === 'loading' && this.results().length > 0;
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

  isSelected(track: MusicTrack): boolean {
    return this.selected()?.id === track.id;
  }

  /** 1-based position of a result in the list (the number in the lead column). */
  indexOf(track: MusicTrack): number | null {
    const index = this.indexById().get(track.id);
    return index === undefined ? null : index + 1;
  }

  /** Play or pause from the card: the same action as the bar's button. */
  togglePlay(): void {
    this.player.toggle();
  }

  /** The play button: pause the loaded track, or start this one with the list as the queue. External tracks open. */
  toggleTrack(track: MusicTrack): void {
    if (this.isCurrent(track)) this.player.toggle();
    else this.player.playTrack(track, this.results());
  }

  /** Enter and digits: start the track, or resume it when it is loaded and paused. Never pauses. */
  playNow(track: MusicTrack): void {
    this.selectedIndex.set(Math.max(0, this.results().findIndex((item) => item.id === track.id)));
    if (this.isCurrent(track)) {
      if (!this.isBusy(track)) this.player.toggle();
      return;
    }
    this.player.playTrack(track, this.results());
  }

  onInput(value: string): void {
    this.search.type(value);
  }

  clearSearch(): void {
    this.search.type('');
    this.searchInput?.nativeElement.focus();
  }

  /** Empty-state text: nothing yet, or nothing matches the words typed (it suggests a general word). */
  emptyText(): string {
    if (this.search.text().trim() === '') return this.i18n.t('music.empty');
    return this.i18n.t('music.noResults', { word: this.suggestedWord() });
  }

  /** The word the no-match line suggests: the first chip. */
  suggestedWord(): string {
    return this.vibeLabel(VIBES[0]);
  }

  /** Enter in the search plays the selected result when it can play, else the first playable one. */
  private enterInSearch(): void {
    const selected = this.selected();
    const target = selected && isPlayable(selected) ? selected : this.results().find(isPlayable);
    if (target) this.playNow(target);
  }

  private move(step: 1 | -1): void {
    const count = this.results().length;
    if (count === 0) return;
    this.selectedIndex.set(Math.min(count - 1, Math.max(0, this.selectedIndex() + step)));
    afterNextRender(() => this.scrollSelectedIntoView(), { injector: this.injector });
  }

  private scrollSelectedIntoView(): void {
    const row = this.host.nativeElement.querySelector<HTMLElement>('[data-selected="true"]');
    row?.scrollIntoView?.({ block: 'nearest' });
  }

  /**
   * Page keys. In the search: Escape clears it, Enter plays, the arrows move the selection.
   * Outside text entry: "/" focuses the search, arrows move the selection, Enter plays the
   * selected result, 1-9 play the Nth result, Space toggles pause. Buttons and links keep their
   * own Space and Enter.
   */
  @HostListener('document:keydown', ['$event'])
  onKey(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
    const input = this.searchInput?.nativeElement;

    if (input && event.target === input) {
      switch (event.key) {
        case 'Escape':
          event.preventDefault();
          this.clearSearch();
          return;
        case 'Enter':
          event.preventDefault();
          this.enterInSearch();
          return;
        case 'ArrowDown':
          event.preventDefault();
          this.move(1);
          return;
        case 'ArrowUp':
          event.preventDefault();
          this.move(-1);
          return;
      }
      return;
    }

    if (isTextEntry(event.target)) return;

    if (event.key === '/') {
      event.preventDefault();
      input?.focus();
      input?.select();
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      this.move(event.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (event.key === 'Enter' && !isActivatable(event.target)) {
      const selected = this.selected();
      if (!selected) return;
      event.preventDefault();
      this.playNow(selected);
      return;
    }
    if (/^[1-9]$/.test(event.key)) {
      const track = this.results()[Number(event.key) - 1];
      if (!track) return;
      event.preventDefault();
      this.playNow(track);
      return;
    }
    if ((event.key === ' ' || event.key === 'Spacebar') && !isActivatable(event.target)) {
      event.preventDefault();
      this.player.toggle();
    }
  }
}
