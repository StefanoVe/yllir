#!/usr/bin/env node
// Public encyclopedia of a campaign: a deterministic static site, built only when
// every pre-publish check passes. It also reads and writes the Codex settings
// (campaign.yaml, encyclopedia block) and reports the changes since the last build.
// Usage: node encyclopedia.mjs build <root>      builds the site (EncyclopediaReport on stdout)
//        node encyclopedia.mjs status <root>    { built, report|null } from the saved build
//        node encyclopedia.mjs changes <root>   entries added, changed and removed since the saved build
//        node encyclopedia.mjs settings <root>  the Codex settings as JSON, with the config errors
//        node encyclopedia.mjs settings <root> --set <json>
//          sets { "kinds", "flavourText", "list" }; prints the result; exit 1 when refused
// Exit codes: 0 done, 1 build refused by a check or a setting, 2 usage error.

import fs from 'node:fs';
import path from 'node:path';
import { buildEncyclopedia, computeChanges, readSavedReport, buildDir } from './lib/build.mjs';
import { readCodexSettings, writeCodexSettings } from './lib/settings.mjs';
import { exitWith, runCli } from '../../../../scripts/lib/cli-exit.mjs';

const USAGE = [
  'usage: node encyclopedia.mjs <build|status|changes> <root>',
  '       node encyclopedia.mjs settings <root> [--set <json>]',
].join('\n');
const COMMANDS = ['build', 'status', 'changes', 'settings'];

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

/** settings <root> prints the settings; settings <root> --set <json> writes them. */
function settingsCommand(root, rest) {
  if (rest.length === 0) {
    printJson(readCodexSettings(root));
    exitWith(0);
    return undefined;
  }
  if (rest.length !== 2 || rest[0] !== '--set') throw new Error(USAGE);
  let parsed;
  try {
    parsed = JSON.parse(rest[1]);
  } catch {
    throw new Error(USAGE);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(USAGE);
  const result = writeCodexSettings(root, {
    kinds: parsed.kinds,
    flavourText: parsed.flavourText,
    list: parsed.list,
  });
  printJson(result);
  exitWith(result.ok ? 0 : 1);
  return undefined;
}

function main() {
  const [command, rootArg, ...rest] = process.argv.slice(2);
  if (!COMMANDS.includes(command) || !rootArg) throw new Error(USAGE);
  if (command !== 'settings' && rest.length > 0) throw new Error(USAGE);
  const root = path.resolve(rootArg);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error(USAGE);

  if (command === 'settings') return settingsCommand(root, rest);

  if (command === 'changes') {
    printJson(computeChanges(root));
    exitWith(0);
    return undefined;
  }

  if (command === 'status') {
    const report = readSavedReport(root);
    const built = fs.existsSync(path.join(buildDir(root), 'index.html'));
    printJson({ built, report: report ?? null });
    exitWith(0);
    return undefined;
  }

  return buildEncyclopedia(root).then((report) => {
    printJson(report);
    exitWith(report.ok ? 0 : 1);
  });
}

runCli(main);
