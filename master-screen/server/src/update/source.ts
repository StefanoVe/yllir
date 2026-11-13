// Where the published framework is read from: the plugin manifest and the news folder of the
// public repository. Only unauthenticated GET requests with a generic User-Agent, nothing about
// the campaign. Owner: update engineer.
import { compareVersions, isVersion } from './version.js';

export const PLUGIN_MANIFEST_URL = 'https://raw.githubusercontent.com/StefanoVe/yllir/main/yllir/.claude-plugin/plugin.json';
export const NEWS_LIST_URL = 'https://api.github.com/repos/StefanoVe/yllir/contents/yllir/news';
/** News files are only downloaded from this prefix, whatever the listing says. */
export const NEWS_DOWNLOAD_PREFIX = 'https://raw.githubusercontent.com/StefanoVe/yllir/';
export const NEWS_LIMIT = 8000;
export const FETCH_TIMEOUT_MS = 8000;
const USER_AGENT = 'yllir-master-screen';
const NEWS_NAME_RE = /^(\d+\.\d+\.\d+)(?:\.([a-z]{2,3}(?:-[a-z0-9]+)?))?\.md$/i;

/** Returns the body of a URL as text, or throws. Injected in tests so that no test touches the network. */
export type FetchText = (url: string) => Promise<string>;

export async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The newest published framework version. Throws when the source is unreachable or not a manifest. */
export async function fetchPublishedVersion(get: FetchText): Promise<string> {
  const parsed: unknown = JSON.parse(await get(PLUGIN_MANIFEST_URL));
  const version = isRecord(parsed) ? parsed.version : undefined;
  if (!isVersion(version)) throw new Error('the published manifest has no version');
  return version;
}

interface NewsFile {
  version: string;
  lang: string | null;
  url: string;
}

function newsFilesOf(listing: unknown): NewsFile[] {
  if (!Array.isArray(listing)) return [];
  const files: NewsFile[] = [];
  for (const item of listing) {
    if (!isRecord(item) || typeof item.name !== 'string' || typeof item.download_url !== 'string') continue;
    const match = NEWS_NAME_RE.exec(item.name);
    if (match === null || !isVersion(match[1])) continue;
    files.push({ version: match[1], lang: match[2]?.toLowerCase() ?? null, url: item.download_url });
  }
  return files;
}

/**
 * The news of every published version after the installed one, up to the published one, oldest
 * first. The campaign language variant is used when it exists, else the plain file. Never throws:
 * any failure gives null, and the update is still offered without news.
 */
export async function fetchNews(
  get: FetchText,
  opts: { installed: string; published: string; language: string },
): Promise<string | null> {
  try {
    const files = newsFilesOf(JSON.parse(await get(NEWS_LIST_URL)));
    const language = opts.language.toLowerCase();
    const versions = [...new Set(files.map((file) => file.version))]
      .filter((v) => compareVersions(v, opts.installed) === 1 && compareVersions(v, opts.published) !== 1)
      .sort((a, b) => compareVersions(a, b) ?? 0);
    const parts: string[] = [];
    for (const version of versions) {
      const forVersion = files.filter((file) => file.version === version);
      const chosen = forVersion.find((file) => file.lang === language) ?? forVersion.find((file) => file.lang === null);
      if (chosen === undefined || !chosen.url.startsWith(NEWS_DOWNLOAD_PREFIX)) continue;
      const text = (await get(chosen.url)).trim();
      if (text !== '') parts.push(text);
    }
    const joined = parts.join('\n\n').slice(0, NEWS_LIMIT).trim();
    return joined === '' ? null : joined;
  } catch {
    return null;
  }
}
