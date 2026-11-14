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

/** The two HSL stops of the fallback background: muted tones of the same hue, never a bright wash. */
export function toneStops(seed: string): Array<[number, number, number]> {
  const hue = toneHue(seed);
  return [
    [hue, 30, 26],
    [(hue + 36) % 360, 28, 12],
  ];
}

/** The fallback background: two muted tones of the same hue, never a bright wash. */
export function toneGradient(seed: string): string {
  const [a, b] = toneStops(seed);
  return `linear-gradient(135deg, hsl(${a[0]} ${a[1]}% ${a[2]}%), hsl(${b[0]} ${b[1]}% ${b[2]}%))`;
}

/** HSL (degrees, percent, percent) to an [r, g, b] triple of 0-255 values. */
export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const sat = s / 100;
  const light = l / 100;
  const a = sat * Math.min(light, 1 - light);
  const channel = (n: number) => {
    const k = (n + h / 30) % 12;
    return light - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [channel(0), channel(8), channel(4)].map((c) => Math.round(c * 255)) as [number, number, number];
}

/** WCAG relative luminance of an [r, g, b] triple of 0-255 values. */
export function relativeLuminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio between two relative luminances (1 to 21). */
export function contrastRatio(l1: number, l2: number): number {
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The ink for the placeholder note over a background made of the given colours: white-ish on a dark
 * background, near-black on a light one, whichever keeps the lowest contrast over all the colours highest.
 */
export function contrastingInk(backgrounds: Array<[number, number, number]>): '#ffffff' | '#111111' {
  const lums = backgrounds.map(relativeLuminance);
  const worstContrast = (inkLum: number) => Math.min(...lums.map((bg) => contrastRatio(inkLum, bg)));
  const white = worstContrast(relativeLuminance([255, 255, 255]));
  const near = worstContrast(relativeLuminance([0x11, 0x11, 0x11]));
  return white >= near ? '#ffffff' : '#111111';
}

/** The note colour that stays legible on the fallback tone of a title. */
export function noteInk(seed: string): '#ffffff' | '#111111' {
  return contrastingInk(toneStops(seed).map(([h, s, l]) => hslToRgb(h, s, l)));
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
    <lucide-angular class="note" [class.is-hidden]="loaded()" [style.--note-ink]="ink()" [img]="icons.Music" [size]="iconSize()" aria-hidden="true" />
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
  readonly tone = computed(() => toneGradient(this.seed()));
  readonly ink = computed(() => noteInk(this.seed()));
  private readonly seed = computed(() => this.track()?.title || this.track()?.id || 'music');
  readonly iconSize = computed(() => (this.large() ? 48 : 18));
}
