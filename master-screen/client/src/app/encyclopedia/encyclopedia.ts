import { Component, computed, inject, signal } from '@angular/core';
import {
  CircleCheck,
  CircleDashed,
  CircleMinus,
  CircleX,
  ExternalLink,
  Hammer,
  LoaderCircle,
  LucideAngularModule,
  RefreshCw,
  TriangleAlert,
} from 'lucide-angular';
import type {
  EncyclopediaChangeItem,
  EncyclopediaChanges,
  EncyclopediaCheck,
  EncyclopediaKind,
  EncyclopediaReport,
  EncyclopediaSettings,
  EncyclopediaStatus,
} from '@shared/types';
import { I18n, type TranslationKey } from '../i18n';
import { CallFailure } from './call-json';
import { EncyclopediaApiService, reportFromBody } from './encyclopedia-api.service';

/** Kinds in their fixed order: the saved payload always uses it, so the order never looks like a change. */
export const KIND_ORDER: EncyclopediaKind[] = ['place', 'character', 'creature', 'item', 'faction', 'event'];

/** What a new campaign starts with: items only. Used when the server sends no settings yet. */
export const NEW_CAMPAIGN_SETTINGS: EncyclopediaSettings = { kinds: ['item'], flavourText: true, list: 'full' };

/** Where the page is, in plain words. Each state has its own sentence and badge, never colour alone. */
export type CodexState = 'loading' | 'off' | 'never' | 'failed' | 'outOfDate' | 'upToDate';
type Tab = 'status' | 'preview';
type OpenList = 'excluded' | 'checks' | 'warnings';

const TABS: Tab[] = ['status', 'preview'];
const TAB_KEY = 'codex.tab';

/** Fixed kind order, deduplicated, so two lists with the same kinds compare equal. */
export function canonicalSettings(settings: EncyclopediaSettings): EncyclopediaSettings {
  return {
    kinds: KIND_ORDER.filter((kind) => settings.kinds.includes(kind)),
    flavourText: settings.flavourText,
    list: settings.list,
  };
}

/** Same kinds (as a set), same switch, same list choice. */
export function sameSettings(a: EncyclopediaSettings, b: EncyclopediaSettings): boolean {
  const left = canonicalSettings(a);
  const right = canonicalSettings(b);
  return (
    left.kinds.length === right.kinds.length &&
    left.kinds.every((kind, index) => kind === right.kinds[index]) &&
    left.flavourText === right.flavourText &&
    left.list === right.list
  );
}

/** The file name without its folders and without `.md`: the title of an entry when the report has no title. */
export function entryName(path: string): string {
  const file = path.split(/[\\/]/).pop() ?? path;
  return file.replace(/\.md$/i, '');
}

/** The status dashboard of the Codex (`/encyclopedia`): status, KPIs, changes, settings and the preview tab. */
@Component({
  selector: 'ms-encyclopedia',
  imports: [LucideAngularModule],
  templateUrl: './encyclopedia.html',
  styleUrl: './encyclopedia.css',
})
export class EncyclopediaPage {
  private readonly api = inject(EncyclopediaApiService);
  private readonly i18n = inject(I18n);

  readonly icons = {
    CircleCheck,
    CircleDashed,
    CircleMinus,
    CircleX,
    ExternalLink,
    Hammer,
    LoaderCircle,
    RefreshCw,
    TriangleAlert,
  };
  readonly kindOrder = KIND_ORDER;

  /** What the server said about the module and the last build. */
  readonly status = signal<EncyclopediaStatus | null>(null);
  readonly loadError = signal<string | null>(null);
  /** The report the server returned for the last build (or the saved one). Never set before the server answers. */
  readonly report = signal<EncyclopediaReport | null>(null);
  readonly building = signal(false);
  /** Plain message of a failed build. Set only when the last build in this session failed. */
  readonly buildError = signal<string | null>(null);

  readonly tab = signal<Tab>(this.rememberedTab());
  readonly openList = signal<OpenList | null>(null);

  /** Local editable copy of the settings. Null until the status arrives. */
  readonly draft = signal<EncyclopediaSettings | null>(null);
  readonly saving = signal(false);
  readonly saveError = signal<string | null>(null);
  readonly saved = signal(false);
  /** True after a save until the next build: used only when the report carries no settings to compare with. */
  private readonly settingsSavedSinceBuild = signal(false);

  readonly enabled = computed(() => this.status()?.enabled === true);
  readonly built = computed(() => this.status()?.built === true);
  readonly changes = computed<EncyclopediaChanges | null>(() => this.status()?.changes ?? null);
  readonly savedSettings = computed<EncyclopediaSettings>(() => this.status()?.settings ?? NEW_CAMPAIGN_SETTINGS);

