import {
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  ViewChild,
  afterNextRender,
  afterRenderEffect,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import {
  Check,
  ChevronDown,
  ChevronRight,
  LoaderCircle,
  LucideAngularModule,
  Monitor,
  Moon,
  Power,
  RefreshCw,
  Search,
  Sun,
  TriangleAlert,
  WifiOff,
  X,
} from 'lucide-angular';
import type { ChecksResponse, ModuleId, ScreenModel, ScreenSettings, ScreenSettingsPatch, UpdateStatus } from '@shared/types';
import { ApiService, isApiFailure } from '../core/api.service';
import { foldText } from '../documents/documents';
import { BLOCKED_REASON_KEYS, UpdateService } from '../core/update';
import { PrefsService } from '../core/prefs.service';
import { SettingsService } from '../core/settings.service';
import { StatusService } from '../core/status.service';
import { ThemePref, ThemeService } from '../core/theme.service';
import { I18n, type TranslationKey } from '../i18n';
import {
  TEXT_SCALE_KEY,
  TEXT_SCALE_MAX,
  TEXT_SCALE_MIN,
  TEXT_SCALE_STEP,
  applyTextScale,
  clampTextScale,
  readTextScale,
} from '../shell/text-scale';

const MODULE_ORDER: ModuleId[] = ['music', 'encyclopedia'];
const QUIT_CONFIRM_MS = 4000;
const THEME_OPTIONS: Array<{ pref: ThemePref; key: TranslationKey; icon: 'monitor' | 'sun' | 'moon' }> = [
  { pref: 'system', key: 'theme.system', icon: 'monitor' },
  { pref: 'light', key: 'theme.light', icon: 'sun' },
  { pref: 'dark', key: 'theme.dark', icon: 'moon' },
];

type SectionKey = 'table' | 'combat' | 'music' | 'ui';
type PanelKey = keyof ScreenSettings['combat']['panels'];
type RailKey = keyof ScreenSettings['ui']['rail'];

interface Option<T extends string> {
  value: T;
  label: TranslationKey;
  title?: TranslationKey;
}

interface TocItem {
  id: string;
  label: TranslationKey;
}

interface Kpi {
  count: number;
  label: TranslationKey;
  title: string;
  warn: boolean;
}

const MODEL_OPTIONS: Option<ScreenModel>[] = [
  { value: 'haiku', label: 'liveModel.haiku', title: 'liveModel.haiku.desc' },
  { value: 'sonnet', label: 'liveModel.sonnet', title: 'liveModel.sonnet.desc' },
  { value: 'opus', label: 'liveModel.opus', title: 'liveModel.opus.desc' },
];
const DENSITY_OPTIONS: Option<ScreenSettings['ui']['density']>[] = [
  { value: 'comfortable', label: 'settingsPage.density.comfortable' },
  { value: 'compact', label: 'settingsPage.density.compact' },
];
const MOTION_OPTIONS: Option<ScreenSettings['ui']['motion']>[] = [
  { value: 'system', label: 'settingsPage.motion.system' },
  { value: 'reduced', label: 'settingsPage.motion.reduced' },
];
const START_OPTIONS: Option<ScreenSettings['ui']['startPage']>[] = [
  { value: 'live', label: 'nav.liveTable' },
  { value: 'plot', label: 'nav.plot' },
  { value: 'docs', label: 'nav.documents' },
];
const DOCK_OPTIONS: Option<ScreenSettings['music']['dock']>[] = [
  { value: 'always', label: 'settingsPage.music.dock.always' },
  { value: 'playing', label: 'settingsPage.music.dock.playing' },
];
const PANEL_OPTIONS: { key: PanelKey; label: TranslationKey }[] = [
  { key: 'initiative', label: 'settingsPage.combat.panel.initiative' },
  { key: 'turn', label: 'settingsPage.combat.panel.turn' },
  { key: 'chat', label: 'settingsPage.combat.panel.chat' },
  { key: 'music', label: 'nav.music' },
];
/** Sidebar items. Items with a module are offered only when that module is on. */
const RAIL_OPTIONS: { key: RailKey; label: TranslationKey; module: ModuleId | null }[] = [
  { key: 'docs', label: 'nav.documents', module: null },
  { key: 'music', label: 'nav.music', module: 'music' },
  { key: 'encyclopedia', label: 'nav.encyclopedia', module: 'encyclopedia' },
  { key: 'atlas', label: 'nav.atlas', module: null },
];

/** One block of the update news: a paragraph (one line of text) or a list. */
export interface NewsBlock {
  list: boolean;
  lines: string[];
}

/**
 * Splits the update news (Markdown-light: paragraphs separated by blank lines, `- ` or `* ` list items)
 * into plain blocks. Nothing is rendered as HTML.
 */
export function parseNews(news: string): NewsBlock[] {
  const blocks: NewsBlock[] = [];
  // True while the last block can still take more lines (a blank line closes it).
  let open = false;
  for (const raw of news.split('\n')) {
    const line = raw.trim();
    if (line === '') {
      open = false;
      continue;
    }
    const last = blocks[blocks.length - 1];
    const item = /^[-*]\s+(.*)$/.exec(line);
    if (item) {
      if (open && last?.list) last.lines.push(item[1]);
      else blocks.push({ list: true, lines: [item[1]] });
    } else if (open && last && !last.list) {
      last.lines[0] += ` ${line}`;
    } else {
      blocks.push({ list: false, lines: [line] });
    }
    open = true;
  }
  return blocks;
}

export interface CheckLine {
  text: string;
  broken: boolean;
}

/** Plain-language summary of a checks result, one sentence per check. */
export function checkSummary(
  result: ChecksResponse,
  t: (key: TranslationKey, params?: Record<string, string | number>) => string,
): CheckLine[] {
  const broken = result.brokenLinks.length;
  const sketches = result.sketches.length;
  const exclusions = result.exclusions.length;
  return [
    {
      text: broken === 0 ? t('settings.noBroken') : broken === 1 ? t('settings.brokenFound.one', { count: broken }) : t('settings.brokenFound.other', { count: broken }),
      broken: broken > 0,
    },
    {
      text: sketches === 0 ? t('settings.noSketches') : sketches === 1 ? t('settings.sketchesFound.one', { count: sketches }) : t('settings.sketchesFound.other', { count: sketches }),
      broken: false,
    },
    {
      text: exclusions === 0 ? t('settings.noExclusions') : exclusions === 1 ? t('settings.exclusionsFound.one', { count: exclusions }) : t('settings.exclusionsFound.other', { count: exclusions }),
      broken: false,
    },
  ];
}

/**
 * True when the section text contains the filter, ignoring case, accents and the line breaks of the
 * markup. An empty filter matches every section.
 */
export function sectionMatches(sectionText: string, filter: string): boolean {
  const needle = foldText(filter.trim());
  if (needle === '') return true;
  return foldText(sectionText.replace(/\s+/g, ' ')).includes(needle);
}

/** Storage key of the sections the master has folded. Every read and write is guarded. */
export const SETTINGS_COLLAPSED_KEY = 'yllir.settings.collapsed';

/** The folded sections as saved; anything unreadable gives an empty list, and the page still works. */
function readCollapsed(): string[] {
  try {
    const raw = localStorage.getItem(SETTINGS_COLLAPSED_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

/** Saves the folded sections. Blocked storage is ignored: the choice then lasts only for this page. */
function writeCollapsed(list: string[]): void {
  try {
    localStorage.setItem(SETTINGS_COLLAPSED_KEY, JSON.stringify(list));
  } catch {
    // Storage is not available (private window, blocked site data): nothing to keep.
  }
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

/** The sections that have a Reset button, by their page id. */
const RESETTABLE: Record<string, SectionKey> = { 's-table': 'table', 's-combat': 'combat', 's-music': 'music', 's-appearance': 'ui' };

@Component({
  selector: 'ms-settings',
  imports: [LucideAngularModule],
  templateUrl: './settings.html',
  styleUrl: './settings.css',
})
export class Settings {
  private readonly api = inject(ApiService);
  private readonly prefs = inject(PrefsService);
  private readonly theme = inject(ThemeService);
  private readonly status = inject(StatusService);
  private readonly host = inject(ElementRef) as ElementRef<HTMLElement>;
  readonly settingsService = inject(SettingsService);
  readonly updates = inject(UpdateService);
  readonly i18n = inject(I18n);

  readonly icons = { Check, ChevronDown, ChevronRight, LoaderCircle, Monitor, Moon, Power, RefreshCw, Search, Sun, TriangleAlert, WifiOff, X };
  @ViewChild('searchField') private searchField?: ElementRef<HTMLInputElement>;
  private readonly route = inject(ActivatedRoute, { optional: true });
  /** The section named by the URL fragment (`/settings#s-appearance`), applied once it is on the page. */
  private pendingFragment: string | null = this.route?.snapshot.fragment ?? null;
  readonly themeOptions = THEME_OPTIONS;
  readonly modelOptions = MODEL_OPTIONS;
  readonly densityOptions = DENSITY_OPTIONS;
  readonly motionOptions = MOTION_OPTIONS;
  readonly startOptions = START_OPTIONS;
  readonly dockOptions = DOCK_OPTIONS;
  readonly panelOptions = PANEL_OPTIONS;
  readonly skeletonRows = [1, 2, 3];
  readonly scaleMin = TEXT_SCALE_MIN;
  readonly scaleMax = TEXT_SCALE_MAX;
  readonly scaleStep = TEXT_SCALE_STEP;

  /** What the page shows (saved settings plus the change waiting for the save). */
  readonly shown = this.settingsService.shown;
  readonly defaults = this.settingsService.defaults;
  readonly canSave = this.settingsService.canSave;

  readonly textScale = signal(100);
  readonly checks = signal<ChecksResponse | null>(null);
  readonly checkError = signal<string | null>(null);
  readonly checking = signal(false);
  readonly activeId = signal('s-table');
  /** The search text as typed. A text with only spaces is no search. */
  readonly query = signal('');
  readonly searchActive = computed(() => this.query().trim() !== '');
  /** The ids of the sections that match the search, or null when no search is active. */
  readonly searchIds = signal<string[] | null>(null);
  readonly filterFocused = signal(false);
  /** The folded sections, saved in localStorage. A search shows every section regardless. */
  readonly collapsed = signal<string[]>(readCollapsed());
  /** Stop button: the first click arms it for a few seconds, the second one stops the process. */
  readonly quitArmed = signal(false);
  readonly quitting = signal(false);
  readonly quitDone = signal(false);
  private quitTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly quitCleanup = inject(DestroyRef).onDestroy(() => this.clearQuitTimer());
  readonly lines = computed<CheckLine[]>(() => {
    const result = this.checks();
    return result ? checkSummary(result, (key, params) => this.t(key, params)) : [];
  });
  readonly kpis = computed<Kpi[]>(() => {
    const result = this.checks();
    if (!result) return [];
    const lines = this.lines();
    const broken = result.brokenLinks.length;
    return [
      { count: broken, label: 'settings.brokenList', title: lines[0]?.text ?? '', warn: broken > 0 },
      { count: result.sketches.length, label: 'settings.sketchesList', title: lines[1]?.text ?? '', warn: false },
      { count: result.exclusions.length, label: 'settings.exclusionsList', title: lines[2]?.text ?? '', warn: false },
    ];
  });
  readonly checkedTime = computed(() => {
    const iso = this.checks()?.checkedAt;
    if (!iso) return '';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleTimeString(this.i18n.language(), { hour: '2-digit', minute: '2-digit' });
  });

  readonly campaign = computed(() => this.status.campaign());
  readonly framework = computed(() => this.status.status()?.frameworkVersion ?? '');
  readonly screenVersion = computed(() => this.status.status()?.screenVersion ?? '');
  readonly agent = computed(() => this.status.status()?.agent ?? null);
  readonly musicOn = computed(() => this.status.modules()?.music === true);
  readonly moduleRows = computed(() => {
    const modules = this.status.modules();
    if (!modules) return [];
    return MODULE_ORDER.map((id) => ({ id, on: modules[id] === true }));
  });
  readonly railOptions = computed(() => {
    const modules = this.status.modules();
    return RAIL_OPTIONS.filter((item) => item.module === null || modules?.[item.module] === true);
  });
  readonly tocItems = computed<TocItem[]>(() => [
    { id: 's-table', label: 'settingsPage.section.table' },
    { id: 's-combat', label: 'combat.settings.heading' },
    ...(this.musicOn() ? [{ id: 's-music', label: 'nav.music' as TranslationKey }] : []),
    { id: 's-appearance', label: 'settings.appearance' },
    { id: 's-update', label: 'update.section' },
    { id: 's-checks', label: 'settings.checks' },
    { id: 's-about', label: 'settings.about' },
  ]);
  /** The table of contents while a search is active: only the matching sections. */
  readonly visibleToc = computed<TocItem[]>(() => {
    const ids = this.searchIds();
    return ids === null ? this.tocItems() : this.tocItems().filter((item) => ids.includes(item.id));
  });
  readonly searchCount = computed(() => this.searchIds()?.length ?? 0);

  private observer: IntersectionObserver | null = null;

  constructor() {
    effect(() => {
      this.prefs.slug();
      const saved = readTextScale(this.prefs);
      untracked(() => this.textScale.set(saved));
    });
    afterNextRender(() => this.startScrollSpy());
    afterRenderEffect(() => {
      this.tocItems();
      untracked(() => {
        this.observeSections();
        this.openFragment();
      });
    });
    inject(DestroyRef).onDestroy(() => this.observer?.disconnect());
    void this.loadChecks();
  }

  t(key: TranslationKey, params?: Record<string, string | number>): string {
    return this.i18n.t(key, params);
  }

  themeLabel(option: ThemePref): string {
    return this.t(option === 'system' ? 'theme.system' : option === 'light' ? 'theme.light' : 'theme.dark');
  }

  /** Short label for the segmented control; the full label stays in titles and aria-labels. */
  themeShortLabel(option: ThemePref): string {
    return this.t(option === 'system' ? 'theme.systemShort' : option === 'light' ? 'theme.light' : 'theme.dark');
  }

  isTheme(option: ThemePref): boolean {
    return this.theme.pref() === option;
  }

  /** ThemeService cycles system -> light -> dark; step until the chosen value is reached. */
  setTheme(option: ThemePref): void {
    for (let step = 0; step < 3 && this.theme.pref() !== option; step++) this.theme.cycle();
  }

  onScale(raw: string): void {
    const percent = clampTextScale(Number(raw));
    this.textScale.set(percent);
    this.prefs.set(TEXT_SCALE_KEY, String(percent));
    applyTextScale(percent);
  }

  async loadChecks(): Promise<void> {
    try {
      this.checks.set(await this.api.checks());
      this.checkError.set(null);
    } catch (failure) {
      this.checkError.set(isApiFailure(failure) ? failure.error : this.i18n.t('errors.generic'));
    }
  }

  async runChecks(): Promise<void> {
    if (this.checking()) return;
    this.checking.set(true);
    try {
      this.checks.set(await this.api.runChecks());
      this.checkError.set(null);
    } catch (failure) {
      this.checkError.set(isApiFailure(failure) ? failure.error : this.i18n.t('errors.generic'));
    } finally {
      this.checking.set(false);
    }
  }

  moduleLabel(id: ModuleId): string {
    return this.t(`settings.module.${id}` as TranslationKey);
  }

  /** Plain sentence for one broken link. */
  linkLine(from: string, to: string): string {
    return this.t('settings.linkLine', { from, to });
  }

  // Update section.

  /** The news of the pending update, as plain blocks. */
  readonly news = computed<NewsBlock[]>(() => {
    const text = this.updates.status()?.news;
    return text ? parseNews(text) : [];
  });
  /** True while the update runs: the actions wait. */
  readonly updateBusy = computed(() => {
    const state = this.updates.status()?.state;
    return state === 'updating' || state === 'restarting';
  });

  checkUpdate(): void {
    void this.updates.check();
  }

  /** "Update": with open sessions the confirmation list comes first; nothing is sent until it is confirmed. */
  applyUpdate(): void {
    this.updates.requestApply();
  }

  confirmUpdate(): void {
    void this.updates.apply(true);
  }

  cancelUpdate(): void {
    this.updates.cancelApply();
  }

  retryUpdate(): void {
    void this.updates.retry();
  }

  snoozeUpdate(): void {
    void this.updates.snooze();
  }

  blockedText(reason: NonNullable<UpdateStatus['blockedReason']>): string {
    return this.t(BLOCKED_REASON_KEYS[reason]);
  }

  readonly scaleLabel = computed(() => this.t('settings.textSizeValue', { percent: this.textScale() }));

  // Sections: reset and default state. `ui` is the Appearance section.

  /** True when the settings file sets nothing that belongs to the section. */
  sectionIsDefault(section: SectionKey): boolean {
    return !this.settingsService.explicit().some((path) => this.ownsPath(section, path));
  }

  private ownsPath(section: SectionKey, path: string): boolean {
    if (section === 'table') return path.startsWith('live.') || path === 'combat.model';
    if (section === 'combat') return path.startsWith('combat.') && path !== 'combat.model';
    return path.startsWith(`${section}.`);
  }

  /** Table owns the live model and the combat model; both go back to their defaults. */
  resetTable(): void {
    this.settingsService.update({ live: this.defaults().live, combat: { model: this.defaults().combat.model } });
  }

  /** Combat resets everything except the model, which belongs to the Table section. */
  resetCombat(): void {
    this.settingsService.update({ combat: { ...this.defaults().combat, model: this.shown().combat.model } });
  }

  resetSection(section: 'music' | 'ui'): void {
    this.settingsService.reset(section);
  }

  // Changes. Each one is queued by SettingsService and saved after a short pause.

  setLive(patch: NonNullable<ScreenSettingsPatch['live']>): void {
    this.settingsService.update({ live: patch });
  }

  setCombat(patch: NonNullable<ScreenSettingsPatch['combat']>): void {
    this.settingsService.update({ combat: patch });
  }

  setMusic(patch: NonNullable<ScreenSettingsPatch['music']>): void {
    this.settingsService.update({ music: patch });
  }

  setUi(patch: NonNullable<ScreenSettingsPatch['ui']>): void {
    this.settingsService.update({ ui: patch });
  }

  togglePanel(key: PanelKey): void {
    const panels = this.shown().combat.panels;
    this.setCombat({ panels: { ...panels, [key]: !panels[key] } });
  }

  toggleRail(key: RailKey): void {
    const rail = this.shown().ui.rail;
    this.setUi({ rail: { ...rail, [key]: !rail[key] } });
  }

  onAutoHideSeconds(raw: string): void {
    this.setCombat({ autoHideSeconds: Number(raw) });
  }

  onVolume(raw: string): void {
    this.setMusic({ volume: Number(raw) });
  }

  onFadeSeconds(raw: string): void {
    this.setMusic({ fadeSeconds: Number(raw) });
  }

  /** First click asks for a second one for a few seconds; the second click stops the master screen. */
  onQuitClick(): void {
    if (this.quitDone() || this.quitting()) return;
    if (!this.quitArmed()) {
      this.quitArmed.set(true);
      this.clearQuitTimer();
      this.quitTimer = setTimeout(() => this.quitArmed.set(false), QUIT_CONFIRM_MS);
      return;
    }
    this.clearQuitTimer();
    this.quitArmed.set(false);
    this.quitting.set(true);
    // The server exits after answering, so a failed request usually means it already stopped.
    const finish = () => {
      this.quitting.set(false);
      this.quitDone.set(true);
    };
    this.api.shutdown().then(finish, finish);
  }

  private clearQuitTimer(): void {
    if (this.quitTimer !== null) clearTimeout(this.quitTimer);
    this.quitTimer = null;
  }

  // Scroll spy and table of contents.

  private startScrollSpy(): void {
    if (typeof IntersectionObserver === 'undefined') return;
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) this.activeId.set(entry.target.id);
        }
      },
      { rootMargin: '-20% 0px -70% 0px' },
    );
    this.observeSections();
  }

  private observeSections(): void {
    const observer = this.observer;
    if (!observer) return;
    observer.disconnect();
    this.host.nativeElement.querySelectorAll<HTMLElement>('section[id]').forEach((section) => observer.observe(section));
  }

  jump(event: Event, id: string): void {
    event.preventDefault();
    this.activeId.set(id);
    this.expandSection(id);
    const target = this.host.nativeElement.querySelector<HTMLElement>(`#${id}`);
    target?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }

  // Search.

  /** Filters the sections by the text typed; the search is applied to what the page shows now. */
  onSearch(value: string): void {
    this.query.set(value);
    this.searchIds.set(this.searchActive() ? this.matchingIds(value) : null);
  }

  clearSearch(): void {
    this.query.set('');
    this.searchIds.set(null);
    this.searchField?.nativeElement.focus();
  }

  private matchingIds(filter: string): string[] {
    const ids: string[] = [];
    this.host.nativeElement.querySelectorAll<HTMLElement>('section[id]').forEach((section) => {
      if (sectionMatches(section.textContent ?? '', filter)) ids.push(section.id);
    });
    return ids;
  }

  isShown(id: string): boolean {
    const ids = this.searchIds();
    return ids === null || ids.includes(id);
  }

  /** The `/` key focuses the search, unless the master is already typing or a dialog is open. */
  @HostListener('document:keydown', ['$event'])
  onSlashKey(event: KeyboardEvent): void {
    if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
    if (isTextEntry(event.target) || document.querySelector('dialog[open], [aria-modal="true"]') !== null) return;
    event.preventDefault();
    this.searchField?.nativeElement.focus();
  }

  // Collapsing.

  /** A section is open while a search is active, wherever the master folded it. */
  isCollapsed(id: string): boolean {
    return !this.searchActive() && this.collapsed().includes(id);
  }

  /** Opens or closes one section. Ignored while a search is active. */
  toggleSection(id: string): void {
    if (this.searchActive()) return;
    const list = this.collapsed();
    this.setCollapsed(list.includes(id) ? list.filter((item) => item !== id) : [...list, id]);
  }

  collapseAll(): void {
    this.setCollapsed(this.tocItems().map((item) => item.id));
  }

  expandAll(): void {
    this.setCollapsed([]);
  }

  private expandSection(id: string): void {
    if (this.collapsed().includes(id)) this.setCollapsed(this.collapsed().filter((item) => item !== id));
  }

  private setCollapsed(list: string[]): void {
    this.collapsed.set(list);
    writeCollapsed(list);
  }

  /** The "Changed" dot: only for the sections that have a Reset button, and only when they differ from the defaults. */
  isChanged(id: string): boolean {
    const key = RESETTABLE[id];
    return key !== undefined && !this.sectionIsDefault(key);
  }

  // Deep link: `/settings#s-appearance` opens that section and scrolls to it, once it is on the page.

  private openFragment(): void {
    const id = this.pendingFragment;
    if (id === null || !this.tocItems().some((item) => item.id === id)) return;
    const target = this.host.nativeElement.querySelector<HTMLElement>(`#${id}`);
    if (!target) return;
    this.pendingFragment = null;
    this.expandSection(id);
    target.scrollIntoView?.({ block: 'start' });
  }
}
