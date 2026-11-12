/** URL of a campaign document in the reader: `/doc/<path>`, each segment encoded. */
export function docUrl(path: string): string {
  return '/doc/' + path.split('/').filter((part) => part.length > 0).map(encodeURIComponent).join('/');
}
