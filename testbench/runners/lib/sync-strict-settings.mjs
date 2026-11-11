#!/usr/bin/env node
// Keeps strict-settings.json (the permissions of the strict test runs) equal to the project
// settings that the framework generates for a campaign, so the two never drift.
// Usage: node testbench/runners/lib/sync-strict-settings.mjs           check (exit 0 in sync, 1 out of date)
//        node testbench/runners/lib/sync-strict-settings.mjs --write   regenerate strict-settings.json

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectSettingsText } from '../../../yllir/scripts/lib/instructions.mjs';

export const STRICT_SETTINGS_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'strict-settings.json');

/** True when strict-settings.json holds exactly the generated project settings. */
export function strictSettingsInSync(file = STRICT_SETTINGS_PATH) {
  let current = null;
  try {
    current = fs.readFileSync(file, 'utf8');
  } catch {
    return false;
  }
  return current === projectSettingsText();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--write')) {
    fs.writeFileSync(STRICT_SETTINGS_PATH, projectSettingsText());
    process.stdout.write(`written: ${STRICT_SETTINGS_PATH}\n`);
    process.exit(0);
  }
  if (strictSettingsInSync()) {
    process.stdout.write('strict-settings.json: in sync\n');
    process.exit(0);
  }
  process.stdout.write('strict-settings.json: out of date, run node testbench/runners/lib/sync-strict-settings.mjs --write\n');
  process.exit(1);
}
