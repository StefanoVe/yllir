#!/usr/bin/env node
// Runs the item-manager library case in an isolated campaign copy and grades its
// state/report against a key stored outside that copy.
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  REPO_ROOT, appendResult, changedFiles, instructionsHash, listFiles,
  loadYamlMapping, parseCommonArgs, prepareCopy, printSummary, recordHeader,
  removeCopy, runClaude,
} from './lib/case-common.mjs';

const USAGE = 'usage: node testbench/runners/run-item-manager-case.mjs <caseDir> [--runs N] [--model haiku] [--keep] [--agent claude] [--setup-only] [--grade-only <campaignCopy>]';
const TIMEOUT_MS = 900000;
const SKILL_DIR = path.join(REPO_ROOT, 'yllir/skills/library/item-manager');
const STATE = path.join('.campaign/state/item-manager');
const DRAFT = path.join('.campaign/state/write/draft');
const read = (file) => { try { return fs.readFileSync(file, 'utf8'); } catch { return ''; } };

function instructionFiles() {
  return [...listFiles(SKILL_DIR), ...listFiles(path.join(REPO_ROOT, 'yllir/scripts'), { scriptsOnly: true })];
}
function graderHash(caseDir, fixtureDir) {
  const hash = crypto.createHash('sha256');
  for (const file of [path.join(caseDir, 'case.yaml'), path.join(fixtureDir, 'key.yaml'), fileURLToPath(import.meta.url)]) hash.update(fs.readFileSync(file));
  return hash.digest('hex').slice(0, 16);
}
function loadCase(caseDir) {
  const data = loadYamlMapping(path.join(caseDir, 'case.yaml'));
  for (const field of ['case', 'fixture', 'skill', 'mode', 'prompt']) if (typeof data[field] !== 'string') throw new Error(`case.yaml: ${field} missing`);
  if (!['create', 'check'].includes(data.mode)) throw new Error('case.yaml: mode must be create or check');
  return data;
}
function collectDrafts(campaign) {
  const dir = path.join(campaign, DRAFT);
  if (!fs.existsSync(dir)) return [];
  const files = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (e.isFile()) files.push(f); } };
  walk(dir); return files;
}
export function grade({ key, report, drafts, changed }) {
  const draft = drafts.map(read).join('\n');
  const corpus = [report, draft].join('\n');
  const checks = {};
  const needs = key.checks ?? {};
  const mark = (name, ok) => { if (needs[name] === true) checks[name] = Boolean(ok); };
  const stateOnly = changed.every((f) => f.startsWith('.campaign/state/'));
  const lineHas = (entity, evidence) => report.split('\n').some((line) => entity.test(line) && evidence.test(line));
  if (key.case === 'item-manager-create') {
    const publicText = draft.split('<!-- master -->')[0] ?? '';
    const masterText = draft.split('<!-- master -->')[1] ?? '';
    const descriptions = publicText.split(/## (?:In breve|Descrizione)\s*/).slice(1);
    const brief = descriptions[0]?.split(/## /)[0] ?? '';
    const full = descriptions[1]?.split(/## /)[0] ?? '';
    const words = (s) => s.match(/[\p{L}\p{N}]+/gu) ?? [];
    const sentenceLengths = (s) => s.split(/[.!?]+/).map((x) => words(x).length).filter(Boolean);
    const plainTone = [...sentenceLengths(brief), ...sentenceLengths(full)].every((n) => n <= 28) && !/ineffabile|ancestrale|sussurra al destino|un mare di/i.test(brief + full);
    mark('draft_for_requested_item', /Sigillo di Cenere/i.test(draft) && /disco di bronzo/i.test(publicText) && /tre tacche/i.test(publicText));
    mark('respects_custom_tone', plainTone);
    mark('brief_matches_full', /## In breve[\s\S]*## Descrizione[\s\S]*## Effetti/.test(draft) && /bronzo/i.test(brief) && /bronzo/i.test(full) && /tacche/i.test(brief) && /tacche/i.test(full));
    const effects = draft.split(/## Effetti\s*/i)[1]?.split(/\n## |\n<!-- master -->/i)[0] ?? '';
    mark('no_invented_effects_or_facts', /luce dorata/i.test(effects) && /(?:apre|aprire|apertura).{0,80}condott|condott.{0,80}(?:apre|aprire|apertura)/i.test(effects) && !/argento lunare/i.test(publicText) && !/nessun effetto di gioco/i.test(effects));
    mark('keeps_secret_master_only', /argento lunare/i.test(masterText) && !/argento lunare/i.test(publicText));
    mark('valid_order_and_final_master_block', /## In breve[\s\S]*## Descrizione[\s\S]*## Effetti[\s\S]*<!-- master -->[\s\S]*<!-- \/master -->\s*$/.test(draft) && !/\[(?:Write|Scrivi|To be defined|Da definire)/i.test(draft));
    mark('no_secret_in_report', !/argento lunare/i.test(report));
    mark('no_duplicate_for_existing_alias', lineHas(/Luce di Ada/i, /EXISTS|duplicate|alias|omonim|ambig/i));
    mark('no_draft_for_scenery_cup', !/tazza/i.test(draft));
    const lanternaSearch = report.split('\n').find((line) => /Lanterna/i.test(line) && /partial|parzial|match|risultat|due|two|both/i.test(line)) ?? '';
    const hasGuado = /Lanterna del Guado|lanterna-del-guado/i.test(lanternaSearch);
    const hasTorre = /Lanterna della Torre|lanterna-della-torre/i.test(lanternaSearch);
    const lanternQuestion = report.split('\n').find((line) => /(?:which|quale).{0,100}Lanterna/i.test(line) && /\bor\b|\boppure\b/i.test(line)) ?? '';
    const asksBetweenBoth = /Lanterna del Guado|lanterna-del-guado/i.test(lanternQuestion) && /Lanterna della Torre|lanterna-della-torre/i.test(lanternQuestion);
    mark('reports_both_partial_lanterna_matches', hasGuado && hasTorre || asksBetweenBoth);
    mark('no_draft_for_ambiguous_lanterna', !/Lanterna (?:del Guado|della Torre)/i.test(draft));
    mark('no_campaign_file_written', stateOnly);
  } else {
    const lines = report.split('\n');
    const hasIssue = (code, file, evidence) => lines.some((line) => new RegExp(`\\b${code}\\b`, 'i').test(line) && new RegExp(file, 'i').test(line) && evidence.test(line));
    const hasEntityEvidence = (entity, evidence) => lines.some((line) => entity.test(line) && evidence.test(line));
    mark('detects_missing_brief_on_legacy_sheet', hasIssue('legacy-brief', 'Oggetti/Cerchio\\.md|Cerchio', /(?:missing|manca|mancante|assenza).{0,60}(?:brief|In breve)|(?:brief|In breve).{0,60}(?:missing|manca|mancante|assenza)/i));
    mark('detects_brief_full_contradiction', lines.some((line) => /(?:description-conflict|brief-description-mismatch)/i.test(line) && /Oggetti\/Scatola\.md|Scatola/i.test(line) && /(?:brief|In breve|vuota|empty).{0,100}(?:contains|contains coarse salt|while|says|coarse salt)|(?:contains|contains coarse salt|while|says|coarse salt).{0,100}(?:brief|In breve|vuota|empty)/i.test(line)));
    mark('detects_secret_outside_master_block', lines.some((line) => /(?:public-secret-leak|master-only-leak)/i.test(line) && /Oggetti\/Scatola\.md|Scatola/i.test(line) && /(?:secret|segreto|riservat).{0,100}(?:public|pubblic|fuori|outside)|(?:public|pubblic|fuori|outside).{0,100}(?:secret|segreto|riservat)/i.test(line)));
    mark('detects_medallion_omitted_from_items', hasIssue('missing-item-declaration', 'Scena 1\\.md|medaglione-di-ada', /(?:medallion|medaglione).{0,100}(?:absent|omitted|missing|assent|omess|items declaration|dichiarazione)/i));
    mark('detects_missing_sheet_for_relevant_key', hasIssue('missing-item-sheet', 'Scena 2\\.md|Chiave della Cisterna', /(?:Chiave della Cisterna|cisterna).{0,100}(?:no matching subject|no sheet|missing|senza scheda|assenza)/i));
    const question = lines.find((line) => /^question:/i.test(line)) ?? '';
    const declaration = lines.find((line) => /missing-item-declaration/i.test(line)) ?? '';
    const conflict = lines.some((line) => /(?:plot-sheet-conflict|Medaglione di Ada)/i.test(line) && /medallion|medaglione/i.test(line) && /(?:effect|effetto)/i.test(line) && /(?:plot|trama).{0,100}(?:sheet|scheda)|(?:sheet|scheda).{0,100}(?:plot|trama)|no game effect|nessun effetto/i.test(line));
    mark('asks_about_plot_vs_sheet_effect_conflict', /medallion|medaglione/i.test(question) && /(?:effect|effetto)/i.test(question) && /(?:seal|seals|sealing|sigilla|diga|dam)/i.test(question) && /(?:effect|effetto|correction|corrected|correzion)/i.test(question) && /medallion|medaglione/i.test(declaration) || conflict && /(?:question|decision|master|domanda|master)/i.test(report));
    const actionable = report.split(/(?:open points|punti aperti)\s*:/i)[0];
    const problems = actionable.split(/(?:problems|problemi)\s*:/i).slice(1).join('\n');
    const isMissingFinding = (name) => problems.split('\n').some((line) => new RegExp(name, 'i').test(line) && /(?:manca|missing|senza scheda|no sheet)/i.test(line));
    mark('does_not_flag_scenery_lantern', !isMissingFinding('Lanterna'));
    mark('does_not_flag_excluded_sigillo', !isMissingFinding('sigillo di cenere'));
    mark('treats_ada_alias_collision_as_ambiguous', hasEntityEvidence(/missing-item-declaration/i, /first .{0,30}character|Ada.{0,70}(?:character|personaggio).{0,100}(?:title|titolo|medallion|medaglione)/i) || lines.some((line) => /Ada/i.test(line) && /(?:separate character|character subject|personaggio separato|alias|different subject|distinct)/i.test(line)) || lineHas(/Ada/i, /ambig|omonim|multiple matches|which/i));
    mark('does_not_rewrite_existing_sheets', stateOnly);
    mark('reports_scope_and_counts', /(?:coverage|scope|copert|ambito)/i.test(report) && /(?:checked|controllat|files|file|event|schede)/i.test(report));
  }
  return { checks, failures: Object.entries(checks).filter(([, value]) => !value).map(([name]) => name), pass: Object.values(checks).length > 0 && Object.values(checks).every(Boolean) };
}

// Runs the library skill with claude -p. The error text keeps no case input: the
// command line that execFileSync puts in its message holds the prompt, so it is dropped.
function runLibraryAgent({ cwd, prompt, model, timeoutMs, redactions = [] }) {
  const result = runClaude({ cwd, prompt, model, timeoutMs });
  if (result.ok) return result;
  let detail = result.error ?? 'claude failed';
  if (detail.startsWith('Command failed:')) detail = 'claude exited with an error (command line omitted: it holds the case input)';
  for (const secret of [prompt, ...redactions].filter(Boolean)) detail = detail.split(secret).join('[omitted input]');
  if (detail.length > 400) detail = `${detail.slice(0, 400)}…`;
  return { ...result, error: detail, failure_type: 'infrastructure' };
}

async function main() {
  const setupOnly = process.argv.includes('--setup-only');
  const recordGrade = process.argv.includes('--record-grade');
  const args = process.argv.slice(2).filter((arg) => !['--setup-only', '--record-grade'].includes(arg));
  const opts = parseCommonArgs(args, USAGE, { valueOptions: ['--grade-only', '--run', '--execution-source'] });
  const caseData = loadCase(opts.caseDir);
  const fixtureDir = path.join(REPO_ROOT, 'testbench/fixtures', caseData.fixture);
  const key = loadYamlMapping(path.join(fixtureDir, 'key.yaml'));
  const hash = instructionsHash(instructionFiles());
  const gradeHash = graderHash(opts.caseDir, fixtureDir);
  if (opts.values['--grade-only']) {
    const campaign = path.resolve(opts.values['--grade-only']);
    const report = read(path.join(campaign, STATE, 'report.txt'));
    const drafts = collectDrafts(campaign);
    const hasReport = fs.existsSync(path.join(campaign, STATE, 'report.txt'));
    const graded = hasReport
      ? grade({ key, report, drafts, changed: changedFiles(campaign) })
      : { checks: {}, failures: ['required item-manager report missing'], pass: false };
    const record = {
      ...recordHeader({ agent: opts.agent, modelLabel: opts.modelLabel }),
      case: caseData.case,
      run: opts.values['--run'] ? Number(opts.values['--run']) : undefined,
      date: recordGrade ? new Date().toISOString() : undefined,
      execution_source: recordGrade ? opts.values['--execution-source'] : undefined,
      instructions_hash: hash,
      grader_hash: gradeHash,
      permission_mode: recordGrade ? 'collaboration-subagent' : undefined,
      pass: graded.pass,
      checks: graded.checks,
      failures: graded.failures,
      report,
      draft_paths: drafts.map((file) => path.relative(campaign, file)),
    };
    if (recordGrade) {
      if (record.execution_source !== 'collaboration-subagent' || !Number.isInteger(record.run) || record.run < 1) throw new Error('--record-grade requires --execution-source collaboration-subagent and --run N');
      appendResult(caseData.case, record);
    }
    console.log(JSON.stringify(record));
    process.exitCode = graded.pass ? 0 : 1;
    return;
  }
  if (setupOnly) {
    const campaign = prepareCopy(fixtureDir);
    console.log(campaign);
    return;
  }
  const results = [];
  for (let run = 1; run <= opts.runs; run++) {
    let campaign;
    try {
      campaign = prepareCopy(fixtureDir);
      fs.mkdirSync(path.join(campaign, STATE), { recursive: true });
      fs.mkdirSync(path.join(campaign, DRAFT), { recursive: true });
      const inputs = Object.fromEntries(Object.entries(caseData).filter(([key]) => !['prompt', 'case', 'fixture', 'skill', 'mode'].includes(key)));
      const prompt = `Use the item-manager library skill directly. Read and follow ${path.join(SKILL_DIR, 'SKILL.md')}; this isolated component evaluation starts at that library skill, so do not route through the campaign entry skill. Campaign root: ${campaign}. Perform mode ${caseData.mode} using these case inputs: ${JSON.stringify(inputs)}. For create, write only to the prescribed state draft; for check, write only its report/state files. Do not modify campaign documents. Master request: ${caseData.prompt}`;
      const agentResult = runLibraryAgent({ cwd: campaign, prompt, model: opts.model, timeoutMs: TIMEOUT_MS, redactions: [caseData.details] });
      const reportPath = path.join(campaign, STATE, 'report.txt');
      const report = read(reportPath);
      const drafts = collectDrafts(campaign);
      const noReport = !fs.existsSync(reportPath);
      const graded = agentResult.ok && !noReport
        ? grade({ key, report, drafts, changed: changedFiles(campaign) })
        : { checks: {}, failures: [agentResult.ok ? 'required item-manager report missing' : `agent failed: ${agentResult.error}`], pass: false };
      const record = {
        ...recordHeader({ agent: opts.agent, modelLabel: opts.modelLabel }),
        case: caseData.case, run, date: new Date().toISOString(), instructions_hash: hash, grader_hash: gradeHash,
        permission_mode: agentResult.permission_mode, pass: graded.pass, checks: graded.checks,
        failures: graded.failures, report, draft_paths: drafts.map((f) => path.relative(campaign, f)),
        kept_campaign: opts.keep ? campaign : undefined,
        cost_usd: agentResult.cost_usd, duration_ms: agentResult.duration_ms,
        error: agentResult.error,
        failure_type: agentResult.failure_type,
      };
      appendResult(caseData.case, record); results.push(record);
      console.log(JSON.stringify(record));
    } finally { if (campaign && !opts.keep) removeCopy(campaign); }
  }
  process.exitCode = printSummary(results, opts.modelLabel, hash, opts.agent) === results.length ? 0 : 1;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((err) => { console.error(err.message); process.exitCode = 2; });
