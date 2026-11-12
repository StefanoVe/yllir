import {
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  ViewEncapsulation,
  afterNextRender,
  computed,
  effect,
  viewChild,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { Title } from '@angular/platform-browser';
import { NavigationEnd, Router } from '@angular/router';
import { ArrowLeft, Columns2, EyeOff, LucideAngularModule, Star, X } from 'lucide-angular';
import { filter, map } from 'rxjs';
import type { DocResponse, Heading } from '@shared/types';
import { ApiService, isApiFailure } from '../core/api.service';
import { DocNavService, docPathFromUrl, docUrl, parseDocHref } from '../core/doc-nav.service';
import { LiveService } from '../core/live.service';
import { StatusService } from '../core/status.service';
import { ViewModeService } from '../core/view-mode.service';
import { I18n, type TranslationKey } from '../i18n';
import { DocBody } from './doc-body';

function normalizeText(value: string | null): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

/** Route `doc/**` and the compact second pane (`docPath` set, `compact` true). */
@Component({
  selector: 'ms-reader',
  imports: [LucideAngularModule, DocBody],
  templateUrl: './reader.html',
  styleUrl: './reader.css',
  // Global on purpose: the document body is server HTML, which component styles cannot reach.
  // Every selector is prefixed with `ms-reader`.
  encapsulation: ViewEncapsulation.None,
  host: {
    '[class.pane]': 'isPane()',
    '[class.compact]': 'compact()',
    '[class.split]': 'split()',
  },
})
export class Reader {
  private readonly api = inject(ApiService);
  private readonly live = inject(LiveService);
  private readonly view = inject(ViewModeService);
  private readonly docNav = inject(DocNavService);
  private readonly router = inject(Router);
  private readonly i18n = inject(I18n);
  private readonly status = inject(StatusService);
  private readonly titleService = inject(Title);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  /** The scroll container of this pane. In a split view each pane scrolls on its own. */
  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');
  private readonly destroyRef = inject(DestroyRef);

  /** Path of the document in the compact pane. Unused by the route itself. */
  readonly docPath = input('');
  readonly compact = input(false);
  readonly closeRequested = output<void>();

  readonly icons = { ArrowLeft, Columns2, EyeOff, Star, X };

  /** The router URL after every navigation, so the document path and `with` follow the address bar. */
  private readonly navUrl = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map(() => this.router.url),
    ),
    { initialValue: this.router.url },
  );
  private readonly routePath = computed(() => docPathFromUrl(this.navUrl()));
  /** `null` when the second pane is closed, `''` when it is open but empty. */
  readonly side = computed<string | null>(() => {
    const tree = this.router.parseUrl(this.navUrl());
    return tree.queryParamMap.has('with') ? (tree.queryParamMap.get('with') ?? '') : null;
  });
  readonly split = computed(() => !this.compact() && this.side() !== null);
  readonly isPane = computed(() => this.compact() || this.split());
  readonly path = computed(() => (this.compact() ? this.docPath() : this.routePath()));

  readonly doc = signal<DocResponse | null>(null);
  readonly error = signal<string | null>(null);
  readonly activeId = signal('');
  readonly isFavourite = computed(() => this.docNav.favourites().includes(this.path()));
  /** The first level-1 heading is the document title, shown once at the top, so it is not repeated in the outline. */
  readonly outline = computed<Heading[]>(() => {
    const headings = this.doc()?.headings ?? [];
    return headings.length > 0 && headings[0].level === 1 ? headings.slice(1) : headings;
  });

  private readonly reloadTick = signal(0);
  private loadSeq = 0;
  private recordedPath = '';
  private pendingFragment = '';
  private observer: IntersectionObserver | null = null;

  constructor() {
    effect(() => {
      const path = this.path();
      const mode = this.view.viewMode();
      this.reloadTick();
      untracked(() => void this.load(path, mode));
    });
    this.live
      .on('files')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((event) => {
        if ([...event.changed, ...event.removed].includes(this.path())) this.reload();
      });
    this.live.resync$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.reload());
    this.destroyRef.onDestroy(() => this.observer?.disconnect());
  }

  label(key: TranslationKey): string {
    return this.i18n.t(key);
  }

  /** Public view shows a notice instead of text for a master-only document or one with nothing public. */
  showsPublicNotice(doc: DocResponse): boolean {
    return this.view.viewMode() === 'public' && (doc.masterOnly || doc.blocks.length === 0);
  }

  /** The title is shown on top unless the body already starts with the same level-1 heading. */
  showsTitle(doc: DocResponse): boolean {
    const first = doc.headings[0];
    return !(first !== undefined && first.level === 1 && first.text === doc.title);
  }

  docHref(path: string): string {
    return docUrl(path);
  }

  reload(): void {
    this.reloadTick.update((value) => value + 1);
  }

  goBack(): void {
    if (typeof history !== 'undefined' && history.length > 1) history.back();
    else void this.router.navigateByUrl('/');
  }

  toggleFavourite(): void {
    this.docNav.toggleFavourite(this.path());
  }

  /** Side-by-side toggle: opens the first backlink next to the document, or an empty pane; closes an open pane. */
  toggleSide(): void {
    if (this.side() !== null) {
      this.closeSide();
      return;
    }
    this.openSide(this.doc()?.backlinks[0]?.path ?? '');
  }

  closeSide(): void {
    void this.router.navigate([], { queryParams: { with: null }, queryParamsHandling: 'merge' });
  }

  openSide(path: string): void {
    void this.router.navigate([], { queryParams: { with: path }, queryParamsHandling: 'merge' });
  }

  /** Link clicks in the document body: `/doc/...` links navigate, `#id` scrolls, web links open in a new tab. */
  onArticleClick(event: MouseEvent): void {
    if (event.button !== 0 || !(event.target instanceof Element)) return;
    const anchor = event.target.closest('a[href]');
    if (!(anchor instanceof HTMLAnchorElement)) return;
    const href = anchor.getAttribute('href') ?? '';
    if (href.startsWith('#')) {
      event.preventDefault();
      this.scrollToId(decodeURIComponent(href.slice(1)));
      return;
    }
    const target = parseDocHref(href);
    if (target) {
      event.preventDefault();
      this.openDoc(target.path, target.fragment, event.ctrlKey || event.metaKey);
      return;
    }
    if (/^https?:/i.test(href)) {
      event.preventDefault();
      window.open(href, '_blank', 'noopener,noreferrer');
    }
  }

  /** Backlinks and other router links: a plain click navigates, Ctrl or Cmd opens side by side. */
  onDocLink(event: MouseEvent, path: string, side: boolean): void {
    event.preventDefault();
    this.openDoc(path, '', side || event.ctrlKey || event.metaKey);
  }

  onSideIcon(event: MouseEvent, path: string): void {
    event.preventDefault();
    event.stopPropagation();
    this.openDoc(path, '', true);
  }

  jumpTo(id: string): void {
    if (id !== '') this.scrollToId(id);
  }

  private openDoc(path: string, fragment: string, side: boolean): void {
    if (side || this.compact()) {
      this.openSide(path);
      return;
    }
    if (path === this.routePath()) {
      this.scrollToId(fragment);
      return;
    }
    this.pendingFragment = fragment;
    const withPath = this.side();
    const suffix = withPath === null ? '' : `?with=${encodeURIComponent(withPath)}`;
    void this.router.navigateByUrl(docUrl(path) + suffix);
  }

  private async load(path: string, mode: string): Promise<void> {
    const seq = ++this.loadSeq;
    if (path === '') {
      this.doc.set(null);
      this.error.set(null);
      return;
    }
    try {
      const doc = await this.api.readDoc(path, mode === 'public' ? 'public' : 'master');
      if (seq !== this.loadSeq) return;
      this.doc.set(doc);
      this.error.set(null);
      if (this.recordedPath !== path) {
        this.recordedPath = path;
        this.docNav.recordOpen(path);
      }
      if (!this.compact()) {
        const campaign = this.status.campaign()?.name;
        this.titleService.setTitle(campaign ? `${doc.title} · ${campaign}` : doc.title);
      }
      const fragment = this.pendingFragment;
      this.pendingFragment = '';
      this.afterRender(doc, fragment);
    } catch (failure) {
      if (seq !== this.loadSeq) return;
      this.error.set(isApiFailure(failure) ? failure.error : this.i18n.t('reader.loadError'));
    }
  }

  /** After the body is in the DOM: restore heading ids, mark external links, follow the outline and jump to a fragment. */
  private afterRender(doc: DocResponse, fragment: string): void {
    afterNextRender(
      () => {
        this.restoreHeadingIds(doc.headings);
        this.decorateExternalLinks();
        this.observeHeadings();
        if (fragment !== '') this.scrollToId(fragment);
      },
      { injector: this.injector },
    );
  }

  /**
   * The sanitizer drops `id` attributes, so the ids that the outline and `#` links use are put back.
   * The rendered headings appear in the same order as `headings`, so each id goes to the next heading
   * with the same text. A heading that cannot be matched keeps no id, and the outline skips it.
   */
  private restoreHeadingIds(headings: Heading[]): void {
    const rendered = this.elements<HTMLElement>('.block-body h1, .block-body h2, .block-body h3, .block-body h4, .block-body h5, .block-body h6');
    let cursor = 0;
    for (const heading of headings) {
      for (let i = cursor; i < rendered.length; i++) {
        if (normalizeText(rendered[i].textContent) !== normalizeText(heading.text)) continue;
        if (rendered[i].id === '') rendered[i].id = heading.id;
        cursor = i + 1;
        break;
      }
    }
  }

  private decorateExternalLinks(): void {
    for (const anchor of this.elements<HTMLAnchorElement>('a[href]')) {
      if (/^https?:/i.test(anchor.getAttribute('href') ?? '')) {
        anchor.target = '_blank';
        anchor.rel = 'noopener noreferrer';
      }
    }
  }

  private observeHeadings(): void {
    this.observer?.disconnect();
    this.observer = null;
    if (typeof IntersectionObserver === 'undefined') return;
    const root = this.isPane() ? this.root() : null;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) this.activeId.set(entry.target.id);
        }
      },
      { root, rootMargin: '0px 0px -70% 0px' },
    );
    for (const heading of this.elements<HTMLElement>('.block-body h1[id], .block-body h2[id], .block-body h3[id], .block-body h4[id], .block-body h5[id], .block-body h6[id]')) {
      observer.observe(heading);
    }
    this.observer = observer;
  }

  private scrollToId(id: string): void {
    if (id === '') return;
    const target = this.elements<HTMLElement>('[id]').find((element) => element.id === id);
    if (!target) return;
    this.activeId.set(id);
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    target.scrollIntoView({ block: 'start', behavior: reduced ? 'auto' : 'smooth' });
  }

  private elements<T extends Element>(selector: string): T[] {
    return Array.from(this.root().querySelectorAll<T>(selector));
  }

  private root(): HTMLElement {
    return this.scroller()?.nativeElement ?? this.host.nativeElement;
  }
}
