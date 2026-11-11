#!/usr/bin/env node
import path from 'node:path';
import fs from 'node:fs';
import { completeScenes, prepareSceneChecks, refreshChangedScene, stageSceneDraft, verifySceneDrafts } from './lib/scene-checks.mjs';
import { runCli, exitWith } from '../../../../scripts/lib/cli-exit.mjs';

async function main() {
  const [campaign = '.', flag = '--prepare', ...args] = process.argv.slice(2);
  const root = path.resolve(campaign);
  let result;
  if (flag === '--prepare' && args.length === 0) result = await prepareSceneChecks(root);
  else if (flag === '--stage' && args.length === 2) result = await stageSceneDraft(root, args[0], fs.readFileSync(path.resolve(root, args[1]), 'utf8'));
  else if (flag === '--verify' && args.length === 1) result = await verifySceneDrafts(root, args[0].split(',').filter(Boolean));
  else if (flag === '--complete' && args.length === 1) result = await completeScenes(root, args[0] === '-' ? [] : args[0].split(',').filter(Boolean));
  else if (flag === '--refresh' && args.length === 1) result = await refreshChangedScene(root, args[0]);
  else throw new Error('usage: scene-checks.mjs <root> --prepare | --stage <file> <draft-file> | --verify <files> | --complete <files|->');
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  exitWith(result.status === 'failed' ? 1 : 0);
}

runCli(main);
