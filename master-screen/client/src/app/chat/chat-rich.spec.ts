import { Component } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideRouter, Router } from '@angular/router';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { I18n } from '../i18n';
import { renderChatMarkdown } from './chat-markdown';
import { ChatRich } from './chat-rich';

const SOURCE = [
  'Read [Alia](characters/alia.md).',
  '',
  '![Old map](images/map.png)',
].join('\n');

@Component({
  imports: [ChatRich],
  template: `<div class="text md" [msChatRich]="text" [innerHTML]="html"></div>`,
})
class Host {
  text = SOURCE;
  get html(): string {
    return renderChatMarkdown(this.text);
  }
}

const flush = async (fixture: ComponentFixture<Host>) => {
  fixture.detectChanges();
  await fixture.whenStable();
};

describe('ChatRich', () => {
  let fixture: ComponentFixture<Host>;
  let host: HTMLElement;
  let router: Router;
  let label: (key: 'chat.rich.imageUnavailable' | 'chat.rich.close' | 'chat.rich.lightbox') => string;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [Host],
      providers: [provideZonelessChangeDetection(), provideRouter([])],
    });
    fixture = TestBed.createComponent(Host);
    router = TestBed.inject(Router);
    label = (key) => TestBed.inject(I18n).t(key);
    await flush(fixture);
    host = fixture.nativeElement.querySelector('.md');
  });

  afterEach(() => {
    document.querySelectorAll('dialog.chat-lightbox').forEach((node) => node.remove());
    fixture.destroy();
  });

  it('navigates inside the app when a document link is clicked', () => {
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    const link = host.querySelector<HTMLAnchorElement>('a.doc-link');
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    link?.dispatchEvent(event);

    expect(navigate).toHaveBeenCalledWith('/doc/characters/alia.md');
    expect(event.defaultPrevented).toBe(true);
  });

  it('lets a modified click on a document link open it as the browser would', () => {
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    const link = host.querySelector<HTMLAnchorElement>('a.doc-link');
    link?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ctrlKey: true }));
    expect(navigate).not.toHaveBeenCalled();
  });

  it('opens the image in a lightbox and closes it with the close button', () => {
    const image = host.querySelector<HTMLImageElement>('.chat-image img');
    image?.click();

    const dialog = document.querySelector<HTMLDialogElement>('dialog.chat-lightbox');
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute('aria-label')).toBe(label('chat.rich.lightbox'));
    expect(dialog?.querySelector('img')?.getAttribute('src')).toBe('/api/file?path=images%2Fmap.png');

    dialog?.querySelector<HTMLButtonElement>('.chat-lightbox-close')?.click();
    expect(document.querySelector('dialog.chat-lightbox')).toBeNull();
  });

  it('closes the lightbox on a click on its backdrop, not on the picture', () => {
    host.querySelector<HTMLImageElement>('.chat-image img')?.click();
    const dialog = document.querySelector<HTMLDialogElement>('dialog.chat-lightbox');
    dialog?.querySelector('img')?.click();
    expect(document.querySelector('dialog.chat-lightbox')).not.toBeNull();

    dialog?.click();
    expect(document.querySelector('dialog.chat-lightbox')).toBeNull();
  });

  it('returns focus to the figure after the lightbox closes', () => {
    const figure = host.querySelector<HTMLElement>('.chat-image');
    host.querySelector<HTMLImageElement>('.chat-image img')?.click();
    document.querySelector<HTMLButtonElement>('dialog.chat-lightbox .chat-lightbox-close')?.click();
    expect(document.activeElement).toBe(figure);
  });

  it('replaces an image that fails to load with a localized placeholder', () => {
    const image = host.querySelector<HTMLImageElement>('.chat-image img');
    image?.dispatchEvent(new Event('error'));

    const note = host.querySelector('.chat-image-missing');
    expect(note?.textContent).toBe(label('chat.rich.imageUnavailable'));
    expect(host.querySelector('.chat-image img')).toBeNull();
    expect(host.querySelector('.chat-image figcaption')?.textContent).toBe('Old map');
  });
});
