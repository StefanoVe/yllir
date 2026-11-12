// Whether the encyclopedia module is on in campaign.yaml, read synchronously once at startup
// (the Content-Security-Policy is built then). Same line reader as the music module. Never throws.
import fs from 'node:fs';
import path from 'node:path';

/** True when the `modules:` block of campaign.yaml text has `encyclopedia: true`. */
export function encyclopediaEnabledInYaml(raw: string): boolean {
  const lines = raw.split(/\r?\n/);
  const start = lines.findIndex((line) => /^modules:\s*(#.*)?$/.test(line));
  if (start < 0) return false;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '' || /^\s*#/.test(line)) continue;
    if (!/^\s/.test(line)) break;
    const match = /^\s+encyclopedia:\s*["']?(true|false)["']?\s*(#.*)?$/.exec(line);
    if (match) return match[1] === 'true';
  }
  return false;
}

/** The encyclopedia flag of the campaign at startup. False when campaign.yaml is missing or unreadable. */
export function encyclopediaEnabledAtStartup(campaignRoot: string): boolean {
  try {
    return encyclopediaEnabledInYaml(fs.readFileSync(path.join(campaignRoot, 'campaign.yaml'), 'utf8'));
  } catch {
    return false;
  }
}
