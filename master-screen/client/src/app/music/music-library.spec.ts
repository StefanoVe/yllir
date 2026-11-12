import { describe, expect, it } from 'vitest';
import type { MusicTrack } from '@shared/types';
import { groupTracks } from './music-library';
import { youtubeTrack } from './testing';

function at(id: string, docPath: string, docTitle: string, extra: Partial<MusicTrack> = {}): MusicTrack {
  return youtubeTrack(id, { docPath, docTitle, title: `Title ${id}`, ...extra });
}

describe('groupTracks', () => {
  it('groups by sheet and orders the groups by sheet title', () => {
    const groups = groupTracks([
      at('1', 'places/tavern.md', 'Tavern'),
      at('2', 'places/port.md', 'Port'),
      at('3', 'places/tavern.md', 'Tavern'),
    ]);
    expect(groups.map((group) => group.docTitle)).toEqual(['Port', 'Tavern']);
    expect(groups[1].tracks.map((track) => track.id)).toEqual(['1', '3']);
  });

  it('puts the preferred track first inside its sheet, keeping the rest in order', () => {
    const groups = groupTracks([
      at('plain-a', 'places/port.md', 'Port'),
      at('plain-b', 'places/port.md', 'Port'),
      at('star', 'places/port.md', 'Port', { preferred: true }),
      at('plain-c', 'places/port.md', 'Port'),
    ]);
    expect(groups[0].tracks.map((track) => track.id)).toEqual(['star', 'plain-a', 'plain-b', 'plain-c']);
  });

  it('keeps the same sheet title apart when the paths differ', () => {
    const groups = groupTracks([
      at('1', 'a/port.md', 'Port'),
      at('2', 'b/port.md', 'Port'),
    ]);
    expect(groups).toHaveLength(2);
  });

  it('returns no groups for no tracks', () => {
    expect(groupTracks([])).toEqual([]);
  });
});
