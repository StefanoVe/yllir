import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { findClaudeCode } from '../agent/claude-provider.js';
import { describeTool, safeActivity, safeSentence, toolActivity } from './activity.js';
import { campaignLanguage, langOf, TEXTS } from './text.js';

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) fs.rmSync(dirs.pop() as string, { recursive: true, force: true });
});

describe('toolActivity', () => {
  it('maps known tools to plain sentences in Italian and English', () => {
    assert.equal(toolActivity('Read', { file_path: '/x/y.md' }, 'it'), 'Sto leggendo un documento…');
    assert.equal(toolActivity('Read', { file_path: '/x/y.md' }, 'en'), 'Reading a document…');
    assert.equal(toolActivity('Write', {}, 'it'), 'Sto scrivendo una bozza…');
    assert.equal(toolActivity('Edit', {}, 'en'), 'Writing a draft…');
    assert.equal(toolActivity('Skill', {}, 'it'), 'Sto preparando la risposta…');
  });

  it('reads the engine command of a Bash call and maps it to a sentence', () => {
    const save = `node "/opt/yllir/scripts/engine.mjs" commit "/camp" --message "Nuova"`;
    const check = `node "/opt/yllir/scripts/engine.mjs" query "/camp" errors`;
    assert.equal(toolActivity('Bash', { command: save }, 'it'), 'Sto salvando le modifiche…');
    assert.equal(toolActivity('Bash', { command: check }, 'it'), 'Sto controllando i collegamenti…');
    assert.equal(toolActivity('Bash', { command: 'node "/opt/yllir/skills/a/scripts/x.mjs"' }, 'en'), 'Working…');
  });

  it('returns null for tools with no visible meaning', () => {
    assert.equal(toolActivity('ToolSearch', {}, 'it'), null);
  });
});

describe('safeActivity', () => {
  it('keeps a plain sentence', () => {
    assert.equal(safeActivity('  Sto cercando nei documenti…  ', 'it'), 'Sto cercando nei documenti…');
  });

  it('replaces paths, tool names and technical words with the generic sentence', () => {
    for (const bad of ['/Users/a/campaign/x.md', 'Bash running', 'Sto usando Read', 'git commit', 'mcp__yllir__search_docs', 'engine.mjs', 'il file x.md']) {
      assert.equal(safeActivity(bad, 'it'), TEXTS.it.working, bad);
    }
    assert.equal(safeActivity('', 'en'), TEXTS.en.working);
  });
});

describe('describeTool steps', () => {
  it('gives each skill its sentence and the images skill the image kind', () => {
    assert.deepEqual(describeTool('Skill', { skill: 'yllir:images' }, 'it'), { kind: 'image', text: 'Sto preparando l’immagine…' });
    assert.deepEqual(describeTool('Skill', { skill: 'yllir:build-world' }, 'en'), { kind: 'skill', text: 'Building the world…' });
    assert.deepEqual(describeTool('Skill', { skill: 'yllir:print' }, 'it'), { kind: 'skill', text: 'Sto preparando la stampa…' });
    assert.deepEqual(describeTool('Skill', { skill: 'yllir:unknown-thing' }, 'it'), { kind: 'skill', text: 'Sto preparando la risposta…' });
  });

  it('gives the sub-agent description when it is a short plain sentence, else the review sentence', () => {
    assert.deepEqual(describeTool('Agent', { description: 'Controllo la coerenza dei luoghi' }, 'it'), {
      kind: 'agent',
      text: 'Controllo la coerenza dei luoghi',
    });
    assert.equal(describeTool('Task', { description: 'Leggo /x/y.md' }, 'en')?.text, 'Checking the drafts…');
    assert.equal(describeTool('Task', { description: 'x'.repeat(81) }, 'en')?.text, 'Checking the drafts…');
  });

  it('names the image provider scripts without naming any service', () => {
    const root = '/opt/yllir/skills/library/images/providers/codex/scripts';
    assert.deepEqual(describeTool('Bash', { command: `node "/opt/yllir/skills/library/images/scripts/image-select.mjs" "/c"` }, 'it'), {
      kind: 'image',
      text: 'Scelgo come creare l’immagine…',
    });
    assert.equal(describeTool('Bash', { command: `node "/opt/yllir/skills/library/images/scripts/image-prompt.mjs" x` }, 'en')?.text, 'Preparing the image description…');
    assert.equal(describeTool('Bash', { command: `node "${root}/codex-run.mjs" x` }, 'it')?.text, 'Sto generando l’immagine, può volerci qualche minuto…');
    assert.equal(describeTool('Bash', { command: `node "${root}/comfyui-run.mjs" x` }, 'en')?.kind, 'image');
    assert.equal(describeTool('Bash', { command: `node "/opt/yllir/skills/library/images/scripts/image-place.mjs" x` }, 'it')?.text, 'Sto mettendo l’immagine nella scheda…');
    assert.equal(describeTool('Bash', { command: `node "/opt/yllir/skills/library/images/maps/render.mjs" x` }, 'en')?.text, 'Drawing the map…');
    for (const lang of ['it', 'en'] as const) {
      const sentence = describeTool('Bash', { command: `node "${root}/codex-run.mjs" x` }, lang)?.text ?? '';
      assert.ok(!/codex|comfy|g2d|openai|gpt/i.test(sentence), sentence);
    }
  });

  it('maps the Photoshop plugin tools to image steps in both languages', () => {
    const name = 'mcp__plugin_yllir_photoshop__photoshop_generate_image';
    assert.deepEqual(describeTool(name, {}, 'it'), { kind: 'image', text: 'Sto ritoccando l’immagine…' });
    assert.equal(describeTool(name, {}, 'en')?.text, 'Retouching the image…');
  });

  it('names a campaign document by its title, else by its file name, and a framework file as instructions', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-title-'));
    dirs.push(dir);
    const roots = { campaignRoot: dir, frameworkRoot: path.join(dir, 'yllir') };
    fs.mkdirSync(path.join(dir, 'characters'));
    fs.writeFileSync(path.join(dir, 'characters', 'mara.md'), 'Nessun titolo qui.\n');
    fs.writeFileSync(path.join(dir, 'characters', 'index.md'), '# Indice `dei` nomi\n\nTesto.\n');
    fs.writeFileSync(path.join(dir, 'characters', 'lungo.md'), `# ${'a'.repeat(90)}\n`);
    const read = (file: string, lang: 'it' | 'en') => describeTool('Read', { file_path: file }, lang, roots)?.text;
    assert.equal(read(path.join(dir, 'characters', 'mara.md'), 'it'), 'Sto leggendo «mara»…');
    assert.equal(read(path.join(dir, 'characters', 'index.md'), 'en'), 'Reading “Indice dei nomi”…');
    assert.equal(read(path.join(dir, 'characters', 'lungo.md'), 'it'), `Sto leggendo «${'a'.repeat(60)}»…`);
    assert.equal(read(path.join(dir, 'characters', 'missing.md'), 'it'), 'Sto leggendo «missing»…');
    assert.equal(read(path.join(dir, 'yllir', 'skills', 'x', 'SKILL.md'), 'it'), 'Sto rileggendo le mie istruzioni…');
    assert.equal(read(path.join(dir, '.campaign', 'state', 'a.md'), 'it'), 'Sto leggendo un documento…');
    assert.equal(read('characters/mara.md', 'en'), 'Reading “mara”…');
  });

  it('names the draft of a document by its heading only in the drafts folder', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-draft-'));
    dirs.push(dir);
    const roots = { campaignRoot: dir, frameworkRoot: path.join(dir, 'yllir') };
    const drafts = path.join(dir, '.campaign', 'drafts', 'taverna.md');
    const write = { file_path: drafts, content: '# Taverna del Porto\n\nTesto.' };
    assert.equal(describeTool('Write', write, 'it', roots)?.text, 'Sto scrivendo la bozza di «Taverna del Porto»…');
    assert.equal(describeTool('Edit', { file_path: drafts, new_string: '# Taverna\n' }, 'en', roots)?.text, 'Writing the draft of “Taverna”…');
    assert.equal(describeTool('Write', { file_path: drafts, content: 'Senza titolo' }, 'it', roots)?.text, 'Sto scrivendo una bozza…');
    assert.equal(describeTool('Write', { file_path: path.join(dir, 'characters', 'x.md'), content: '# X' }, 'it', roots)?.text, 'Sto scrivendo una bozza…');
  });
});

