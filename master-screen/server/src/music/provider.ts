// Classifies one music link: which provider plays it and, for YouTube, the video id.
// Only https links with a host and no userinfo are kept; anything else is dropped (null).
// Owner: music engineer.
import { createHash } from 'node:crypto';

export const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
]);

export const SOUNDCLOUD_HOSTS = new Set([
  'soundcloud.com',
  'www.soundcloud.com',
  'm.soundcloud.com',
  'on.soundcloud.com', // short links
]);

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export interface MusicLink {
  provider: 'youtube' | 'soundcloud' | 'external';
  videoId?: string;
}

/** The 11-character video id of a YouTube link, or null (playlists and other pages have none). */
export function youtubeVideoId(host: string, url: URL): string | null {
  if (host === 'youtu.be') {
    const first = url.pathname.split('/').filter((part) => part !== '')[0] ?? '';
    return VIDEO_ID.test(first) ? first : null;
  }
  if (url.pathname === '/watch') {
    const v = url.searchParams.get('v') ?? '';
    return VIDEO_ID.test(v) ? v : null;
  }
  const found = /^\/(?:embed|shorts)\/([^/]+)/.exec(url.pathname);
  if (found && VIDEO_ID.test(found[1])) return found[1];
  return null;
}

/** Classifies a link, or returns null when it must not be shown (not https, userinfo, no host, unparseable). */
export function classifyMusicUrl(raw: string): MusicLink | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (url.username !== '' || url.password !== '') return null;
  const host = url.hostname.toLowerCase();
  if (host === '') return null;
  if (SOUNDCLOUD_HOSTS.has(host)) {
    // A SoundCloud link needs at least one path segment (the bare host is not a track).
    return url.pathname.split('/').some((part) => part !== '') ? { provider: 'soundcloud' } : { provider: 'external' };
  }
  if (!YOUTUBE_HOSTS.has(host)) return { provider: 'external' };
  const videoId = youtubeVideoId(host, url);
  return videoId === null ? { provider: 'external' } : { provider: 'youtube', videoId };
}

/** Stable id of a track: first 12 hex digits of sha1 of "docPath|url". */
export function trackId(docPath: string, url: string): string {
  return createHash('sha1').update(`${docPath}|${url}`).digest('hex').slice(0, 12);
}
