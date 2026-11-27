// Offline end-to-end test of the structured convert (issue #138): the report and the apply run on the
// two reference plans (testbench/cases/convert/<fixture>/plan.json) inside a real empty campaign. The
// fixture folder is hashed before and after, the engine check and the link check must pass, and the
// traps of the answer key (secrets, homonyms, shared alias, hypothesis, missing and ambiguous links)
// are checked on the drafts. No model, no network.
//
// Usage: node --test testbench/runners/convert-structured.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadYamlMapping } from './lib/case-common.mjs';
import { checkLinks } from '../../yllir/scripts/lib/links/check-links.mjs';
import { findConventions, findLinks } from '../../yllir/skills/library/convert-campaign/lib/vault-parse.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const INIT = path.join(REPO, 'yllir', 'skills', 'library', 'new-campaign', 'scripts', 'init-campaign.mjs');
const ADD_CATEGORY = path.join(REPO, 'yllir', 'scripts', 'add-category.mjs');
const STRUCTURE = path.join(REPO, 'yllir', 'skills', 'library', 'convert-campaign', 'convert-structure.mjs');
const APPLY = path.join(REPO, 'yllir', 'skills', 'library', 'convert-campaign', 'convert-apply.mjs');
const ENGINE = path.join(REPO, 'yllir', 'scripts', 'engine.mjs');
const CAMPAIGN_NAME = 'Prova strutturata';

// The categories the campaign needs before the batch is checked (new-campaign adds them the same way).
const CASES = [
  {
    name: 'obsidian',
    fixture: 'convert-obsidian-input',
    casesDir: path.join(REPO, 'testbench', 'cases', 'convert', 'obsidian'),
    categories: [
      ['luoghi', 'Luoghi', 'places'],
      ['personaggi', 'Personaggi', 'subjects'],
      ['storia', 'Storia', 'free'],
    ],
  },
  {
    name: 'linked',
    fixture: 'convert-linked-input',
    casesDir: path.join(REPO, 'testbench', 'cases', 'convert', 'linked'),
    categories: [
      ['mondo', 'Mondo', 'places'],
      ['personaggi', 'Personaggi', 'subjects'],
      ['oggetti', 'Oggetti', 'objects'],
      ['storia', 'Storia', 'free'],
    ],
  },
];

function runNode(args) {
  return spawnSync(process.execPath, args, { encoding: 'utf8' });
}

/** The JSON a script prints, without its last line `exit: <code>`. */
function parseOutput(stdout) {
  return JSON.parse(stdout.replace(/\nexit: \d+\s*$/, ''));
}

/** Sha-256 of every file under root, by posix relative path. Dot folders included. */
function hashTree(root) {
  const out = {};
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        const rel = path.relative(root, full).split(path.sep).join('/');
        out[rel] = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');
      }
    }
  };
  walk(root);
  return out;
}

function trimBlank(lines) {
  let a = 0;
  let b = lines.length;
  while (a < b && lines[a].trim() === '') a++;
  while (b > a && lines[b - 1].trim() === '') b--;
  return lines.slice(a, b);
}

/** Collapses runs of blank lines into one, so that the comparison does not depend on blank spacing. */
function collapse(lines) {
  const out = [];
  for (const line of lines) {
    if (line.trim() === '' && out.length > 0 && out[out.length - 1].trim() === '') continue;
    out.push(line);
  }
  return out;
}

/** The text a link becomes in the public text (spec section 6): its label, else the last segment of its target. */
function linkText(link) {
  if (link.form === 'markdown') return link.label ?? '';
  if (link.embed) return link.label ?? '';
  if (link.label !== null && link.label !== undefined) return link.label;
  return link.target.split('/').pop().replace(/\.md$/i, '');
}

function reduceLinks(line) {
  let out = line;
  for (const link of [...findLinks([line], 1)].reverse()) {
    out = out.slice(0, link.col) + linkText(link) + out.slice(link.end);
  }
  return out;
}

