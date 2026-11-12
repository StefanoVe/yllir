// shortcut-v1: writes the master screen shortcut into campaigns created before it
// existed (needed: from_version_below 0.45.0 in migration.yaml), and makes git ignore
// it. Deterministic. The launcher never overwrites a file without its marker.
// Reversible: the update's restore point undoes the .gitignore change, and the
// shortcut is ignored by git, so it holds no campaign content.
import fs from 'node:fs';
import path from 'node:path';
import { parseYamlLite } from '../../../../../scripts/lib/yaml-lite.mjs';
import {
  installShortcut,
  missingShortcutIgnoreRules,
  shortcutFileName,
  shortcutMissing,
  shortcutSupported,
} from '../../../new-campaign/scripts/lib/shortcut.mjs';

/** The campaign language from campaign.yaml, or English when it cannot be read. */
function campaignLanguage(root) {
  try {
    const parsed = parseYamlLite(fs.readFileSync(path.join(root, 'campaign.yaml'), 'utf8'));
    return parsed.data?.language?.main ?? 'en';
  } catch {
    return 'en';
  }
}

/** A dry run lists what would change; a real run writes the shortcut and the ignore rules. */
export function apply(root, { dryRun = false } = {}) {
  const language = campaignLanguage(root);
  if (dryRun) {
    const changed = [];
    if (shortcutSupported() && shortcutMissing(root, language)) changed.push(shortcutFileName(language));
    if (missingShortcutIgnoreRules(root).length > 0) changed.push('.gitignore');
    return { status: 'complete', changed, errors: [] };
  }
  try {
    const result = installShortcut(root, { language });
    const changed = [];
    if (result.ignoreChanged) changed.push('.gitignore');
    if (result.created) changed.push(path.basename(result.path));
    return { status: 'complete', changed, errors: [] };
  } catch (err) {
    // The update goes on without the shortcut; the failure is listed in the update's details.
    return {
      status: 'complete',
      changed: [],
      errors: [],
      skipped: [{ path: shortcutFileName(language) ?? 'shortcut', reason: 'shortcut-failed', message: err.message }],
    };
  }
}
