#!/usr/bin/env node
// Runs the installed system adapter against campaign content and writes a report.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateConfig } from '../../../../scripts/lib/config.mjs';
import { loadAdapter } from '../../../../scripts/lib/adapter.mjs';
import { cardFields, progressionEvent, validateSheet } from './lib/adapter-ops.mjs';
import { parseFrontmatter } from '../../../../scripts/lib/frontmatter.mjs';
import { exitWith, runCli } from '../../../../scripts/lib/cli-exit.mjs';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const USAGE = 'usage: node adapter-run.mjs <campaignRoot> validate-sheet <creature|item> <file> --out <report>\n' +
  '       node adapter-run.mjs <campaignRoot> card-fields <file> --out <report>\n' +
  '       node adapter-run.mjs <campaignRoot> progression-event <kind> [--declared-by-master] --out <report>\n' +
  '       node adapter-run.mjs <campaignRoot> check-drafts <file,file,...> --out <report>\n' +
  '       node adapter-run.mjs <campaignRoot> info --out <report>';

function parseArgs(argv) {
  if (argv.length < 3) return null;
  const [root, operation, ...rest] = argv;
  const opts = { root, operation, kind: null, file: null, declared: false, out: null };
  if (operation === 'validate-sheet') {
    if (rest.length !== 4 || !['creature', 'item'].includes(rest[0]) || rest[2] !== '--out' || !rest[3]) return null;
    opts.kind = rest[0]; opts.file = rest[1]; opts.out = rest[3];
  } else if (operation === 'card-fields') {
    if (rest.length !== 3 || rest[1] !== '--out' || !rest[2]) return null;
    opts.file = rest[0]; opts.out = rest[2];
  } else if (operation === 'progression-event') {
    if ((rest.length !== 3 && rest.length !== 4) || !rest[0] || rest[rest.length - 2] !== '--out' || !rest.at(-1) || (rest.length === 4 && rest[1] !== '--declared-by-master')) return null;
    opts.kind = rest[0]; opts.declared = rest.length === 4; opts.out = rest.at(-1);
  } else if (operation === 'info') {
    if (rest.length !== 2 || rest[0] !== '--out' || !rest[1]) return null;
    opts.out = rest[1];
  } else if (operation === 'check-drafts') {
    if (rest.length !== 3 || rest[1] !== '--out' || !rest[2]) return null;
    opts.files = rest[0] === '' ? [] : rest[0].split(','); opts.out = rest[2];
  } else return null;
  return opts;
}

function relativePath(root, input) {
  if (path.isAbsolute(input) || input.includes('\\')) throw new Error(`path must be relative to campaign root: ${input}`);
  const target = path.resolve(root, input);
  const rel = path.relative(root, target);
  if (!rel || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) throw new Error(`path escapes campaign root: ${input}`);
  return target;
}

