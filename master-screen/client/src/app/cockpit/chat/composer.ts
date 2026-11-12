import { Component, inject, output, signal } from "@angular/core";
import { I18n } from "../../i18n";
import { FormsModule } from "@angular/forms";
import { Icon } from "../support/icon";
export function isSubmitKey(event: KeyboardEvent) {
  return event.key === "Enter" && !event.shiftKey && !event.isComposing;
}
@Component({
  selector: "cockpit-composer",
  standalone: true,
  imports: [FormsModule, Icon],
  templateUrl: "./composer.html",
  styleUrl: "./composer.css",
})
export class Composer {
  readonly i18n = inject(I18n);
  send = output<string>();
  draft = signal("");
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
    }
  }
  resize(target: HTMLTextAreaElement) {
    target.style.height = "auto";
    target.style.height = `${Math.min(target.scrollHeight, 144)}px`;
  }
}
