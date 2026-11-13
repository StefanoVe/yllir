import { Component, computed, input, output } from '@angular/core';

/**
 * A calm custom slider: a thin rail with a fill, and a native range input laid over it, so the
 * keyboard and screen readers still get a real slider. The fill follows `value` (the server's
 * position or volume); with `ticks` the rail is a row of ticks, the seek line of the bar.
 */
@Component({
  selector: 'ms-music-slider',
  template: `
    <span class="rail" [class.ticks]="ticks()" [class.animated]="animated()" aria-hidden="true">
      <span class="fill" [style.width.%]="percent()"></span>
    </span>
    <input class="range" type="range" [min]="0" [max]="max()" [step]="step()" [value]="value()"
           [disabled]="disabled()" [attr.aria-label]="label()" [attr.aria-valuetext]="valueText()"
           (input)="onInput($event)" />
  `,
  styleUrl: './music-slider.css',
  host: { class: 'slider', '[class.is-disabled]': 'disabled()' },
})
export class MusicSlider {
  readonly value = input.required<number>();
  readonly max = input(100);
  readonly step = input(1);
  readonly label = input.required<string>();
  readonly valueText = input('');
  readonly disabled = input(false);
  /** Draw the rail as ticks (the seek line of the bar). */
  readonly ticks = input(false);
  /** The fill moves smoothly; only while the track plays. */
  readonly animated = input(false);
  /** The user moved the slider. */
  readonly moved = output<number>();

  readonly percent = computed(() => {
    const max = this.max();
    return max > 0 ? Math.min(100, Math.max(0, (this.value() / max) * 100)) : 0;
  });

  onInput(event: Event): void {
    this.moved.emit(Number((event.target as HTMLInputElement).value));
  }
}
