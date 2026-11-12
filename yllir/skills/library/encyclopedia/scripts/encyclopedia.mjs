#!/usr/bin/env node
// Public encyclopedia of a campaign: a deterministic static site, built only when
// every pre-publish check passes.
// Usage: node encyclopedia.mjs build <root>    builds the site (EncyclopediaReport on stdout)
//        node encyclopedia.mjs status <root>  { built, report|null } from the saved build
// Exit codes: 0 done (build ok, or status), 1 build refused by a check or a setting, 2 usage error.

import fs from 'node:fs';
import path from 'node:path';
import { buildEncyclopedia, readSavedReport, buildDir } from './lib/build.mjs';
import { exitWith, runCli } from '../../../../scripts/lib/cli-exit.mjs';

const USAGE = 'usage: node encyclopedia.mjs <build|status> <root>';
const COMMANDS = ['build', 'status'];

function main() {
  const [command, rootArg, ...extra] = process.argv.slice(2);
  if (!COMMANDS.includes(command) || !rootArg || extra.length > 0) throw new Error(USAGE);
  const root = path.resolve(rootArg);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error(USAGE);

  if (command === 'status') {
    const report = readSavedReport(root);
    const built = fs.existsSync(path.join(buildDir(root), 'index.html'));
    process.stdout.write(`${JSON.stringify({ built, report: report ?? null }, null, 2)}\n`);
    exitWith(0);
    return undefined;
  }

  return buildEncyclopedia(root).then((report) => {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    exitWith(report.ok ? 0 : 1);
  });
}

runCli(main);
