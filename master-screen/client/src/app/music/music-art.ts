import { Component, computed, input, signal } from '@angular/core';
import { LucideAngularModule, Music } from 'lucide-angular';
import type { MusicTrack } from '@shared/types';

/**
 * The thumbnail of a YouTube track. Other tracks (SoundCloud has no thumbnail URL we can build)
 * get no request at all: they keep the tone from their title and the note.
 */
export function artUrl(track: Pick<MusicTrack, 'provider' | 'videoId'> | null): string | null {
  if (!track || track.provider !== 'youtube' || !track.videoId) return null;
  if (!/^[A-Za-z0-9_-]{6,20}$/.test(track.videoId)) return null;
  return `https://i.ytimg.com/vi/${track.videoId}/hqdefault.jpg`;
}

/** A stable hue for a title (djb2 hash), so the same track always gets the same fallback tone. */
export function toneHue(seed: string): number {
  let hash = 5381;
  for (let i = 0; i < seed.length; i++) hash = ((hash << 5) + hash + seed.charCodeAt(i)) | 0;
  return Math.abs(hash) % 360;
}

/** The fallback background: two muted tones of the same hue, never a bright wash. */
export function toneGradient(seed: string): string {
  const hue = toneHue(seed);
  return `linear-gradient(135deg, hsl(${hue} 30% 26%), hsl(${(hue + 36) % 360} 28% 12%))`;
}

/**
 * Artwork of a track: the thumbnail, faded in when it loads, over a tone and a music note. A failed
 * or missing thumbnail leaves the tone and the note, so the square is never empty.
 */
@Component({
  selector: 'ms-music-art',
  imports: [LucideAngularModule],
  template: `
    <span class="tone" [style.background]="tone()" aria-hidden="true"></span>
    @if (src(); as url) {
      @if (!failed()) {
        <img class="thumb" [class.ready]="loaded()" [src]="url" alt="" loading="lazy" decoding="async"
             (load)="loaded.set(true)" (error)="failed.set(true)" />
      }
    }
    <lucide-angular class="note" [class.is-hidden]="loaded()" [img]="icons.Music" [size]="iconSize()" aria-hidden="true" />
  `,
  styleUrl: './music-art.css',
  host: { class: 'art', '[class.is-large]': 'large()' },
})
export class MusicArt {
  readonly track = input<MusicTrack | null>(null);
  readonly large = input(false);
  readonly icons = { Music };
  readonly loaded = signal(false);
  readonly failed = signal(false);
  readonly src = computed(() => artUrl(this.track()));
  readonly tone = computed(() => toneGradient(this.track()?.title || this.track()?.id || 'music'));
  readonly iconSize = computed(() => (this.large() ? 48 : 18));
}
