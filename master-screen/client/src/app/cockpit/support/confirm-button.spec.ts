import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmButton, CONFIRM_WINDOW_MS } from './confirm-button';

describe('ConfirmButton', () => {
  let fixture: ComponentFixture<ConfirmButton>;
  let emitted: number;

  beforeEach(() => {
    vi.useFakeTimers();
    emitted = 0;
    fixture = TestBed.createComponent(ConfirmButton);
    fixture.componentRef.setInput('icon', 'stop');
    fixture.componentRef.setInput('label', 'End combat');
    fixture.componentRef.setInput('confirmLabel', 'End?');
    fixture.componentRef.setInput('disabled', false);
    fixture.componentRef.setInput('buttonClass', 'icon-button');
    fixture.componentRef.instance.confirmed.subscribe(() => emitted++);
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
    vi.useRealTimers();
  });

  const button = (): HTMLButtonElement => (fixture.nativeElement as HTMLElement).querySelector('button')!;
  const click = () => {
    button().click();
    fixture.detectChanges();
  };

  it('does not emit on the first click and shows the confirmation text', () => {
    click();
    expect(emitted).toBe(0);
    expect(button().classList.contains('armed')).toBe(true);
    expect(button().getAttribute('aria-pressed')).toBe('true');
    expect(button().textContent).toContain('End?');
    expect(button().getAttribute('aria-label')).toBe('End?');
  });

  it('emits once on the second click within the window and disarms', () => {
    click();
    click();
    expect(emitted).toBe(1);
    expect(button().classList.contains('armed')).toBe(false);
    expect(button().getAttribute('aria-pressed')).toBe('false');
    expect(button().getAttribute('aria-label')).toBe('End combat');
  });

  it('disarms after the window, so a later click only arms again', () => {
    click();
    vi.advanceTimersByTime(CONFIRM_WINDOW_MS);
    fixture.detectChanges();
    expect(button().classList.contains('armed')).toBe(false);
    click();
    expect(emitted).toBe(0);
    expect(button().classList.contains('armed')).toBe(true);
  });

  it('disarms on Escape without emitting and stops the event from reaching the document', () => {
    click();
    const outside = vi.fn();
    document.addEventListener('keydown', outside);
    button().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    document.removeEventListener('keydown', outside);
    fixture.detectChanges();
    expect(emitted).toBe(0);
    expect(button().classList.contains('armed')).toBe(false);
    expect(outside).not.toHaveBeenCalled();
  });

  it('disarms on blur without emitting', () => {
    click();
    button().dispatchEvent(new FocusEvent('blur'));
    fixture.detectChanges();
    expect(emitted).toBe(0);
    expect(button().classList.contains('armed')).toBe(false);
  });

  it('a disabled button ignores clicks', () => {
    fixture.componentRef.setInput('disabled', true);
    fixture.detectChanges();
    expect(button().disabled).toBe(true);
    fixture.componentRef.instance.onClick();
    expect(button().classList.contains('armed')).toBe(false);
  });

  it('clears the pending timer on destroy', () => {
    click();
    fixture.destroy();
    expect(vi.getTimerCount()).toBe(0);
  });
});
