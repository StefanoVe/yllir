#!/usr/bin/env node
// Plans or applies a reviewed geographic layout for one write sequence.
// Usage: geographic-layout.mjs <root> plan [--draft-dir <dir> --files "a.md,b.md"] --out <json>
//        geographic-layout.mjs <root> apply --plan <json> [--files "a.md,b.md"] --out <json>
//        geographic-layout.mjs <root> verify --plan <json> --out <json>
// --files on apply lists the campaign paths the caller holds; the result gives their finalFiles.
// Exit codes: 0 done, 1 refused or failed (see errors in the JSON), 2 usage error.

import fs from 'node:fs';
import path from 'node:path';
import { planGeographicLayout, applyGeographicLayout, verifyGeographicLayoutPlan } from './lib/geographic-layout.mjs';
import { exitWith, runCli } from './lib/cli-exit.mjs';

const USAGE = 'usage: node geographic-layout.mjs <root> plan [--draft-dir <dir> --files "a.md,b.md"] --out <json> | <root> apply --plan <json> [--files "a.md,b.md"] --out <json> | <root> verify --plan <json> --out <json>';

function parseArgs(argv) {
  const [root, action, ...rest] = argv;
  if (!root || !['plan', 'verify', 'apply'].includes(action)) return null;
  const opts = {};
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i];
    const value = rest[i + 1];
    if (!['--draft-dir', '--files', '--plan', '--out'].includes(key) || !value || Object.hasOwn(opts, key)) return null;
    opts[key] = value;
  }
  if (!opts['--out']) return null;
  if (action === 'plan' && (Boolean(opts['--draft-dir']) !== Boolean(opts['--files']) || opts['--plan'])) return null;
  if (action !== 'plan' && (!opts['--plan'] || opts['--draft-dir'] || (action === 'verify' && opts['--files']))) return null;
  return { root: path.resolve(root), action, opts };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args) throw new Error(USAGE);
  const outRel = safeCampaignPath(args.opts['--out'], 'output');
  if (!outRel.startsWith('.campaign/state/write/')) throw new Error('--out must be inside .campaign/state/write');
  assertNoSymlinks(args.root, outRel, { allowMissing: true });
  const out = path.resolve(args.root, outRel);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  let result;
  if (args.action === 'plan') {
    const draftRel = args.opts['--draft-dir'] ? safeCampaignPath(args.opts['--draft-dir'], 'draft directory') : null;
    const draftRoot = draftRel === null ? null : path.resolve(args.root, draftRel);
    if (draftRel !== null) assertNoSymlinks(args.root, draftRel);
    const files = args.opts['--files'] ? args.opts['--files'].split(',').map((item) => safeCampaignPath(item.trim(), 'draft')).filter(Boolean) : [];
    const overlayFiles = draftRoot === null ? [] : files.map((file) => {
      const rel = `${draftRel}/${file}`;
      assertNoSymlinks(args.root, rel);
      return { path: file, content: fs.readFileSync(path.join(draftRoot, file), 'utf8') };
    });
    result = planGeographicLayout(args.root, { overlayFiles });
    fs.writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  } else {
    const planRel = safeCampaignPath(args.opts['--plan'], 'plan');
    if (!planRel.startsWith('.campaign/state/write/')) throw new Error('--plan must be inside .campaign/state/write');
    assertNoSymlinks(args.root, planRel);
    const plan = JSON.parse(fs.readFileSync(path.resolve(args.root, planRel), 'utf8'));
    if (args.action === 'verify') {
      result = verifyGeographicLayoutPlan(args.root, plan);
    } else {
      const files = args.opts['--files'] ? args.opts['--files'].split(',').map((item) => safeCampaignPath(item.trim(), 'file')) : [];
      result = applyGeographicLayout(args.root, plan, { files });
    }
    fs.writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  exitWith(result.errors?.length || result.status === 'rejected' || result.status === 'failed' ? 1 : 0);
}

runCli(main);

function safeCampaignPath(value, label) {
  if (typeof value !== 'string' || value === '' || value.includes('\\') || path.isAbsolute(value) || value.startsWith('/')) {
    throw new Error(`${label} must be a plain campaign-relative path`);
  }
  const parts = value.split('/');
  if (parts.some((part) => part === '' || part === '.' || part === '..')) throw new Error(`${label} must not contain . or .. path segments`);
  return value;
}

function assertNoSymlinks(root, rel, { allowMissing = false } = {}) {
  let current = root;
  for (const part of rel.split('/')) {
    current = path.join(current, part);
    try {
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink()) throw new Error(`refusing symlink in ${rel}`);
    } catch (err) {
      if (err.code === 'ENOENT' && allowMissing) break;
      throw err;
    }
  }
}
