import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideAngularModule, Pause, Play, Repeat, SkipBack, SkipForward, Sunset, ExternalLink, Volume2, VolumeX, X } from 'lucide-angular';
import type { MusicTrack } from '@shared/types';
import { docUrl } from '../core/doc-nav.service';
import { I18n, type TranslationKey } from '../i18n';
import { MusicApiService } from './music-api.service';
import { MusicPlayerService, type MusicPlayerState } from './music-player.service';

/**
 * The bottom dock of the app: the suggestion tray (chips the assistant showed) above the
 * mini player. Rendered once by the shell, so it survives route changes. Shown only when
 * something is loaded or suggested.
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

  readonly icons = { Pause, Play, Repeat, SkipBack, SkipForward, Sunset, ExternalLink, Volume2, VolumeX, X };
  readonly visible = computed(() => this.player.current() !== null || this.api.suggestions().length > 0);

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
}

const STATE_KEYS: Record<MusicPlayerState, TranslationKey> = {
  idle: 'music.state.idle',
  loading: 'music.state.loading',
  playing: 'music.state.playing',
  paused: 'music.state.paused',
  error: 'music.state.error',
};
