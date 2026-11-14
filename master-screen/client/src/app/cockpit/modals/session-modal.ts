import {
  Component,
  ElementRef,
  HostListener,
  OnInit,
  ViewEncapsulation,
  inject,
  output,
  signal,
  viewChild,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { Icon } from "../support/icon";
import { CockpitService } from "../cockpit.service";
import { I18n } from "../../i18n";
import { TooltipDirective } from "../../core/tooltip.directive";

/** Open, create and delete live sessions. Opening one loads it into the cockpit. */
@Component({
  selector: "cockpit-session-modal",
  imports: [Icon, FormsModule, TooltipDirective],
  templateUrl: "./session-modal.html",
  styleUrls: ["./modal.css", "./session-modal.css"],
  encapsulation: ViewEncapsulation.None,
})
export class SessionModal implements OnInit {
  close = output<void>();
  api = inject(CockpitService);
  readonly i18n = inject(I18n);
  private titleInput = viewChild<ElementRef<HTMLInputElement>>("titleInput");
  private returnFocus = document.activeElement as HTMLElement | null;
  title = "";
  error = signal("");
  /** Id of the session waiting for a second click to be deleted. */
  confirmDelete = signal("");
  busy = signal(false);

  ngOnInit() {
    void this.api.listSessions().catch((e) => this.error.set(String(e)));
    setTimeout(() => this.titleInput()?.nativeElement.focus(), 0);
  }

  async open(id: string) {
    try {
      await this.api.select(id);
      this.dismiss();
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    }
  }

  async create() {
    const title = this.title.trim();
    if (!title || this.busy()) return;
    this.busy.set(true);
    this.error.set("");
    try {
      const session = await this.api.create(title);
      await this.open(session.id);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.busy.set(false);
    }
  }

  async remove(id: string) {
    if (this.confirmDelete() !== id) {
      this.confirmDelete.set(id);
      return;
    }
    this.confirmDelete.set("");
    this.error.set("");
    try {
      await this.api.delete(id);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    }
  }

  updated(iso: string) {
    const date = new Date(iso);
    const locale = this.i18n.language() === "it" ? "it" : "en";
    const today = new Date().toDateString() === date.toDateString();
    return today
      ? this.i18n.t("liveAgent.today") +
          " " +
          date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })
      : date.toLocaleDateString(locale, { day: "numeric", month: "short" });
  }

  dismiss() {
    this.close.emit();
    this.returnFocus?.focus();
  }

  @HostListener("document:keydown.escape") escape() {
    this.dismiss();
  }
}