  readonly changeCount = computed(() => {
    const changes = this.changes();
    return changes ? changes.added.length + changes.changed.length + changes.removed.length : 0;
  });

  readonly settingsDiffer = computed(() => {
    const reported = this.report()?.settings;
    return reported ? !sameSettings(reported, this.savedSettings()) : this.settingsSavedSinceBuild();
  });

  readonly state = computed<CodexState>(() => {
    if (!this.status()) return 'loading';
    if (!this.enabled()) return 'off';
    if (this.buildError() !== null || this.report()?.ok === false) return 'failed';
    if (!this.built()) return 'never';
    if (this.changeCount() > 0 || this.settingsDiffer()) return 'outOfDate';
    return 'upToDate';
  });

  readonly dirty = computed(() => {
    const draft = this.draft();
    return draft !== null && !sameSettings(draft, this.savedSettings());
  });
  readonly canSave = computed(() => this.dirty() && (this.draft()?.kinds.length ?? 0) > 0 && !this.saving());

  /** The preview needs a built site; a remembered Preview tab falls back to Status when there is none. */
  readonly activeTab = computed<Tab>(() => (this.tab() === 'preview' && !this.built() ? 'status' : this.tab()));

  readonly flavourOff = computed(() => this.enabled() && this.savedSettings().flavourText === false);

  /** Checks that did not pass: the failing ones first, then the skipped ones. */
  readonly checksToFix = computed<EncyclopediaCheck[]>(() => {
    const checks = this.report()?.checks ?? [];
    return [...checks.filter((c) => c.status === 'fail'), ...checks.filter((c) => c.status === 'skipped')];
  });
  readonly failingCount = computed(() => (this.report()?.checks ?? []).filter((c) => c.status === 'fail').length);

  readonly lastUpdate = computed(() => {
    const generatedAt = this.report()?.generatedAt;
    if (!generatedAt) return null;
    const date = new Date(generatedAt);
    if (Number.isNaN(date.getTime())) return null;
    return new Intl.DateTimeFormat(this.i18n.language(), { dateStyle: 'short', timeStyle: 'short' }).format(date);
  });

  constructor() {
    void this.load();
  }

  t(key: TranslationKey, params?: Record<string, string | number>): string {
    return this.i18n.t(key, params);
  }

  /** GET /api/encyclopedia */
  async load(): Promise<void> {
    try {
      const next = await this.api.status();
      // The local copy follows the saved settings, unless the master has unsaved edits of his own.
      const previous = this.status()?.settings ?? NEW_CAMPAIGN_SETTINGS;
      const draft = this.draft();
      if (draft === null || sameSettings(draft, previous)) {
        this.draft.set(canonicalSettings(next.settings ?? NEW_CAMPAIGN_SETTINGS));
      }
      this.status.set(next);
      // Keep the report the server just returned for a build when the saved status has none.
      this.report.set(next.report ?? this.report());
      this.loadError.set(null);
    } catch (failure) {
      this.loadError.set(this.messageOf(failure));
    }
  }

  /** POST /api/encyclopedia/build. The screen shows only what the server returned. */
  async build(): Promise<void> {
    if (this.building()) return;
    this.building.set(true);
    this.buildError.set(null);
    try {
      const next = await this.api.build();
      this.report.set(next);
      if (next.ok) {
        this.settingsSavedSinceBuild.set(false);
        await this.load();
      } else {
        this.buildError.set(this.t('codex.state.failed'));
      }
    } catch (failure) {
      // A failed build carries its report in the body, next to the plain message.
      const report = failure instanceof CallFailure ? reportFromBody(failure.body) : null;
      if (report) this.report.set(report);
      this.buildError.set(this.messageOf(failure));
    } finally {
      this.building.set(false);
    }
  }

  /** PUT /api/encyclopedia/settings. Saving does not rebuild: the state becomes out of date. */
  async save(): Promise<void> {
    const draft = this.draft();
    if (!draft || !this.canSave()) return;
    const payload = canonicalSettings(draft);
    this.saving.set(true);
    this.saveError.set(null);
    this.saved.set(false);
    try {
      const next = await this.api.saveSettings(payload);
      this.status.set(next);
      this.report.set(next.report ?? this.report());
      this.draft.set(canonicalSettings(next.settings ?? payload));
      this.settingsSavedSinceBuild.set(true);
      this.saved.set(true);
    } catch (failure) {
      this.saveError.set(this.messageOf(failure));
    } finally {
      this.saving.set(false);
    }
  }

  toggleKind(kind: EncyclopediaKind, checked: boolean): void {
    const draft = this.draft();
    if (!draft) return;
    const kinds = KIND_ORDER.filter((item) => (item === kind ? checked : draft.kinds.includes(item)));
    this.draft.set({ ...draft, kinds });
    this.saved.set(false);
  }

