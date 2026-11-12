import {
  Component,
  ElementRef,
  computed,
  effect,
  input,
  inject,
  output,
  signal,
  untracked,
  viewChild,
} from "@angular/core";
import { Icon } from "../support/icon";
import { CockpitService } from "../cockpit.service";
import { DocumentsService } from "../support/documents.service";
import { ViewerService } from "../support/viewer.service";
import type {
  BoardModuleView,
  CockpitAction,
  CockpitSessionView,
  LayoutItem,
  ModuleKind,
  SourceRef,
} from "@shared/cockpit-types";
import type { DocSummary } from "@shared/types";
import { MODULE_KINDS } from "./module-kinds";
import { Ledger } from "./ledger";
import { CombatView } from "./combat";
import { CockpitCanvas } from "../canvas/canvas";
import { MusicPlayerService } from "../../music/music-player.service";
import { MusicApiService } from "../../music/music-api.service";
import { StatusService } from "../../core/status.service";
import { I18n, type TranslationKey } from "../../i18n";

type Panel = "ledger" | "combat" | null;

const DOC_KINDS: Record<string, ModuleKind> = {
  NPCs: "npc",
  Players: "pc",
  Enemies: "enemy",
  Items: "item",
  World: "location",
  Lore: "lore",
  Plot: "plot",
};

