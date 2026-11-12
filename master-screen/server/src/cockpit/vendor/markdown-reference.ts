// Pure copy of the prototype's resolveReference (markdown.ts): resolves a link or image
// href written in a document to an archive-relative path. No I/O.
import path from "node:path";

export function resolveReference(source: string, href: string) {
  if (/^(https?:|mailto:)/i.test(href))
    return { external: true, path: href, anchor: "" };
  if (/^[a-z][a-z\d+.-]*:/i.test(href) || href.startsWith("//")) return null;
  try {
    const [file, ...fragment] = href.split("#");
    const resolved = file
      ? path.posix.normalize(
          path.posix.join(
            path.posix.dirname(source),
            decodeURIComponent(file.split("?")[0]!),
          ),
        )
      : source;
    if (
      resolved === ".." ||
      resolved.startsWith("../") ||
      resolved.startsWith("/")
    )
      return null;
    return {
      external: false,
      path: resolved,
      anchor: decodeURIComponent(fragment.join("#")),
    };
  } catch {
    return null;
  }
}
