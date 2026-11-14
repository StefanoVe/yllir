import {
  Component,
  ElementRef,
  ViewChild,
  computed,
  inject,
  output,
  signal,
} from "@angular/core";
import { I18n, type TranslationKey } from "../../i18n";
import { FormsModule } from "@angular/forms";
import { Icon } from "../support/icon";
import { TooltipDirective } from "../../core/tooltip.directive";
import {
  CockpitService,
  modelChoiceOf,
  type LiveModelChoice,
} from "../cockpit.service";
export function isSubmitKey(event: KeyboardEvent) {
  return event.key === "Enter" && !event.shiftKey && !event.isComposing;
}
@Component({
  selector: "cockpit-composer",
  standalone: true,
  imports: [FormsModule, Icon, TooltipDirective],
  templateUrl: "./composer.html",
  styleUrl: "./composer.css",
})
export class Composer {
  readonly i18n = inject(I18n);
  readonly api = inject(CockpitService);
  send = output<string>();
  @ViewChild("field") field?: ElementRef<HTMLTextAreaElement>;
  draft = signal("");
  readonly models: {
    choice: LiveModelChoice;
    label: TranslationKey;
    description: TranslationKey;
  }[] = [
    { choice: "haiku", label: "liveModel.haiku", description: "liveModel.haiku.desc" },
    { choice: "sonnet", label: "liveModel.sonnet", description: "liveModel.sonnet.desc" },
    { choice: "opus", label: "liveModel.opus", description: "liveModel.opus.desc" },
  ];
  /** The short choice of the open session's model. */
  readonly modelChoice = computed(() =>
    modelChoiceOf(this.api.session()?.model ?? ""),
  );
  key(event: KeyboardEvent) {
    if (isSubmitKey(event)) {
      event.preventDefault();
      this.submit();
    }
  }
  submit() {
    const text = this.draft().trim();
    if (text) {
      this.send.emit(text);
      this.draft.set("");
      // An empty field is back at its minimum height (the CSS min-height).
      if (this.field) this.field.nativeElement.style.height = "";
    }
  }
  changeModel(event: Event) {
    const select = event.target as HTMLSelectElement;
    const choice = select.value as LiveModelChoice;
    this.api.setModel(choice).catch((error: unknown) => {
      // Show the reason and put the selector back on the model the session really has.
      this.api.chatError.set(error instanceof Error ? error.message : String(error));
      select.value = this.modelChoice();
    });
  }
  /** Grows the field with its text; the CSS max-height (8 rows) stops it and the field scrolls. */
  resize(target: HTMLTextAreaElement) {
    target.style.height = "auto";
    target.style.height = `${target.scrollHeight}px`;
  }
}
