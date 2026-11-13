import { Component, DOCUMENT, DestroyRef, ElementRef, HostListener, computed, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Title } from '@angular/platform-browser';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { BookOpen, LucideAngularModule, Dices, Eye, EyeOff, GitBranch, Library, Music, Printer, Search, Settings, SunMoon, WifiOff } from 'lucide-angular';
import { filter, map } from 'rxjs';
import { LiveService } from '../core/live.service';
import { SettingsService } from '../core/settings.service';
import { MusicApiService } from '../music/music-api.service';
import { MusicDock } from '../music/music-dock';
import { MusicPlayerService } from '../music/music-player.service';
import { PrefsService } from '../core/prefs.service';
import { StatusService } from '../core/status.service';
import { ThemeService } from '../core/theme.service';
import { ViewModeService } from '../core/view-mode.service';
import { I18n, type TranslationKey } from '../i18n';
import { Palette, PaletteController } from '../search/palette';
import { applyTextScale, readTextScale } from './text-scale';

@Component({
  selector: 'ms-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, LucideAngularModule, Palette, MusicDock],
  templateUrl: './shell.html',
  styleUrl: './shell.css',
})
export class Shell {
  readonly i18n = inject(I18n);
  readonly live = inject(LiveService);
  readonly theme = inject(ThemeService);
  readonly viewMode = inject(ViewModeService);
  readonly palette = inject(PaletteController);
  private readonly router = inject(Router);
  private readonly prefs = inject(PrefsService);
  private readonly status = inject(StatusService);
  private readonly titleService = inject(Title);
  private readonly music = inject(MusicPlayerService);
  private readonly musicApi = inject(MusicApiService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly settingsService = inject(SettingsService);
  private readonly document = inject(DOCUMENT);

  readonly icons = { Dices, GitBranch, Library, Music, BookOpen, Printer, Search, Settings, Eye, EyeOff, SunMoon, WifiOff };
  /** The connection notice shows only after the stream has been down for a while, so load and blips do not flash it. */
  readonly showOffline = signal(false);
  private offlineTimer: ReturnType<typeof setTimeout> | undefined;
  /** Module entries show only when the module is on for this campaign. */
  readonly musicEnabled = computed(() => this.status.modules()?.music === true);
  readonly encyclopediaEnabled = computed(() => this.status.modules()?.encyclopedia === true);
  readonly printEnabled = computed(() => this.status.modules()?.print === true);
  /** Rail entries the master can hide in the settings: shown only when the module is on AND the rail flag is on. */
  private readonly railSettings = computed(() => this.settingsService.settings().ui.rail);
  readonly showDocs = computed(() => this.railSettings().docs);
  readonly showMusic = computed(() => this.musicEnabled() && this.railSettings().music);
  readonly showEncyclopedia = computed(() => this.encyclopediaEnabled() && this.railSettings().encyclopedia);
  readonly showPrint = computed(() => this.printEnabled() && this.railSettings().print);
  /** The bottom bar: 'always' shows it whenever music is on; 'playing' only while a track or a suggestion is there. */
  readonly dockVisible = computed(() => {
    const playing = this.music.current() !== null || this.musicApi.suggestions().length > 0;
    return this.settingsService.settings().music.dock === 'playing' ? playing : this.musicEnabled() || playing;
  });

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );
  private readonly campaignName = computed(() => this.status.campaign()?.name ?? '');

  constructor() {
    // Saved text size: applied once the campaign is known, and again whenever it changes.
    effect(() => applyTextScale(readTextScale(this.prefs)));
    // The page title follows the route. A document sets its own title once it has loaded.
    effect(() => {
      const url = this.url();
      const name = this.campaignName();
      this.i18n.language();
      untracked(() => this.titleService.setTitle(this.titleFor(url, name)));
    });
    // Density and motion from the settings, as attributes on <html> (styles.css reads them).
    effect(() => {
      const ui = this.settingsService.settings().ui;
      this.document.documentElement.dataset['density'] = ui.density;
      this.document.documentElement.dataset['motion'] = ui.motion;
    });
    // Show the connection notice only after 4 seconds offline; hide it at once when connected.
    effect(() => {
      const up = this.live.connected();
      untracked(() => {
        clearTimeout(this.offlineTimer);
        this.offlineTimer = undefined;
        if (up) {
          this.showOffline.set(false);
        } else {
          this.offlineTimer = setTimeout(() => this.showOffline.set(true), 4000);
        }
      });
    });
    inject(DestroyRef).onDestroy(() => clearTimeout(this.offlineTimer));
    // On a phone the rail scrolls sideways: keep the current page's icon in view after each navigation.
    effect(() => {
      this.url();
      untracked(() => setTimeout(() => this.keepActiveRailItemInView()));
    });
  }

  /** Theme button label, for example "Theme: Light". */
  themeLabel(): string {
    const pref = this.theme.pref();
    const name: TranslationKey = pref === 'system' ? 'theme.system' : pref === 'light' ? 'theme.light' : 'theme.dark';
    return this.i18n.t('nav.theme') + ': ' + this.i18n.t(name);
  }

  previewLabel(): string {
    return this.i18n.t('nav.playersPreview');
  }

  label(key: TranslationKey): string {
    return this.i18n.t(key);
  }

  titleFor(url: string, campaign: string): string {
    const path = url.split(/[?#]/)[0];
    const page = path === '/' ? this.i18n.t('nav.home') : path.startsWith('/search') ? this.i18n.t('nav.search') : path.startsWith('/settings') ? this.i18n.t('nav.settings')
      : path.startsWith('/live') ? this.i18n.t('nav.liveTable') : path.startsWith('/plot') ? this.i18n.t('nav.plot')
      : path.startsWith('/music') ? this.i18n.t('nav.music')
      : path.startsWith('/docs') ? this.i18n.t('nav.documents')
      : path.startsWith('/encyclopedia') ? this.i18n.t('nav.encyclopedia') : path.startsWith('/print') ? this.i18n.t('nav.print') : '';
    if (path.startsWith('/doc/')) return campaign;
    if (page === '') return campaign;
    return campaign === '' ? page : `${page} · ${campaign}`;
  }

  /** Scrolls the rail (bottom bar on phones) so the active entry is visible. Does nothing when there is no rail. */
  private keepActiveRailItemInView(): void {
    const rail = (this.host.nativeElement as HTMLElement).querySelector<HTMLElement>('.rail');
    const active = rail?.querySelector<HTMLElement>('.rail-item.active');
    if (!rail || !active || rail.scrollWidth <= rail.clientWidth) return;
    const left = active.offsetLeft - (rail.clientWidth - active.offsetWidth) / 2;
    rail.scrollLeft = Math.max(0, left);
  }

  /** Ctrl/Cmd+K toggles the command palette from anywhere. */
  @HostListener('window:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      this.palette.toggle();
    }
  }
}
