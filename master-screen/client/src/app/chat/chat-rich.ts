// Makes an assistant message interactive after it is rendered: diagrams are drawn, links into the
// campaign navigate inside the app, campaign images open in a lightbox, and an image that fails to
// load shows a short placeholder. The host is the element that holds the rendered HTML.

import { DestroyRef, ElementRef, Directive, afterRenderEffect, inject, input, signal, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { I18n } from '../i18n';
import { currentTheme, drawDiagrams, loadMermaidEngine, watchTheme } from '../reader/mermaid';

const LIGHTBOX_STYLE_ID = 'ms-chat-lightbox-style';
/** The lightbox sits in document.body, outside the chat's component styles, so its rules are global. */
const LIGHTBOX_CSS = `
dialog.chat-lightbox { margin: 0; padding: 0; border: 0; width: 100vw; height: 100vh; max-width: 100vw; max-height: 100vh; background: transparent; }
dialog.chat-lightbox[open] { display: flex; align-items: center; justify-content: center; }
dialog.chat-lightbox::backdrop { background: rgb(0 0 0 / 0.75); }
dialog.chat-lightbox img { max-width: 92vw; max-height: 88vh; object-fit: contain; border-radius: var(--radius-md); background: var(--color-surface); }
dialog.chat-lightbox .chat-lightbox-close { position: fixed; top: var(--space-1); right: var(--space-1); width: 40px; height: 40px; border: 1px solid var(--color-border); border-radius: 999px; background: var(--color-surface); color: var(--color-text); font: inherit; font-size: 1.5rem; line-height: 1; cursor: pointer; }
dialog.chat-lightbox .chat-lightbox-close:focus-visible { outline: 2px solid var(--color-focus); outline-offset: 2px; }
`;

interface OpenLightbox {
  dialog: HTMLDialogElement;
  figure: HTMLElement | null;
}

@Directive({
  selector: '[msChatRich]',
})
export class ChatRich {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly router = inject(Router);
  private readonly i18n = inject(I18n);
  private readonly destroyRef = inject(DestroyRef);
  /** The Markdown text the host shows. Each change, and each theme change, runs the after-render work. */
  readonly msChatRich = input<string>('');
  private readonly themeTick = signal(0);
  private lightbox: OpenLightbox | null = null;

  constructor() {
    const stopWatching = watchTheme(() => this.themeTick.update((value) => value + 1));

    const onClick = (event: MouseEvent) => this.onClick(event);
    const onError = (event: Event) => this.onImageError(event);
    this.host.addEventListener('click', onClick);
    // Image errors do not bubble, so the listener sits in the capture phase on the host.
    this.host.addEventListener('error', onError, true);
    this.destroyRef.onDestroy(() => {
      stopWatching();
      this.host.removeEventListener('click', onClick);
      this.host.removeEventListener('error', onError, true);
      this.closeLightbox();
    });

    afterRenderEffect(() => {
      this.msChatRich();
      this.themeTick();
      untracked(() => void this.draw());
    });
  }

  private async draw(): Promise<void> {
    prepareDiagrams(this.host);
    await drawDiagrams(this.host, {
      engine: loadMermaidEngine,
      theme: currentTheme,
      errorText: this.i18n.t('chat.rich.diagramError'),
    });
    const label = this.i18n.t('chat.rich.diagramLabel');
    for (const box of Array.from(this.host.querySelectorAll<HTMLElement>('.chat-diagram .ms-diagram'))) {
      box.setAttribute('role', 'img');
      box.setAttribute('aria-label', label);
    }
  }

  private onClick(event: MouseEvent): void {
    if (!(event.target instanceof Element)) return;
    const link = event.target.closest<HTMLAnchorElement>('a.doc-link');
    if (link && this.host.contains(link)) {
      const plain = event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
      const href = link.getAttribute('href');
      if (event.defaultPrevented || plain || !href) return;
      event.preventDefault();
      void this.router.navigateByUrl(href);
      return;
    }
    const image = event.target.closest('.chat-image img');
    if (image instanceof HTMLImageElement && this.host.contains(image)) {
      event.preventDefault();
      this.openLightbox(image);
    }
  }

  private onImageError(event: Event): void {
    const image = event.target;
    if (!(image instanceof HTMLImageElement) || !image.closest('.chat-image')) return;
    const note = document.createElement('span');
    note.className = 'chat-image-missing';
    note.setAttribute('role', 'note');
    note.textContent = this.i18n.t('chat.rich.imageUnavailable');
    image.replaceWith(note);
  }

  private openLightbox(image: HTMLImageElement): void {
    if (this.lightbox) return;
    ensureLightboxStyle();
    const figure = image.closest<HTMLElement>('figure');
    const closeLabel = this.i18n.t('chat.rich.close');

    const dialog = document.createElement('dialog');
    dialog.className = 'chat-lightbox';
    dialog.setAttribute('aria-label', this.i18n.t('chat.rich.lightbox'));
    const large = document.createElement('img');
    large.src = image.getAttribute('src') ?? '';
    large.alt = image.alt;
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'chat-lightbox-close';
    close.setAttribute('aria-label', closeLabel);
    close.title = closeLabel;
    close.textContent = '×';
    dialog.append(large, close);

    // A click on the dialog itself (the backdrop around the picture) or on the close button closes it.
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog || event.target === close) this.closeLightbox();
    });
    // Escape closes a modal dialog natively; the close event then tidies up.
    dialog.addEventListener('close', () => this.finishLightbox());

    if (figure) figure.tabIndex = -1;
    document.body.append(dialog);
    this.lightbox = { dialog, figure };
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    close.focus();
  }

  private closeLightbox(): void {
    const current = this.lightbox;
    if (!current) return;
    if (typeof current.dialog.close === 'function' && current.dialog.open) current.dialog.close();
    this.finishLightbox();
  }

  /** Removes the dialog and gives focus back to the figure the picture came from. Safe to call twice. */
  private finishLightbox(): void {
    const current = this.lightbox;
    if (!current) return;
    this.lightbox = null;
    current.dialog.remove();
    if (current.figure?.isConnected) current.figure.focus();
  }
}

function ensureLightboxStyle(): void {
  if (document.getElementById(LIGHTBOX_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = LIGHTBOX_STYLE_ID;
  style.textContent = LIGHTBOX_CSS;
  document.head.append(style);
}

/**
 * Chat diagrams are kept as `<pre class="mermaid-src">` with the text inside. The shared mermaid
 * helper looks for `pre > code.language-mermaid`, so the code element is added here, once.
 */
function prepareDiagrams(root: HTMLElement): void {
  for (const pre of Array.from(root.querySelectorAll<HTMLPreElement>('.chat-diagram > pre.mermaid-src'))) {
    if (pre.querySelector(':scope > code.language-mermaid')) continue;
    const code = document.createElement('code');
    code.className = 'language-mermaid';
    code.textContent = pre.textContent ?? '';
    pre.replaceChildren(code);
  }
}
