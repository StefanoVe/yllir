import { Component, computed, inject, input, signal } from "@angular/core";
import { Icon } from "../support/icon";
import { I18n } from "../../i18n";
import type { LedgerEntry } from "@shared/cockpit-types";
import { LEDGER_ICONS } from "./module-kinds";
export function ledgerIsInactive(entry: LedgerEntry) {
  return entry.status !== "active";
}
const GROUPS = {
  decision: "liveAgent.ledger.decisions",
  intention: "liveAgent.ledger.intentions",
  open: "liveAgent.ledger.openThreads",
  fact: "liveAgent.ledger.facts",
} as const;
@Component({
  selector: "cockpit-ledger",
  standalone: true,
  imports: [Icon],
  templateUrl: "./ledger.html",
  styleUrl: "./ledger.css",
})
export class Ledger {
  entries = input<LedgerEntry[]>([]);
  latestIds = input<ReadonlySet<string>>(new Set());
  readonly i18n = inject(I18n);
  expanded = signal("");
  groups() {
    const entries = this.entries();
    return (["decision", "intention", "open", "fact"] as const)
      .map((kind) => ({
        kind,
        label: this.i18n.t(GROUPS[kind]),
        icon: LEDGER_ICONS[kind]!,
        entries: entries
          .filter((e) => e.kind === kind)
          .sort(
            (a, b) =>
              Number(ledgerIsInactive(a)) - Number(ledgerIsInactive(b)) ||
              a.updatedAt.localeCompare(b.updatedAt),
          ),
      }))
      .filter((group) => group.entries.length);
  }
  toggle(entry: LedgerEntry) {
    this.expanded.update((id) => (id === entry.id ? "" : entry.id));
  }
  inactive(entry: LedgerEntry) {
    return ledgerIsInactive(entry);
  }
}
