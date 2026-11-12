import {
  Component,
  DestroyRef,
  ElementRef,
  ViewEncapsulation,
  afterRenderEffect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { EyeOff, LucideAngularModule } from 'lucide-angular';
import type { DocBlock } from '@shared/types';
import { I18n, type TranslationKey } from '../i18n';
import { currentTheme, drawDiagrams, loadMermaidEngine, watchTheme } from './mermaid';

/**
 * The text of a document: its blocks in order. Master blocks are marked with an icon, a tint,
 * a left border and a visually hidden label. The HTML is the server's sanitized output.
 */
@Component({
  selector: 'ms-doc-body',
  imports: [LucideAngularModule],
  // Global on purpose: the body is server HTML, which component styles cannot reach.
  encapsulation: ViewEncapsulation.None,
  styleUrl: './doc-body.css',
  template: `
    @for (block of blocks(); track $index) {
      <section class="block" [class.block-master]="block.kind === 'master'">
        @if (block.kind === 'master') {
          <div class="master-mark">
            <span class="mark-icon" role="img" [attr.title]="masterLabel()" [attr.aria-label]="masterLabel()">
              <lucide-angular [img]="icons.EyeOff" [size]="16" aria-hidden="true" />
            </span>
            <span class="sr-only">{{ masterLabel() }}</span>
          </div>
        }
        <div class="block-body" [innerHTML]="block.html"></div>
      </section>
    }
  `,
})
export class DocBody {
  private readonly i18n = inject(I18n);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly icons = { EyeOff };
  readonly blocks = input.required<DocBlock[]>();
  /** Bumped when the effective theme changes, so the diagrams are drawn again. */
  private readonly themeTick = signal(0);

  constructor() {
    const stop = watchTheme(() => this.themeTick.update((value) => value + 1));
    inject(DestroyRef).onDestroy(stop);
    // Runs after each render of the blocks and after each theme change; diagrams are
    // only drawn (and mermaid only loaded) when the document has one.
    afterRenderEffect(() => {
      this.blocks();
      this.themeTick();
      untracked(() => {
        void drawDiagrams(this.host.nativeElement, {
          engine: loadMermaidEngine,
          theme: currentTheme,
          errorText: this.i18n.t('reader.diagramError'),
        });
      });
    });
  }

  masterLabel(): string {
    return this.i18n.t('reader.masterOnly');
  }
}
