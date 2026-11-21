import { Component, DOCUMENT, computed, effect, inject, signal, untracked } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { I18n, type TranslationKey } from '../i18n';
import { StatusService } from '../core/status.service';
import { percentAt, type Grid } from '../cockpit/combat/combat-model';
import { ProjectorService, type ProjectedCombat, type ProjectedCombatant, type ProjectedHealth } from './projector.service';

/** Health word keys for the enemies' rows, one literal key per state so that the i18n check sees them. */
const HEALTH_KEYS: Record<ProjectedHealth, TranslationKey> = {
  unhurt: 'projector.health.unhurt',
  wounded: 'projector.health.wounded',
  bloodied: 'projector.health.bloodied',
  down: 'projector.health.down',
};

/** A token on the map: the combatant's initials at the centre of its cell, in percent of the map. */
export interface ProjectedToken {
  id: string;
  name: string;
  label: string;
  side: ProjectedCombatant['side'];
  current: boolean;
  defeated: boolean;
  left: number;
  top: number;
}

/**
 * Resolves once the picture is decoded, or once it has failed to load. Never rejects, so the caller always
 * gets to swap: a broken picture must not leave the screen black.
 */
export async function preloadImage(src: string): Promise<void> {
  try {
    const img = new Image();
    img.src = src;
    try {
      await img.decode();
    } catch {
      if (!img.complete) {
        await new Promise<void>((resolve) => {
          img.addEventListener('load', () => resolve(), { once: true });
          img.addEventListener('error', () => resolve(), { once: true });
        });
      }
    }
  } catch {
    /* no Image support: swap anyway */
  }
}

/** The first letters of the first two words of a name: "Mira Vell" is MV, "Ogre" is O. */
export function tokenLabel(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join('');
  return letters || '?';
}

/**
 * The projector window: no controls, black, shows the current projection or a neutral rest screen.
 * A projected fight shows the battle map (when there is one) with its tokens, and the initiative
 * order in large type. It is read from across a room, so the text is big and the current turn is the
 * one inverted row.
 */
@Component({
  selector: 'ms-projector-page',
  templateUrl: './projector-page.html',
  styleUrl: './projector-page.css',
  host: { '(dblclick)': 'toggleFullscreen()' },
})
export class ProjectorPage {
  private readonly projector = inject(ProjectorService);
  private readonly status = inject(StatusService);
  readonly i18n = inject(I18n);
  private readonly title = inject(Title);
  private readonly document = inject(DOCUMENT);

  readonly campaignName = computed(() => this.status.campaign()?.name ?? '');
  readonly imageSrc = computed(() => {
    const projection = this.projector.current();
    return projection.kind === 'image' ? projection.src : null;
  });
  /**
   * The two stacked picture layers. `front` is the visible one; the other is loaded first and then
   * cross-faded in, so the previous picture stays on screen until the next one is ready.
   */
  readonly layers = signal<[string | null, string | null]>([null, null]);
  readonly front = signal<0 | 1>(0);
  /** The combat map picture; it changes only after the new one is preloaded, so the map never goes blank. */
  readonly mapSrc = signal<string | null>(null);
  private imageRequest = 0;
  private mapRequest = 0;
  /** The fight on screen; null when no fight runs, which shows the rest screen. */
  readonly combat = computed<ProjectedCombat | null>(() => {
    const projection = this.projector.current();
    return projection.kind === 'combat' ? projection.combat : null;
  });
  /** Width over height of the map image, once it has loaded; used only when the map has no grid. */
  readonly mapRatio = signal<number | null>(null);
  /** The box of the map keeps the grid's proportions when there is one, else the image's own. */
  readonly ratio = computed(() => {
    const map = this.combat()?.map;
    if (map?.cols && map.rows) return map.cols / map.rows;
    return this.mapRatio() ?? 16 / 9;
  });
  readonly tokens = computed<ProjectedToken[]>(() => {
    const combat = this.combat();
    if (!combat?.map) return [];
    const grid: Grid | null = combat.map.cols && combat.map.rows ? { cols: combat.map.cols, rows: combat.map.rows } : null;
    return Object.entries(combat.positions).flatMap(([id, cell]) => {
      const who = combat.order.find((c) => c.id === id);
      if (!who) return [];
      const at = percentAt(cell, grid);
      return [
        {
          id,
          name: who.name,
          label: tokenLabel(who.name),
          side: who.side,
          current: who.current,
          defeated: !!who.defeated,
          left: at.left,
          top: at.top,
        },
      ];
    });
  });

  constructor() {
    this.projector.listen();
    effect(() => {
      const name = this.campaignName();
      const label = this.i18n.t('projector.title');
      this.i18n.language();
      this.title.setTitle(name ? `${name} · ${label}` : label);
    });
    effect(() => {
      const src = this.imageSrc();
      untracked(() => void this.showImage(src));
    });
    effect(() => {
      const src = this.combat()?.map?.src ?? null;
      untracked(() => void this.showMap(src));
    });
  }

  /** Shows a projected image: preloads it, then cross-fades it onto the hidden layer. Stale loads are dropped. */
  private async showImage(src: string | null): Promise<void> {
    const request = ++this.imageRequest;
    if (src === null) {
      this.layers.set([null, null]);
      this.front.set(0);
      return;
    }
    if (src === this.layers()[this.front()]) return;
    await preloadImage(src);
    if (request !== this.imageRequest) return;
    const back: 0 | 1 = this.front() === 0 ? 1 : 0;
    const next: [string | null, string | null] = [...this.layers()];
    next[back] = src;
    this.layers.set(next);
    this.front.set(back);
  }

  /** Shows the combat map: the new picture replaces the old one only once it has loaded. */
  private async showMap(src: string | null): Promise<void> {
    const request = ++this.mapRequest;
    if (src === null) {
      this.mapSrc.set(null);
      return;
    }
    if (src === this.mapSrc()) return;
    await preloadImage(src);
    if (request !== this.mapRequest) return;
    this.mapSrc.set(src);
  }

  /** Remembers the image's own proportions for a map without a grid. */
  onMapLoad(event: Event): void {
    const img = event.target as HTMLImageElement;
    if (img.naturalWidth > 0 && img.naturalHeight > 0) this.mapRatio.set(img.naturalWidth / img.naturalHeight);
  }

  /** The word for an enemy's health, in the campaign language. */
  healthLabel(health: ProjectedHealth): string {
    return this.i18n.t(HEALTH_KEYS[health]);
  }

  /** A PC's or ally's hit points as "hp/hpMax", or a dash when they are not known. */
  hitPoints(c: ProjectedCombatant): string {
    return c.hp !== undefined && c.hpMax !== undefined ? `${c.hp}/${c.hpMax}` : '—';
  }

  /** Double-click toggles fullscreen. There is deliberately no visible button. */
  toggleFullscreen(): void {
    const doc = this.document;
    if (doc.fullscreenElement) {
      void doc.exitFullscreen().catch(() => {});
    } else {
      void doc.documentElement.requestFullscreen().catch(() => {});
    }
  }
}
