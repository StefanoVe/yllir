import {
  Component,
  OnDestroy,
  input,
  output,
  signal,
} from "@angular/core";
import { Icon } from "./icon";

/** How long the armed button waits for the second click before it disarms. */
export const CONFIRM_WINDOW_MS = 4000;

/**
 * A button that asks for a second click instead of a native dialog (native confirm() does not
 * show in every embedded browser). The first click arms it and shows `confirmLabel`; a second
 * click within the window emits `confirmed`. Waiting out the window, Escape or blur disarms it.
 */
@Component({
  selector: "ui-confirm-button",
  imports: [Icon],
  templateUrl: "./confirm-button.html",
  styleUrl: "./confirm-button.css",
})
export class ConfirmButton implements OnDestroy {
  icon = input.required<string>();
  size = input(16);
  label = input.required<string>();
  confirmLabel = input.required<string>();
  disabled = input(false);
  buttonClass = input("icon-button");
  confirmed = output<void>();

  readonly armed = signal(false);
  private timer: ReturnType<typeof setTimeout> | null = null;

  onClick(): void {
    if (this.disabled()) return;
    if (!this.armed()) {
      this.arm();
      return;
    }
    this.disarm();
    this.confirmed.emit();
  }

  /** Escape disarms an armed button and stops there, so it does not also close the overlay. */
  onEscape(event: Event): void {
    if (!this.armed()) return;
    event.stopPropagation();
    this.disarm();
  }

  ngOnDestroy(): void {
    this.clearTimer();
  }

  private arm(): void {
    this.clearTimer();
    this.armed.set(true);
    this.timer = setTimeout(() => this.disarm(), CONFIRM_WINDOW_MS);
  }

  disarm(): void {
    this.clearTimer();
    this.armed.set(false);
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}