function normalizeText(text: string) {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

@Component({
  selector: "cockpit-board",
  imports: [Icon, CockpitCanvas, Ledger, CombatView],
  templateUrl: "./board.html",
  styleUrl: "./board.css",
})
export class Board {
  openSource = input<(source: SourceRef) => void>(() => {});
  api = inject(CockpitService);
  readonly i18n = inject(I18n);
  private musicPlayer = inject(MusicPlayerService);
  private musicApi = inject(MusicApiService);
  private status = inject(StatusService);
  documents = inject(DocumentsService);
  viewer = inject(ViewerService);
  /** Music controls exist only when the campaign has the music module on. */
  musicOn = computed(() => !!this.status.modules()?.music);
  /** Session management lives in a modal owned by the cockpit. */
  openSessions = output<void>();
  error = signal("");
  session = computed(() => this.api.session());
  latestIds = computed(
    () =>
      new Set(
        (this.api
          .lastGroup()
          ?.actions.map((a) => a.targetId)
          .filter(Boolean) as string[]) || [],
      ),
  );

  /** Side panel over the canvas: only one at a time, never persisted. */
  panel = signal<Panel>(null);
  private addInput = viewChild<ElementRef<HTMLInputElement>>("addInput");
  /** Canvas point where a document is being added; null when closed. */
  addAt = signal<{ x: number; y: number } | null>(null);
  addQuery = signal("");
  addIndex = signal(0);
  addResults = computed(() => {
    if (!this.addAt()) return [];
    const query = normalizeText(this.addQuery().trim());
    return this.documents
      .docs()
      .filter((doc) =>
        normalizeText(`${doc.title} ${doc.path}`).includes(query),
      )
      .slice(0, 8);
  });

  private combatWasActive = false;
  private combatSessionId = "";

  constructor() {
    // A combat that starts opens its panel; switching session never does.
    effect(() => {
      const s = this.session();
      const active = !!s?.state.combat;
      untracked(() => {
        const sameSession = s?.id === this.combatSessionId;
        this.combatSessionId = s?.id || "";
        if (!sameSession) {
          this.combatWasActive = active;
          return;
        }
        if (active && !this.combatWasActive) this.panel.set("combat");
        if (!active && this.panel() === "combat") this.panel.set(null);
        this.combatWasActive = active;
      });
    });
  }

  togglePanel(panel: Exclude<Panel, null>) {
    this.panel.set(this.panel() === panel ? null : panel);
  }

  async undo() {
    const group = this.api.lastGroup();
    if (group)
      try {
        await this.api.undo(group);
      } catch (e) {
        this.error.set(String(e));
      }
  }
  async apply(action: CockpitAction) {
    await this.applyMany([action]);
  }
  async applyMany(actions: CockpitAction[]) {
    try {
      await this.api.action(...actions);
    } catch (e) {
      this.error.set(String(e));
    }
  }
  async layout(items: LayoutItem[]) {
    try {
      await this.api.layout(items);
    } catch (e) {
      this.error.set(String(e));
    }
  }
  openModule(module: BoardModuleView) {
    const ref = module.ref;
    if (ref.type === "doc")
      this.openSource()({ path: ref.path, anchor: ref.anchor });
    else if (ref.type === "asset") this.openSource()({ path: ref.path });
    else if (ref.type === "image") {
      if (module.content.image) this.viewer.openImage(module.content.image);
    } else if (ref.type === "track") this.play(ref.trackId);
  }
  openFullscreen(module: BoardModuleView) {
    if (module.content.image)
      this.viewer.openImage(module.content.image, null, { fullscreen: true });
  }
  /**
   * Plays a track of the music library, or stops it when it is the one playing.
   * Tracks come from the same list as the music page; nothing plays when music is off.
   */
  async play(trackId: string) {
    if (!this.musicOn()) return;
    const current = this.musicPlayer.current();
    if (current?.id === trackId) {
      this.musicPlayer.toggle();
      return;
    }
    try {
      const { tracks } = await this.musicApi.tracks("");
      const track = tracks.find((t) => t.id === trackId);
      if (track) this.musicPlayer.playTrack(track, tracks);
    } catch (e) {
      this.error.set(String(e));
    }
  }
  async uploadImage({ file, x, y }: { file: File; x: number; y: number }) {
    try {
      const name = await this.api.upload(file);
      await this.api.action({
        type: "module.show",
        module: {
          kind: "image",
          ref: { type: "image", path: name },
          reason: this.i18n.t("liveAgent.reasonImage"),
          x,
          y,
        },
      });
    } catch (e) {
      this.error.set(String(e));
    }
  }
  startAddDoc(at: { x: number; y: number }) {
    this.addQuery.set("");
    this.addIndex.set(0);
    this.addAt.set(at);
    if (!this.documents.docs().length)
      void this.documents.loadIndex().catch((e) => this.error.set(String(e)));
    setTimeout(() => this.addInput()?.nativeElement.focus(), 0);
  }
  setAddQuery(event: Event) {
    this.addQuery.set((event.target as HTMLInputElement).value);
    this.addIndex.set(0);
  }
  closeAddDoc() {
    this.addAt.set(null);
  }
  onAddKey(event: KeyboardEvent) {
    const results = this.addResults();
    if (event.key === "Escape") {
      event.preventDefault();
      this.closeAddDoc();
    } else if (event.key === "ArrowDown" && results.length) {
      event.preventDefault();
      this.addIndex.set((this.addIndex() + 1) % results.length);
    } else if (event.key === "ArrowUp" && results.length) {
      event.preventDefault();
      this.addIndex.set(
        (this.addIndex() - 1 + results.length) % results.length,
      );
    } else if (event.key === "Enter") {
      event.preventDefault();
      const doc = results[this.addIndex()];
      if (doc) void this.chooseDoc(doc);
    }
  }
  async chooseDoc(doc: DocSummary) {
    const at = this.addAt();
    if (!at) return;
    this.closeAddDoc();
    await this.apply({
      type: "module.show",
      module: {
        kind: this.docKind(doc.path),
        ref: { type: "doc", path: doc.path },
        reason: this.i18n.t("liveAgent.reasonAddedByMaster"),
        x: at.x,
        y: at.y,
      },
    });
  }
  docKind(path: string): ModuleKind {
    return DOC_KINDS[path.split("/")[0] || ""] || "plot";
  }
  sourceLabel(source: SourceRef) {
    const file = source.path.split("/").pop()?.replace(/\.md$/, "") || "";
    const doc = source.anchor
      ? source.anchor.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase())
      : "";
    return doc ? `${file} · ${doc}` : file;
  }
  hasScene(s: CockpitSessionView) {
    const p = s.state.position;
    return !!(
      p.location ||
      p.moment ||
      p.summary ||
      s.state.party.length ||
      p.source
    );
  }
  activeLedger = computed(
    () =>
      this.session()?.state.ledger.filter((e) => e.status === "active")
        .length || 0,
  );
  kindIcon(kind: string) {
    return MODULE_KINDS[kind as keyof typeof MODULE_KINDS]?.icon || "file";
  }
  /** Translation key of the kind's label (the kinds are fixed by the server). */
  kindLabel(kind: string): string {
    const key = MODULE_KINDS[kind as keyof typeof MODULE_KINDS]?.label;
    return key ? this.i18n.t(key as TranslationKey) : "";
  }
}
