import { Component, HostListener, computed, effect, inject, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Title } from '@angular/platform-browser';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { LucideAngularModule, Dices, Eye, EyeOff, GitBranch, MessageSquare, Search, Settings, SunMoon } from 'lucide-angular';
import { filter, map } from 'rxjs';
import { LiveService } from '../core/live.service';
import { PrefsService } from '../core/prefs.service';
import { StatusService } from '../core/status.service';
import { ThemeService } from '../core/theme.service';
import { ViewModeService } from '../core/view-mode.service';
import { I18n, type TranslationKey } from '../i18n';
import { Palette, PaletteController } from '../search/palette';
import { applyTextScale, readTextScale } from './text-scale';

@Component({
  selector: 'ms-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, LucideAngularModule, Palette],
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

  readonly icons = { MessageSquare, Dices, GitBranch, Search, Settings, Eye, EyeOff, SunMoon };

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
      : path.startsWith('/live') ? this.i18n.t('nav.liveTable') : path.startsWith('/plot') ? this.i18n.t('nav.plot') : '';
    if (path.startsWith('/doc/')) return campaign;
    if (page === '') return campaign;
    return campaign === '' ? page : `${page} · ${campaign}`;
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
