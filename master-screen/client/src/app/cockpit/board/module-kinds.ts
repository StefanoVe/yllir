import type { ModuleKind } from "@shared/cockpit-types";
import type { TranslationKey } from "../../i18n";

/** Icon name (see support/icon.ts) and translation key of each kind of card. */
export const MODULE_KINDS: Record<
  ModuleKind,
  { icon: string; label: TranslationKey }
> = {
  npc: { icon: "person", label: "liveAgent.kind.npc" },
  pc: { icon: "users", label: "liveAgent.kind.pc" },
  lore: { icon: "book", label: "liveAgent.kind.lore" },
  enemy: { icon: "enemy", label: "liveAgent.kind.enemy" },
  item: { icon: "item", label: "liveAgent.kind.item" },
  location: { icon: "place", label: "liveAgent.kind.location" },
  map: { icon: "map", label: "liveAgent.kind.map" },
  battlemap: { icon: "map", label: "liveAgent.kind.battlemap" },
  music: { icon: "track", label: "liveAgent.kind.music" },
  plot: { icon: "route", label: "liveAgent.kind.plot" },
  image: { icon: "eye", label: "liveAgent.kind.image" },
  note: { icon: "file", label: "liveAgent.kind.note" },
};
export const LEDGER_ICONS: Record<string, string> = {
  decision: "check",
  intention: "intention",
  open: "flag",
  fact: "fact",
};
