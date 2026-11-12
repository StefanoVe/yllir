// Language and game system of the campaign, read from campaign.yaml for the cockpit's prompt
// and messages. A missing or unreadable file gives the defaults (English, no system).
import { readFileSync } from "node:fs";
import path from "node:path";

export interface CampaignConfig {
  /** `language.main` of campaign.yaml. */
  language: string;
  /** `system.adapter` of campaign.yaml, or null when the campaign has none. */
  systemName: string | null;
}

/** The value of `key` inside the top-level block `block`, or null. */
function scalarUnder(text: string, block: string, key: string): string | null {
  let inBlock = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\S/.test(line)) {
      inBlock = line.trim() === `${block}:`;
      continue;
    }
    if (!inBlock) continue;
    const match = line.match(new RegExp(`^\\s+${key}:\\s*(.*?)\\s*$`));
    if (match) return (match[1] ?? "").replace(/^["']|["']$/g, "") || null;
  }
  return null;
}

export function readCampaignConfig(root: string): CampaignConfig {
  let text: string;
  try {
    text = readFileSync(path.join(root, "campaign.yaml"), "utf8");
  } catch {
    return { language: "en", systemName: null };
  }
  const adapter = scalarUnder(text, "system", "adapter");
  return {
    language: scalarUnder(text, "language", "main") ?? "en",
    systemName: adapter && adapter !== "none" ? adapter : null,
  };
}
