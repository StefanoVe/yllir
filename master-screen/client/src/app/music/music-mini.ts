import { Component, computed, inject, signal } from '@angular/core';
import { ChevronDown, LucideAngularModule, Music, Pause, Play, SkipForward, Volume2, VolumeX } from 'lucide-angular';
import type { MusicTrack } from '@shared/types';
import { StatusService } from '../core/status.service';
import { I18n, type TranslationKey } from '../i18n';
import { MusicArt } from './music-art';
import { MusicPlayerService, type MusicUiState } from './music-player.service';
import { MusicSlider } from './music-slider';

/** localStorage key of the collapsed or expanded state. */
export const MUSIC_MINI_KEY = 'ms.combat.musicMini';

/** Reads the saved state. Storage can be missing or blocked: then the mini player starts collapsed. */
function readExpanded(): boolean {
  try {
    return globalThis.localStorage?.getItem(MUSIC_MINI_KEY) === '1';
  } catch {
    return false;
  }
}

/** Saves the state. A failed write only means the state is not remembered. */
function writeExpanded(expanded: boolean): void {
  try {
    globalThis.localStorage?.setItem(MUSIC_MINI_KEY, expanded ? '1' : '0');
  } catch {
    // Storage is unavailable: the player still works, it just forgets the state.
  }
}

/**
 * A minimal music player for the full-screen combat overlay. Collapsed it is one round button (the
 * artwork of the current track, or a note, with a small equaliser while it plays). Expanded it is a
 * compact card: artwork, title and sheet, play or pause, next, a volume slider and a collapse button.
 * It controls the same server playback as the bottom bar, and renders nothing when music is off.
 * The parent positions it.
 */
@Component({
  selector: 'ms-music-mini',
  imports: [LucideAngularModule, MusicArt, MusicSlider],
  templateUrl: './music-mini.html',
  styleUrl: './music-mini.css',
})
export class MusicMini {
  readonly player = inject(MusicPlayerService);
  private readonly i18n = inject(I18n);
  private readonly status = inject(StatusService);

  readonly icons = { ChevronDown, Music, Pause, Play, SkipForward, Volume2, VolumeX };

  /** The mini player is shown for as long as music is on for the campaign. */
  readonly visible = computed(() => this.status.modules()?.music === true);

  /** Collapsed (false) or expanded (true), remembered per browser. */
  readonly expanded = signal(readExpanded());
  /** The inline volume slider of the expanded card. Not remembered. */
  readonly volumeOpen = signal(false);

  readonly playing = computed(() => this.player.state() === 'playing');
  readonly busy = computed(() => {
    const state: MusicUiState = this.player.state();
    return state === 'playing' || state === 'loading';
  });

  label(key: TranslationKey, params?: Record<string, string | number>): string {
    return this.i18n.t(key, params);
  }

  /** Title of the loaded track, or the plain line for a track the app has not seen. */
  titleOf(track: MusicTrack): string {
    return track.title || this.i18n.t('music.unknownTrack');
  }

  setExpanded(next: boolean): void {
    this.expanded.set(next);
    writeExpanded(next);
    if (!next) this.volumeOpen.set(false);
  }

  toggleVolume(): void {
    this.volumeOpen.update((open) => !open);
  }

  onVolume(value: number): void {
    this.player.setVolume(value);
  }

  volumeLabel(): string {
    return this.i18n.t('music.volumeValue', { value: this.player.volume() });
  }

  volumeIcon(): typeof VolumeX {
    return this.player.volume() === 0 ? VolumeX : Volume2;
  }

  playPauseLabel(): string {
    return this.i18n.t(this.busy() ? 'music.pause' : 'music.play');
  }

  /** Play and pause need a loaded track and working playback. */
  canPlay(): boolean {
    return this.player.available() && this.player.current() !== null;
  }
}
