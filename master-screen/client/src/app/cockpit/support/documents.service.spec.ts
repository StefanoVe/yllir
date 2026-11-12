import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { ApiService } from '../../core/api.service';
import { DocumentsService, fileUrl } from './documents.service';

describe('DocumentsService file URLs', () => {
  function service(): DocumentsService {
    TestBed.configureTestingModule({ providers: [{ provide: ApiService, useValue: {} }] });
    return TestBed.inject(DocumentsService);
  }

  it('builds the campaign file URL with the path encoded', () => {
    expect(fileUrl('Maps/tavern.png')).toBe('/api/file?path=Maps%2Ftavern.png');
  });

  it('encodes spaces, accents and reserved characters in the path', () => {
    expect(fileUrl('World/Città & co/mappa #1.png')).toBe(
      '/api/file?path=' + encodeURIComponent('World/Città & co/mappa #1.png'),
    );
    expect(fileUrl('a b.png')).toBe('/api/file?path=a%20b.png');
  });

  it('never produces the old asset route', () => {
    const url = service().asset('Items/carta.png');
    expect(url).toBe('/api/file?path=Items%2Fcarta.png');
    expect(url).not.toContain('/api/asset');
  });
});
