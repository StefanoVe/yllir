#!/usr/bin/env node
// Creates a campaign in an empty folder and prints the result as JSON.
// Usage: node init-campaign.mjs <root> --name "<name>" --language <xx> --register <r>
//          [--world "<world>"] [--description "<description>"] [--adapter <id>]
// Exit codes: 0 created, 1 refused or failed (see errors in the JSON), 2 usage error.

import path from 'node:path';
import { initCampaign } from './lib/init-campaign.mjs';
import { exitWith, runCli } from '../../../../scripts/lib/cli-exit.mjs';

const USAGE =
  'usage: node init-campaign.mjs <root> --name "<name>" --language <xx> --register <elevated|plain|colloquial|mixed> [--world "<world>"] [--description "<description>"] [--adapter <id>]';
const VALUE_FLAGS = ['--name', '--language', '--register', '--world', '--description', '--adapter'];
const REQUIRED_FLAGS = ['--name', '--language', '--register'];

function parseArgs(argv) {
  const options = {};
  let root = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (VALUE_FLAGS.includes(arg)) {
      if (i + 1 >= argv.length || Object.hasOwn(options, arg)) return null;
      options[arg] = argv[++i];
    } else if (arg.startsWith('--') || arg === '') {
      return null;
    } else if (root === null) {
      root = arg;
    } else {
      return null;
    }
  }
  if (root === null || REQUIRED_FLAGS.some((flag) => !Object.hasOwn(options, flag))) return null;
  return {
    root,
    name: options['--name'],
    language: options['--language'],
    register: options['--register'],
    world: options['--world'],
    description: options['--description'],
    adapter: options['--adapter'],
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args === null) throw new Error(USAGE);

  const result = initCampaign(path.resolve(args.root), {
    name: args.name,
    language: args.language,
    register: args.register,
    world: args.world,
    description: args.description,
    adapter: args.adapter,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  exitWith(result.errors.length === 0 ? 0 : 1);
}

runCli(main);
