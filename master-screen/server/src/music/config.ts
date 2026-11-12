// Whether the music module is on in campaign.yaml, read synchronously once at startup (the
// Content-Security-Policy is built then). Reads the `modules:` block with a small line
// reader, as the chat reads the language. Never throws. Owner: music engineer.
import fs from 'node:fs';
import path from 'node:path';

/** True when the `modules:` block of campaign.yaml text has `music: true`. */
export function musicEnabledInYaml(raw: string): boolean {
  const lines = raw.split(/\r?\n/);
  const start = lines.findIndex((line) => /^modules:\s*(#.*)?$/.test(line));
  if (start < 0) return false;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '' || /^\s*#/.test(line)) continue;
    if (!/^\s/.test(line)) break;
    const match = /^\s+music:\s*["']?(true|false)["']?\s*(#.*)?$/.exec(line);
    if (match) return match[1] === 'true';
  }
  return false;
}

/** The music flag of the campaign at startup. False when campaign.yaml is missing or unreadable. */
export function musicEnabledAtStartup(campaignRoot: string): boolean {
  try {
    return musicEnabledInYaml(fs.readFileSync(path.join(campaignRoot, 'campaign.yaml'), 'utf8'));
  } catch {
    return false;
  }
}
