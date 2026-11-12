import { Injectable, inject, signal } from "@angular/core";
import { OverlayService } from "./overlay.service";

@Injectable({ providedIn: "root" })
export class ViewerService {
  private overlay = inject(OverlayService);
  readonly image = signal("");
  readonly pdfLink = signal("");
  readonly zoom = signal(1);
  readonly imageFit = signal(true);
  private imageReturn: HTMLElement | null = null;
  /** Opened straight to fullscreen: leaving fullscreen closes the viewer too. */
  private fullscreenOnly = false;

  constructor() {
    document.addEventListener("fullscreenchange", () => {
      if (document.fullscreenElement || !this.fullscreenOnly) return;
      this.fullscreenOnly = false;
      this.closeImage();
    });
  }
  private pdfReturn: HTMLElement | null = null;
  openImage(
    src: string,
    from: HTMLElement | null = document.activeElement as HTMLElement | null,
    options: { fullscreen?: boolean } = {},
  ) {
    this.imageReturn = from;
    this.image.set(src);
    this.overlay.push("image");
    this.zoom.set(1);
    this.imageFit.set(true);
    setTimeout(() => {
      document
        .querySelector<HTMLButtonElement>(".viewer-controls button")
        ?.focus();
      if (options.fullscreen) void this.enterFullscreen(true);
    }, 0);
  }
  /** Lightbox ⇄ fullscreen. From fullscreen, Esc returns to the lightbox. */
  async toggleFullscreen() {
    if (document.fullscreenElement) await this.exitFullscreen();
    else await this.enterFullscreen(false);
  }
  private async enterFullscreen(only: boolean) {
    const overlay = document.querySelector<HTMLElement>(".viewer-overlay");
    try {
      await overlay?.requestFullscreen();
      this.fullscreenOnly = only && !!document.fullscreenElement;
    } catch {
      // Fullscreen unavailable: the lightbox already fills the window.
    }
  }
  private async exitFullscreen() {
    this.fullscreenOnly = false;
    if (document.fullscreenElement)
      await document.exitFullscreen().catch(() => {});
  }
  closeImage() {
    void this.exitFullscreen();
    this.overlay.remove("image");
    this.image.set("");
    this.imageReturn?.focus();
    this.imageReturn = null;
  }
  openPdf(
    src: string,
    from: HTMLElement | null = document.activeElement as HTMLElement | null,
  ) {
    this.pdfReturn = from;
    this.pdfLink.set(src);
    this.overlay.push("pdf");
    setTimeout(
      () =>
        document.querySelector<HTMLAnchorElement>(".viewer-pdf a")?.focus(),
      0,
    );
  }
  closePdf() {
    this.overlay.remove("pdf");
    this.pdfLink.set("");
    this.pdfReturn?.focus();
    this.pdfReturn = null;
  }
}
