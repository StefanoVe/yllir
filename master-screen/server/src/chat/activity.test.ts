import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { findClaudeCode } from '../agent/claude-provider.js';
import { safeActivity, toolActivity } from './activity.js';
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