describe('safeSentence', () => {
  it('keeps a quoted title even when it has a word the filter forbids', () => {
    assert.equal(safeSentence('Sto leggendo «Index delle tracce»…', 'it'), 'Sto leggendo «Index delle tracce»…');
    assert.equal(safeSentence('Sto leggendo «Index»…', 'it'), 'Sto leggendo «Index»…');
  });

  it('replaces a sentence whose template is unsafe, title or not', () => {
    assert.equal(safeSentence('Sto usando Read: «Taverna»', 'it'), TEXTS.it.working);
    assert.equal(safeSentence('Sto leggendo “Taverna”…', 'en'), 'Sto leggendo “Taverna”…');
    assert.equal(safeSentence('/Users/a/x.md', 'en'), TEXTS.en.working);
  });
});

describe('campaign language', () => {
  it('reads language.main from campaign.yaml, English when missing', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-lang-'));
    dirs.push(dir);
    assert.equal(campaignLanguage(dir), 'en');
    fs.writeFileSync(path.join(dir, 'campaign.yaml'), 'campaign:\n  name: X\nlanguage:\n  main: it\n');
    assert.equal(campaignLanguage(dir), 'it');
    fs.writeFileSync(path.join(dir, 'campaign.yaml'), 'language:\n  main: "de"\n');
    assert.equal(campaignLanguage(dir), 'en');
    assert.equal(langOf('it'), 'it');
  });
});

describe('findClaudeCode', () => {
  it('prefers the executable on PATH, then the usual install locations', () => {
    const files = new Set(['/usr/local/bin/claude', '/custom/bin/claude']);
    const exists = (file: string) => files.has(file);
    assert.equal(findClaudeCode({ whichClaude: () => '/custom/bin/claude', exists, home: '/h', env: {}, platform: 'darwin' }), '/custom/bin/claude');
    assert.equal(findClaudeCode({ whichClaude: () => null, exists, home: '/h', env: {}, platform: 'darwin' }), '/usr/local/bin/claude');
  });

  it('returns null when nothing is installed', () => {
    assert.equal(findClaudeCode({ whichClaude: () => null, exists: () => false, home: '/h', env: {}, platform: 'darwin' }), null);
  });

  it('looks in the Windows install location', () => {
    const local = path.join(os.tmpdir(), 'LocalAppData');
    const target = path.join(local, 'Programs', 'claude', 'claude.exe');
    const found = findClaudeCode({
      whichClaude: () => null,
      exists: (file) => file === target,
      home: '/nonexistent-home',
      env: { LOCALAPPDATA: local },
      platform: 'win32',
    });
    assert.equal(found, path.resolve(target));
  });
});
