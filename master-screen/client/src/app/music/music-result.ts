import { Component, computed, inject, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ExternalLink, LucideAngularModule, Pause, Play } from 'lucide-angular';
import type { MusicTrack } from '@shared/types';
import { docUrl } from '../core/doc-nav.service';
import { I18n, type TranslationKey } from '../i18n';
import { snippetParts } from './music-highlight';
import { MusicArt } from './music-art';
import { TooltipDirective } from '../core/tooltip.directive';

/**
 * One track row, shared by the library list, the dock's Tracks popover and the suggestion strip.
 * Left: the index, or the play button on hover, or the moving bars while the track plays. Then the
 * artwork, the title with the sheet under it, the mood, and (only while searching) the sentence of
 * the sheet that matched, with the matched words in the accent. It never filters.
 */
@Component({
  selector: 'ms-music-result',
  imports: [LucideAngularModule, RouterLink, MusicArt, TooltipDirective],
  templateUrl: './music-result.html',
  styleUrl: './music-result.css',
})
export class MusicResult {
  private readonly i18n = inject(I18n);

  readonly track = input.required<MusicTrack>();
  /** This track is the one in the player. */
  readonly current = input(false);
  /** The player is playing or loading this track, so the button offers pause. */
  readonly busy = input(false);
  /** The player is actually playing it (not loading): the bars move. */
  readonly playing = input(false);
  /** Keyboard selection of the list. */
  readonly selected = input(false);
  /** 1-based position in the list, shown in the lead column; null hides it. */
  readonly index = input<number | null>(null);
  /** Flat lists show the sheet on every row; grouped lists show it in the group heading. */
  readonly showSheet = input(true);
  /** 'row': a line in a list (search results, the dock). 'card': a square cover in a grid (the grouped library). */
  readonly variant = input<'row' | 'card'>('row');
  /** Show the matched sentence of the sheet (only while a search is typed). */
  readonly showSnippet = input(true);

  /** The play button was pressed (or the external link should open). */
  readonly activate = output<MusicTrack>();
  /** The sheet link was followed. */
  readonly openSheet = output<void>();

  readonly icons = { ExternalLink, Pause, Play };
  readonly parts = computed(() => snippetParts(this.track().snippet ?? '', this.track().matches ?? []));
  readonly isExternal = computed(() => this.track().provider === 'external');
  readonly showPause = computed(() => this.current() && this.busy());

  buttonLabel(): string {
    const title = this.track().title;
    if (this.isExternal()) return this.i18n.t('music.open');
    return this.i18n.t(this.showPause() ? 'music.pauseTrack' : 'music.playTrack', { title });
  }

  label(key: TranslationKey): string {
    return this.i18n.t(key);
  }

  docLink(path: string): string {
    return docUrl(path);
  }
}
