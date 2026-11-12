// Lists the Markdown files under the given top folders, as archive-relative paths.
import { readdir } from "node:fs/promises";
import path from "node:path";

export async function markdownFiles(root: string, tops: string[]): Promise<string[]> {
  const found: string[] = [];
  const walk = async (relative: string) => {
    const entries = await readdir(path.join(root, relative), { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const next = `${relative}/${entry.name}`;
      if (entry.isDirectory()) await walk(next);
      else if (entry.isFile() && entry.name.endsWith(".md")) found.push(next);
    }
  };
  for (const top of tops) await walk(top);
  return found.map((file) => file.replace(/^\//, ""));
}