/** The public body of a draft: after the metadata, the title and the image line, before the reserved block. */
function draftBody(draft, doc) {
  const lines = draft.split('\n');
  let i = lines.indexOf('-->') + 1;
  while (lines[i] === '') i++;
  assert.match(lines[i], /^# /, `${doc.target}: title line`);
  i++;
  if (doc.image) {
    while (lines[i] === '') i++;
    assert.match(lines[i], /^!\[/, `${doc.target}: image line`);
    i++;
  }
  let rest = lines.slice(i);
  const master = rest.indexOf('<!-- master -->');
  if (master >= 0) rest = rest.slice(0, master);
  return collapse(trimBlank(rest.map(reduceLinks)));
}

/** The expected public body of a document, from its parts in the input (spec section 6). */
function expectedBody(doc, plan, inputDir) {
  const moved = new Set(
    Object.entries(plan.masterConventions)
      .filter(([, value]) => value === 'master')
      .map(([id]) => id),
  );
  const pieces = [];
  doc.parts.forEach((part, index) => {
    const lines = readLines(path.join(inputDir, part.file));
    const drop = new Set();
    for (const convention of findConventions(lines, 1)) {
      if (moved.has(convention.id) && convention.start >= part.from && convention.end <= part.to) {
        for (let n = convention.start; n <= convention.end; n++) drop.add(n);
      }
    }
    let body = [];
    for (let n = part.from; n <= part.to; n++) if (!drop.has(n)) body.push(lines[n - 1]);
    body = trimBlank(body);
    if (index === 0 && body.length > 0 && /^# /.test(body[0])) body = trimBlank(body.slice(1));
    if (body.length === 0) return;
    if (part.heading) body = [part.heading, '', ...body];
    pieces.push(body);
  });
  const joined = [];
  pieces.forEach((piece, i) => {
    if (i > 0) joined.push('');
    joined.push(...piece);
  });
  return collapse(trimBlank(joined.map(reduceLinks)));
}

/** The lines of a file, without the empty string that a final newline adds. */
function readLines(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

function publicOf(text) {
  const master = text.indexOf('<!-- master -->');
  return master >= 0 ? text.slice(0, master) : text;
}

function reservedOf(text) {
  const start = text.indexOf('<!-- master -->');
  if (start < 0) return '';
  const end = text.indexOf('<!-- /master -->', start);
  return end < 0 ? text.slice(start) : text.slice(start, end);
}

function metadataOf(text) {
  return text.slice(0, text.indexOf('-->'));
}

function runCase(def) {
  const inputDir = path.join(REPO, 'testbench', 'fixtures', def.fixture);
  const key = loadYamlMapping(path.join(def.casesDir, 'key.yaml'));
  const planRaw = fs.readFileSync(path.join(def.casesDir, 'plan.json'), 'utf8');
  const plan = JSON.parse(planRaw);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-structured-'));
  try {
    // 1. An empty Italian campaign, with the categories the plan writes into.
    const campaign = path.join(tmp, 'campaign');
    const init = runNode([INIT, campaign, '--name', CAMPAIGN_NAME, '--language', 'it', '--register', 'plain']);
    assert.equal(init.status, 0, `init-campaign: ${init.stdout}${init.stderr}`);
    for (const [id, folder, type] of def.categories) {
      const added = runNode([ADD_CATEGORY, campaign, '--id', id, '--folder', folder, '--type', type]);
      assert.equal(added.status, 0, `add-category ${folder}: ${added.stdout}${added.stderr}`);
    }

    // 2. The report, with the fixture hashed before and after.
    const before = hashTree(inputDir);
    const report = runNode([STRUCTURE, inputDir, '--out', path.join(tmp, 'report.json')]);
    assert.equal(report.status, 0, `convert-structure: ${report.stdout}${report.stderr}`);

    // 3. The apply of the plan, with the input path filled in.
    const planPath = path.join(campaign, '.campaign', 'state', 'convert', 'structured-plan.json');
    fs.mkdirSync(path.dirname(planPath), { recursive: true });
    fs.writeFileSync(planPath, planRaw.replaceAll('"{{INPUT}}"', JSON.stringify(inputDir)));
    const applied = runNode([APPLY, campaign, '--plan', planPath]);
    assert.equal(applied.status, 0, `convert-apply: ${applied.stdout}${applied.stderr}`);
    const result = parseOutput(applied.stdout);
    assert.equal(result.ok, true, `apply errors: ${JSON.stringify(result.errors)}`);
    assert.deepEqual(hashTree(inputDir), before, 'the input folder changed');

    // 4. Coverage: every Markdown file is routed, uncovered lines are headings only, one document per target.
    assert.deepEqual(result.unrouted, [], 'unrouted Markdown files');
    assert.equal(result.files.length, plan.documents.length, 'one draft per document');
    // The opening lines of a split file before its first subject are in no document (author decision):
    // the key names them in split_intro, and they are the only non-heading lines allowed to be uncovered.
    const introFile = key.split_intro?.file ?? null;
    const introLines = (key.split_intro?.lines ?? []).map(Number);
    if (introFile !== null) {
      assert.ok(result.uncovered.some((gap) => gap.file === introFile), `${introFile} has no uncovered intro`);
    }
    for (const gap of result.uncovered) {
      const lines = readLines(path.join(inputDir, gap.file));
      for (const n of gap.lines) {
        const allowed = lines[n - 1].startsWith('#') || (gap.file === introFile && introLines.includes(n));
        assert.ok(allowed, `uncovered line ${gap.file}:${n} is neither a heading nor the split intro: ${lines[n - 1]}`);
      }
      if (gap.file === introFile) {
        const headingLines = lines.map((l, i) => (l.startsWith('#') ? i + 1 : 0)).filter((n) => n > 0);
        const expected = [...headingLines, ...introLines].sort((a, b) => a - b);
        assert.deepEqual([...gap.lines].sort((a, b) => a - b), expected, `uncovered lines of ${introFile}`);
      }
    }

    // 5. The engine check on the drafts.
    const check = runNode([
      ENGINE,
      'check',
      campaign,
      '--files',
      result.files.join(','),
      '--sources',
      result.sources.join(','),
    ]);
    const checked = parseOutput(check.stdout);
    assert.equal(checked.ok, true, `engine check errors: ${JSON.stringify(checked.errors)}`);

    // 6. The drafts go to their final places; the link check must find nothing.
    for (const target of result.files) {
      const to = path.join(campaign, target);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(path.join(campaign, '.campaign', 'drafts', target), to);
    }
    const links = checkLinks(campaign, { files: result.files });
    assert.deepEqual(links.errors, [], `link check: ${JSON.stringify(links.errors)}`);

    // 7. Traps of the answer key, on the drafts.
    const drafts = new Map(
      result.files.map((target) => [target, fs.readFileSync(path.join(campaign, '.campaign', 'drafts', target), 'utf8')]),
    );
    for (const phrase of key.secret_texts) {
      const needle = phrase.toLowerCase();
      for (const [target, text] of drafts) {
        assert.ok(!publicOf(text).toLowerCase().includes(needle), `secret "${phrase}" in public text of ${target}`);
      }
      assert.ok(
        [...drafts.values()].some((text) => reservedOf(text).toLowerCase().includes(needle)),
        `secret "${phrase}" is in no master-only block`,
      );
    }
    assert.ok(
      [...drafts.values()].some((text) => publicOf(text).includes(key.hypothesis_phrase)),
      `hypothesis phrase missing from every document: ${key.hypothesis_phrase}`,
    );
    const homonymDocs = key.homonym_files.map((file) => plan.documents.find((doc) => doc.parts.some((part) => part.file === file)));
    assert.ok(homonymDocs.every(Boolean), 'a homonym file is in no document');
    assert.notEqual(homonymDocs[0].target, homonymDocs[1].target, 'the homonyms are one document');
    assert.notEqual(homonymDocs[0].meta.id, homonymDocs[1].meta.id, 'the homonyms share an id');
    const homonymPublic = homonymDocs.map((doc) => publicOf(drafts.get(doc.target)).toLowerCase());
    assert.ok(homonymPublic[0].includes(key.homonym_words[0]), `${homonymDocs[0].target} does not say "${key.homonym_words[0]}"`);
    assert.ok(homonymPublic[1].includes(key.homonym_words[1]), `${homonymDocs[1].target} does not say "${key.homonym_words[1]}"`);
    for (const text of homonymPublic) {
      assert.ok(!key.homonym_words.every((word) => text.includes(word)), 'a homonym document says both words');
    }
    for (const subject of key.shared_alias_subjects) {
      const doc = plan.documents.find((candidate) => candidate.title === subject);
      assert.ok(doc, `no document titled ${subject}`);
      assert.ok(metadataOf(drafts.get(doc.target)).includes(key.shared_alias), `${subject} lost the alias ${key.shared_alias}`);
    }
    for (const raw of key.missing_links) {
      assert.ok(
        result.plainLinks.some((link) => link.raw === raw && link.reason === 'missing'),
        `missing link ${raw} is not plain text with reason missing`,
      );
    }
    for (const raw of key.ambiguous_links) {
      assert.ok(
        result.plainLinks.some((link) => link.raw === raw && link.reason === 'ambiguous'),
        `ambiguous link ${raw} is not plain text with reason ambiguous`,
      );
    }

    // 8. Invariant: the public text of every draft is the public text of its parts.
    for (const doc of plan.documents) {
      assert.deepEqual(draftBody(drafts.get(doc.target), doc), expectedBody(doc, plan, inputDir), `invariant of ${doc.target}`);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

for (const def of CASES) {
  test(`structured convert, ${def.name} fixture: report, apply, check and traps`, () => runCase(def));
}
