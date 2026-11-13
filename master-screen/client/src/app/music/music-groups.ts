import type { MusicTrack } from '@shared/types';

export interface TrackGroup<T extends MusicTrack = MusicTrack> {
  docPath: string;
  docTitle: string;
  tracks: T[];
}

/**
 * Groups tracks by the sheet that lists them. Groups are ordered by sheet title; inside a group
 * the preferred tracks come first, and the rest keep the order the server sent.
 * Used only for the empty query: while a query is typed the server ranking is shown flat.
 */
export function groupTracks<T extends MusicTrack>(tracks: readonly T[]): TrackGroup<T>[] {
  const groups = new Map<string, TrackGroup<T>>();
  for (const track of tracks) {
    let group = groups.get(track.docPath);
    if (!group) {
      group = { docPath: track.docPath, docTitle: track.docTitle, tracks: [] };
      groups.set(track.docPath, group);
    }
    group.tracks.push(track);
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      tracks: [...group.tracks.filter((track) => track.preferred), ...group.tracks.filter((track) => !track.preferred)],
    }))
    .sort((a, b) => a.docTitle.localeCompare(b.docTitle) || a.docPath.localeCompare(b.docPath));
}
