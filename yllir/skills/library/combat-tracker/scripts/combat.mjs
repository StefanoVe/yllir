#!/usr/bin/env node
// Combat command line: starts, changes and ends the combat of the game in progress.
// Prints one JSON document on stdout and ends with `exit: <code>`.
// Usage: node combat.mjs <op> <root> [options]
//   ops: start add remove initiative damage heal condition-add condition-remove
//        resource note reveal next end status
//   options: --id --name --side --initiative --hp --hp-max --ac --sheet --amount
//            --condition --duration --rounds --resource --delta --value --text --hidden
// Exit codes: 0 ok, 1 domain error (the rules refused, or no game in progress), 2 usage.

import path from 'node:path';
import { applyOp, getCombat } from './lib/combat-store.mjs';
import { exitWith, runCli } from '../../../../scripts/lib/cli-exit.mjs';

const USAGE = 'usage: node combat.mjs <start|add|remove|initiative|damage|heal|condition-add|condition-remove|resource|note|reveal|next|end|status> <root> [--id --name --side --initiative --hp --hp-max --ac --sheet --amount --condition --duration --rounds --resource --delta --value --text --hidden]';
const OPS = ['start', 'add', 'remove', 'initiative', 'damage', 'heal', 'condition-add', 'condition-remove', 'resource', 'note', 'reveal', 'next', 'end', 'status'];
const TEXT_OPTIONS = ['id', 'name', 'side', 'sheet', 'condition', 'duration', 'resource', 'text'];
const NUMBER_OPTIONS = ['initiative', 'hp', 'hp-max', 'ac', 'amount', 'rounds', 'delta', 'value'];
const FLAG_OPTIONS = ['hidden'];
const INTEGER_RE = /^-?\d+$/;

function usage(message) {
  process.stdout.write(`${JSON.stringify({ ok: false, error: { code: 'usage', message: `${message}\n${USAGE}` } }, null, 2)}\n`);
  exitWith(2);
}

// Returns { values } or { problem } for the options after <root>.
function parseOptions(args) {
  const values = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith('--')) return { problem: `unexpected argument ${arg}` };
    const name = arg.slice(2);
    if (FLAG_OPTIONS.includes(name)) {
      values[name] = true;
      continue;
    }
    if (!TEXT_OPTIONS.includes(name) && !NUMBER_OPTIONS.includes(name)) return { problem: `unknown option ${arg}` };
    if (i + 1 >= args.length || args[i + 1].startsWith('--')) {
      return { problem: `option ${arg} needs a value` };
    }
    const raw = args[++i];
    if (NUMBER_OPTIONS.includes(name)) {
      if (!INTEGER_RE.test(raw) || !Number.isSafeInteger(Number(raw))) return { problem: `option ${arg} needs a whole number, got ${raw}` };
      values[name] = Number(raw);
    } else {
      values[name] = raw;
    }
  }
  return { values };
}

// Maps the command line to one CombatOp, or returns the usage problem.
function buildOp(name, o) {
  const need = (key, label) => (o[key] === undefined ? `${label} is required for ${name}` : null);
  const withId = (rest) => {
    const problem = need('id', '--id');
    return problem ? { problem } : { op: { op: name, id: o.id, ...rest } };
  };
  switch (name) {
    case 'start':
    case 'next':
    case 'end':
      return { op: { op: name } };
    case 'add': {
      const problem = need('name', '--name') ?? need('side', '--side');
      if (problem) return { problem };
      const op = { op: 'add', name: o.name, side: o.side };
      if (o.initiative !== undefined) op.initiative = o.initiative;
      if (o.hp !== undefined) op.hp = o.hp;
      if (o['hp-max'] !== undefined) op.hpMax = o['hp-max'];
      if (o.ac !== undefined) op.ac = o.ac;
      if (o.sheet !== undefined) op.sheet = o.sheet;
      if (o.hidden === true) op.hidden = true;
      return { op };
    }
    case 'remove':
    case 'reveal':
      return withId({});
    case 'initiative': {
      const problem = need('initiative', '--initiative');
      return problem ? { problem } : withId({ value: o.initiative });
    }
    case 'damage':
    case 'heal': {
      const problem = need('amount', '--amount');
      return problem ? { problem } : withId({ amount: o.amount });
    }
    case 'condition-add': {
      const problem = need('condition', '--condition');
      if (problem) return { problem };
      const rest = { condition: o.condition };
      if (o.duration !== undefined) rest.duration = o.duration;
      if (o.rounds !== undefined) rest.rounds = o.rounds;
      return withId(rest);
    }
    case 'condition-remove': {
      const problem = need('condition', '--condition');
      return problem ? { problem } : withId({ condition: o.condition });
    }
    case 'resource': {
      const problem = need('resource', '--resource');
      if (problem) return { problem };
      const rest = { resource: o.resource };
      if (o.delta !== undefined) rest.delta = o.delta;
      if (o.value !== undefined) rest.value = o.value;
      return withId(rest);
    }
    case 'note': {
      const problem = need('text', '--text');
      return problem ? { problem } : withId({ text: o.text });
    }
    default:
      return { problem: `unknown operation ${name}` };
  }
}

async function main() {
  const [name, root, ...rest] = process.argv.slice(2);
  if (name === undefined || !OPS.includes(name)) return usage(`unknown or missing operation '${name ?? ''}'`);
  if (root === undefined || root.startsWith('--') || root === '') return usage('missing <root>');
  const parsed = parseOptions(rest);
  if (parsed.problem) return usage(parsed.problem);
  const base = path.resolve(root);

  let result;
  if (name === 'status') {
    result = getCombat(base);
  } else {
    const built = buildOp(name, parsed.values);
    if (built.problem) return usage(built.problem);
    result = await applyOp(base, built.op, { now: new Date().toISOString() });
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  exitWith(result.ok ? 0 : 1);
}

runCli(main);