function fail(code, message) { return { ok: false, errors: [{ code, message }] }; }
function reportText(status, adapter, operation, language, result, problems = []) {
  return ['ADAPTER REPORT', `status: ${status}`, `adapter: ${adapter}`, `operation: ${operation}`, `language: ${language ?? 'unknown'}`,
    `result: ${JSON.stringify(result)}`, ...problems.map((problem) => `problem: ${problem}`), ''].join('\n');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args) { process.stderr.write(`${USAGE}\n`); exitWith(2); return; }
  const root = path.resolve(args.root);
  let outFile;
  try { outFile = relativePath(root, args.out); }
  catch (error) { process.stderr.write(`${error.message}\n`); exitWith(2); return; }

  let status = 'FAILED'; let adapterId = 'none'; let language = 'unknown'; let result;
  let draftProblems = [];
  if (args.operation === 'check-drafts' && args.files.length === 0) {
    result = fail('empty-list', 'draft list is empty');
  } else {
  const configResult = validateConfig(root);
  if (!configResult.ok || !configResult.config) {
    result = { ok: false, errors: configResult.errors };
  } else {
    const config = configResult.config;
    language = config.language?.main ?? 'unknown';
    adapterId = config.system?.adapter ?? 'unknown';
    if (adapterId === 'none') {
      status = 'NOT_APPLICABLE'; result = {};
    } else {
      const loaded = loadAdapter(PLUGIN_ROOT, adapterId);
      if (!loaded.ok) result = { ok: false, errors: loaded.errors };
      else if (!['it', 'en'].includes(language)) result = fail('unsupported-language', `unsupported language: ${language}`);
      else {
        try {
          if (args.operation === 'info') {
            result = { id: loaded.adapter.id, name: loaded.adapter.name, version: loaded.adapter.version,
              encounters: loaded.adapter.encounters, conditions: loaded.adapter.conditions ?? [], do_not: loaded.adapter.do_not ?? [] };
            status = 'OK';
          } else if (args.operation === 'progression-event') {
            result = progressionEvent(loaded.adapter, { kind: args.kind, declared_by_master: args.declared });
          } else if (args.operation === 'check-drafts') {
            if (args.files.some((file) => file === '')) throw new Error('draft list contains an empty path');
            const realRoot = fs.realpathSync(root);
            const checked = []; const skipped = []; const errors = [];
            for (const input of args.files) {
              const file = relativePath(root, input);
              const realFile = fs.realpathSync(file);
              const rel = path.relative(realRoot, realFile);
              if (!rel || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) throw new Error(`path escapes campaign root: ${input}`);
              const markdown = fs.readFileSync(realFile, 'utf8');
              const parsed = parseFrontmatter(markdown);
              if (parsed.errors.length) throw new Error(`${input}: ${parsed.errors.map((entry) => `line ${entry.line}: ${entry.message}`).join('; ')}`);
              const template = parsed.data?.template;
              const kind = template === 'enemy' || template === 'creature' ? 'creature' : template === 'item' ? 'item' : null;
              if (!kind) { skipped.push(input); continue; }
              const validation = validateSheet(loaded.adapter, kind, markdown, language);
              checked.push({ file: input, kind, ok: validation.ok });
              errors.push(...validation.errors.map((entry) => ({ ...entry, file: input })));
            }
            result = { checked, skipped };
            draftProblems = errors.map((entry) => `${entry.file}: ${entry.code}: ${entry.message}`);
            status = errors.length ? 'NEEDS_ATTENTION' : 'OK';
          } else {
            const file = relativePath(root, args.file);
            const realRoot = fs.realpathSync(root); const realFile = fs.realpathSync(file);
            const rel = path.relative(realRoot, realFile);
            if (!rel || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) throw new Error(`path escapes campaign root: ${args.file}`);
            const markdown = fs.readFileSync(realFile, 'utf8');
            result = args.operation === 'validate-sheet' ? validateSheet(loaded.adapter, args.kind, markdown, language) : cardFields(loaded.adapter, markdown, language);
          }
          if (!['info', 'check-drafts'].includes(args.operation)) status = result.ok ? 'OK' : 'NEEDS_ATTENTION';
        } catch (error) { result = fail('file-error', error.message); status = 'FAILED'; }
      }
    }
  }
  }
  const problems = draftProblems.length ? draftProblems : result?.errors?.map((entry) => `${entry.code}: ${entry.message}`) ?? (status === 'FAILED' ? ['failed: operation failed'] : status === 'NEEDS_ATTENTION' ? ['needs-attention: operation needs attention'] : []);
  const text = reportText(status, adapterId, args.operation, language, result, problems);
  try {
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, text, 'utf8');
  } catch (error) {
    // The requested report location itself may be unusable. Keep the operational
    // result visible and preserve the required successful operational exit.
    process.stderr.write(`cannot write report ${args.out}: ${error.message}\n`);
  }
  exitWith(0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runCli(main);
