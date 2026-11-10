#!/usr/bin/env node
// Item-manager deterministic CLI. It never writes campaign files.
import fs from 'node:fs';
import path from 'node:path';
import { makeDraft, findItems, checkItemSheets, plotItems } from './lib/item-manager.mjs';
import { exitWith, runCli } from '../../../../scripts/lib/cli-exit.mjs';

const usage = 'usage: node item-manager.mjs <campaignRoot> <create --name NAME --location LOCATION --details DETAILS --requested-by FILES --imagination yes|no --files FILES | find --name NAME | check --files FILES | plot-items --files FILES --out JSON>';
const allowed = { create: ['--name','--location','--details','--requested-by','--imagination','--files'], find: ['--name'], check: ['--files','--base'], 'plot-items': ['--files','--out'] };
function main() {
  const [rootArg, command, ...rest] = process.argv.slice(2);
  if (!rootArg || !allowed[command]) throw new Error(usage);
  const opts = {};
  for (let i=0;i<rest.length;i++) {
    const key=rest[i]; if (!allowed[command].includes(key) || opts[key] !== undefined || rest[i+1] === undefined || (rest[i+1].startsWith('--') && rest[i+1] !== '')) throw new Error(usage);
    opts[key]=rest[++i];
  }
  const root=path.resolve(rootArg);
  const parsedFiles=opts['--files'] === undefined ? null : opts['--files'].split(',').map(x=>x.trim()).filter(Boolean);
  const files=parsedFiles?.length ? parsedFiles : null;
  if (command === 'create') {
    if (!opts['--name']?.trim() || opts['--location'] === undefined || opts['--details'] === undefined || opts['--requested-by'] === undefined || !['yes','no'].includes(opts['--imagination']) || opts['--files'] === undefined) throw new Error(usage);
    const result=makeDraft(root,{name:opts['--name'],location:opts['--location'],details:opts['--details'],requestedBy:opts['--requested-by'] ? opts['--requested-by'].split(',').map(x=>x.trim()).filter(Boolean):[]});
    process.stdout.write(`${JSON.stringify(result,null,2)}\n`); exitWith(result.status === 'FAILED' || result.status === 'NOT_AVAILABLE' ? 1 : 0); return;
  }
  if (command === 'find') {
    if (!opts['--name']?.trim()) throw new Error(usage);
    process.stdout.write(`${JSON.stringify(findItems(root,opts['--name']),null,2)}\n`); exitWith(0); return;
  }
  if (command === 'check') {
    if (opts['--files'] === undefined) throw new Error(usage);
    const result=checkItemSheets(root,{files,base:opts['--base'] ?? null});
    for (const file of result.checked) process.stdout.write(`checked ${file}\n`);
    for (const e of result.errors) process.stdout.write(`error ${e.code} ${e.file}: ${e.message}\n`);
    for (const w of result.warnings) process.stdout.write(`warning ${w.code} ${w.file}: ${w.message}\n`);
    process.stdout.write(`errors: ${result.errors.length}\n`); exitWith(result.errors.length ? 1 : 0); return;
  }
  if (!opts['--out']) throw new Error(usage);
  const result=plotItems(root,{files}); const out=path.resolve(root,opts['--out']);
  fs.mkdirSync(path.dirname(out),{recursive:true}); fs.writeFileSync(out,`${JSON.stringify(result,null,2)}\n`);
  process.stdout.write(`events: ${result.events}\ndeclared: ${result.declared}\n`);
  for(const e of result.errors) process.stdout.write(`error ${e.code} ${e.file}: ${e.message}\n`);
  for(const c of result.candidates) process.stdout.write(c.master ? `candidate ${c.file}:${c.line} master-only\n` : `candidate ${c.file}:${c.line} ${c.text}\n`);
  process.stdout.write(`errors: ${result.errors.length}\ncandidates: ${result.candidates.length}\n`); exitWith(result.errors.length ? 1 : 0);
}
runCli(main);