  toggleFlavour(): void {
    const draft = this.draft();
    if (!draft) return;
    this.draft.set({ ...draft, flavourText: !draft.flavourText });
    this.saved.set(false);
  }

  setList(list: EncyclopediaSettings['list']): void {
    const draft = this.draft();
    if (!draft) return;
    this.draft.set({ ...draft, list });
    this.saved.set(false);
  }

  /** Opens one list under the KPI row; opening another one closes the first. */
  toggleList(list: OpenList): void {
    this.openList.set(this.openList() === list ? null : list);
  }

  selectTab(tab: Tab, focus = false): void {
    if (tab === 'preview' && !this.built()) return;
    this.tab.set(tab);
    this.rememberTab(tab);
    if (focus) {
      queueMicrotask(() => document.getElementById(`codex-tab-${tab}`)?.focus());
    }
  }

  /** Arrow keys, Home and End move between the enabled tabs (the disabled Preview tab is skipped). */
  onTabKeydown(event: KeyboardEvent): void {
    const enabled = TABS.filter((tab) => tab === 'status' || this.built());
    const current = enabled.indexOf(this.activeTab());
    let next: number | null = null;
    if (event.key === 'ArrowRight') next = (current + 1) % enabled.length;
    else if (event.key === 'ArrowLeft') next = (current - 1 + enabled.length) % enabled.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = enabled.length - 1;
    if (next === null) return;
    event.preventDefault();
    this.selectTab(enabled[next], true);
  }

  listTitle(list: OpenList): string {
    return this.t(list === 'excluded' ? 'codex.list.excluded' : list === 'checks' ? 'codex.list.checks' : 'codex.list.warnings');
  }

  /** The three groups of the changes block, in their fixed order. */
  changeGroups(changes: EncyclopediaChanges): { key: string; label: string; items: EncyclopediaChangeItem[] }[] {
    return [
      { key: 'added', label: this.t('codex.changes.added'), items: changes.added },
      { key: 'changed', label: this.t('codex.changes.changed'), items: changes.changed },
      { key: 'removed', label: this.t('codex.changes.removed'), items: changes.removed },
    ];
  }

  kindLabel(kind: EncyclopediaKind): string {
    return this.t(`codex.kind.${kind}` as TranslationKey);
  }

  /** Names of the list rows: the plain title when the report has one, otherwise the file name. */
  rowName(path: string): string {
    return entryName(path);
  }

  checkIcon(status: EncyclopediaCheck['status']) {
    return status === 'pass' ? this.icons.CircleCheck : status === 'fail' ? this.icons.CircleX : this.icons.CircleMinus;
  }

  checkText(status: EncyclopediaCheck['status']): string {
    return status === 'fail' ? this.t('codex.check.fail') : this.t('codex.check.skipped');
  }

  stateIcon(state: CodexState) {
    switch (state) {
      case 'upToDate':
        return this.icons.CircleCheck;
      case 'outOfDate':
        return this.icons.RefreshCw;
      case 'failed':
        return this.icons.CircleX;
      case 'never':
        return this.icons.CircleDashed;
      case 'off':
        return this.icons.CircleMinus;
      default:
        return this.icons.LoaderCircle;
    }
  }

  stateBadge(state: CodexState): string {
    const keys: Record<CodexState, TranslationKey> = {
      loading: 'codex.state.loading',
      off: 'codex.badge.off',
      never: 'codex.badge.never',
      failed: 'codex.badge.failed',
      outOfDate: 'codex.badge.outOfDate',
      upToDate: 'codex.badge.upToDate',
    };
    return this.t(keys[state]);
  }

  stateSentence(state: CodexState): string {
    const keys: Record<CodexState, TranslationKey> = {
      loading: 'codex.state.loading',
      off: 'codex.state.off',
      never: 'codex.state.never',
      failed: 'codex.state.failed',
      outOfDate: 'codex.state.outOfDate',
      upToDate: 'codex.state.upToDate',
    };
    return this.t(keys[state]);
  }

  private rememberedTab(): Tab {
    try {
      const stored = localStorage.getItem(TAB_KEY);
      return stored === 'preview' ? 'preview' : 'status';
    } catch {
      return 'status';
    }
  }

  private rememberTab(tab: Tab): void {
    try {
      localStorage.setItem(TAB_KEY, tab);
    } catch {
      // Storage can be blocked; the tab then simply starts on Status next time.
    }
  }

  private messageOf(failure: unknown): string {
    return failure instanceof Error && failure.message !== '' ? failure.message : this.t('errors.generic');
  }
}
