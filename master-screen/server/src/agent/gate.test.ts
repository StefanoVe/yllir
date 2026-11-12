import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, before, after } from 'node:test';
import { isAllowed, isAllowedCommand, type GateContext } from './gate.js';

let tmp: string;
let campaign: string;
let framework: string;
let ctx: GateContext;

function bash(command: string) {
  return isAllowed('Bash', { command }, ctx);
}

function allowed(decision: { allow: boolean }): boolean {
  return decision.allow === true;
}

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-gate-'));
  campaign = path.join(tmp, 'campaign');
  framework = path.join(tmp, 'yllir');
  fs.mkdirSync(path.join(campaign, '.campaign', 'drafts'), { recursive: true });
  fs.mkdirSync(path.join(campaign, '.campaign', 'state'), { recursive: true });
  fs.mkdirSync(path.join(campaign, 'characters'), { recursive: true });
  fs.writeFileSync(path.join(campaign, 'characters', 'mara.md'), '# Mara\n');
  fs.mkdirSync(path.join(framework, 'scripts'), { recursive: true });
  ctx = { campaignRoot: campaign, frameworkRoot: framework };
});

after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('read tools and the MCP tools', () => {
  it('allows Read, Glob, Grep, Skill', () => {
    for (const name of ['Read', 'Glob', 'Grep', 'Skill']) {
      assert.equal(allowed(isAllowed(name, { file_path: path.join(campaign, 'x.md') }, ctx)), true, name);
    }
  });

  it('allows the two in-process tools', () => {
    assert.equal(allowed(isAllowed('mcp__yllir__search_docs', { query: 'Mara' }, ctx)), true);
    assert.equal(allowed(isAllowed('mcp__yllir__open_document', { path: 'characters/mara.md' }, ctx)), true);
  });

  it('denies other tools with a plain reason', () => {
    for (const name of ['WebFetch', 'WebSearch', 'NotebookEdit', 'TodoWrite', 'mcp__other__x']) {
      const decision = isAllowed(name, {}, ctx);
      assert.equal(decision.allow, false, name);
      if (!decision.allow) assert.match(decision.reason, /not allowed/i);
    }
  });
});

describe('Write and Edit: drafts only', () => {
  it('allows a file inside the drafts folder, relative or absolute', () => {
    assert.equal(allowed(isAllowed('Write', { file_path: '.campaign/drafts/mara.md' }, ctx)), true);
    assert.equal(
      allowed(isAllowed('Edit', { file_path: path.join(campaign, '.campaign', 'drafts', 'sub', 'a.md') }, ctx)),
      true,
    );
  });

  it('denies canon files, the state folder and the drafts folder itself', () => {
    for (const file of [
      'characters/mara.md',
      'campaign.yaml',
      '.campaign/state/master-screen/chat.json',
      '.campaign/drafts',
      '.campaign/drafts/',
    ]) {
      assert.equal(allowed(isAllowed('Write', { file_path: file }, ctx)), false, file);
    }
  });

  it('denies path traversal out of the drafts folder', () => {
    assert.equal(allowed(isAllowed('Write', { file_path: '.campaign/drafts/../../characters/x.md' }, ctx)), false);
    assert.equal(allowed(isAllowed('Edit', { file_path: '../outside.md' }, ctx)), false);
    assert.equal(
      allowed(isAllowed('Write', { file_path: path.join(campaign, '.campaign', 'drafts', '..', 'a.md') }, ctx)),
      false,
    );
  });

  it('denies a symlink inside drafts that points out of drafts', () => {
    const link = path.join(campaign, '.campaign', 'drafts', 'link-to-canon');
    fs.symlinkSync(path.join(campaign, 'characters'), link, 'dir');
    try {
      assert.equal(allowed(isAllowed('Write', { file_path: '.campaign/drafts/link-to-canon/new.md' }, ctx)), false);
      assert.equal(allowed(isAllowed('Write', { file_path: '.campaign/drafts/link-to-canon/mara.md' }, ctx)), false);
    } finally {
      fs.rmSync(link, { force: true });
    }
  });

  it('denies a symlink file inside drafts that points at a canon file', () => {
    const link = path.join(campaign, '.campaign', 'drafts', 'mara-link.md');
    fs.symlinkSync(path.join(campaign, 'characters', 'mara.md'), link);
    try {
      assert.equal(allowed(isAllowed('Edit', { file_path: '.campaign/drafts/mara-link.md' }, ctx)), false);
    } finally {
      fs.rmSync(link, { force: true });
    }
  });

  it('allows a draft path whose folders do not exist yet', () => {
    assert.equal(allowed(isAllowed('Write', { file_path: '.campaign/drafts/new/deep/a.md' }, ctx)), true);
  });
});

describe('Bash: framework scripts only', () => {
  it('allows node with a quoted framework script', () => {
    const script = path.join(framework, 'scripts', 'engine.mjs');
    assert.equal(bash(`node "${script}" query "${campaign}" find Mara`).allow, true);
    assert.equal(bash(`node "${script}" index "${campaign}"`).allow, true);
  });

  it('allows a skill script, quoted', () => {
    const script = path.join(framework, 'skills', 'library', 'linker', 'scripts', 'linker.mjs');
    assert.equal(bash(`node "${script}" --help`).allow, true);
  });

  it('allows the unquoted form when the path has no spaces', () => {
    const script = path.join(framework, 'scripts', 'engine.mjs');
    assert.ok(!script.includes(' '));
    assert.equal(bash(`node ${script} query ${campaign} find Mara`).allow, true);
  });

  it('requires quotes when the framework path has spaces', () => {
    const spaced = path.join(tmp, 'Yllir Plugin');
    const spacedCtx = { campaignRoot: campaign, frameworkRoot: spaced };
    const script = path.join(spaced, 'scripts', 'engine.mjs');
    assert.equal(isAllowed('Bash', { command: `node "${script}" index "${campaign}"` }, spacedCtx).allow, true);
    assert.equal(isAllowed('Bash', { command: `node ${script} index ${campaign}` }, spacedCtx).allow, false);
  });

  it('allows quoted arguments that contain spaces', () => {
    const script = path.join(framework, 'scripts', 'engine.mjs');
    assert.equal(bash(`node "${script}" query "${campaign}" find "Mara Veloce"`).allow, true);
  });

  it('denies every forbidden character, whatever the rest of the line', () => {
    const script = path.join(framework, 'scripts', 'engine.mjs');
    for (const bad of [';', '|', '&', '>', '<', '$', '`', '\n', '\r', '(', ')', '*', '?', '[', ']', '{', '}', '~']) {
      const command = `node "${script}" query "${campaign}" find Mara${bad}`;
      assert.equal(bash(command).allow, false, JSON.stringify(bad));
    }
  });

  it('denies a forbidden character even inside a quoted argument', () => {
    const script = path.join(framework, 'scripts', 'engine.mjs');
    assert.equal(bash(`node "${script}" query "${campaign}" find "a;b"`).allow, false);
    assert.equal(bash(`node "${script}" query "${campaign}" find "$HOME"`).allow, false);
    assert.equal(bash(`node "${script}" query "${campaign}" find "\`id\`"`).allow, false);
  });

  it('denies path traversal in the script path', () => {
    assert.equal(bash(`node "${framework}/scripts/../../bin/evil.mjs"`).allow, false);
    assert.equal(bash(`node "${framework}/skills/../scripts/engine.mjs" index x`).allow, false);
    assert.equal(bash(`node ${framework}/scripts/../scripts/engine.mjs index x`).allow, false);
  });

  it('denies git in every form', () => {
    assert.equal(bash('git status').allow, false);
    assert.equal(bash(`git -C "${campaign}" commit -m x`).allow, false);
    assert.equal(bash(`git -C ${campaign} log`).allow, false);
  });

  it('denies rm, curl, and any other command', () => {
    assert.equal(bash(`rm -rf "${campaign}"`).allow, false);
    assert.equal(bash('curl https://example.invalid').allow, false);
    assert.equal(bash('ls').allow, false);
    assert.equal(bash('/usr/bin/env node x').allow, false);
    assert.equal(bash('').allow, false);
  });

  it('denies node running anything that is not a framework script', () => {
    assert.equal(bash(`node -e "console.log(1)"`).allow, false);
    assert.equal(bash(`node /tmp/evil.mjs`).allow, false);
    assert.equal(bash(`node "${campaign}/scripts/engine.mjs" index x`).allow, false);
    assert.equal(bash(`node "${framework}/lib/x.mjs"`).allow, false);
    assert.equal(bash(`node "${framework}/scripts/sub/x.mjs"`).allow, false);
    assert.equal(bash(`node "${framework}/skills/x.mjs"`).allow, false);
    assert.equal(bash(`node "${framework}/scripts/engine.test.mjs"`).allow, false);
    assert.equal(bash(`node "${framework}/scripts/engine.js"`).allow, false);
  });

  it('denies glued text after the script and a missing script', () => {
    const script = path.join(framework, 'scripts', 'engine.mjs');
    assert.equal(bash(`node "${script}"x index y`).allow, false);
    assert.equal(bash(`node "${script}`).allow, false);
    assert.equal(bash('node').allow, false);
    assert.equal(bash('node ').allow, false);
  });

  it('denies a command that only starts with a framework script', () => {
    const script = path.join(framework, 'scripts', 'engine.mjs');
    assert.equal(isAllowedCommand(`node "${script}" index x; rm -rf y`, framework), false);
    assert.equal(isAllowedCommand(` node "${script}" index x`, framework), false);
  });
});

describe('isAllowed decisions carry a reason', () => {
  it('gives a reason for every denied Bash command', () => {
    const decision = bash('git status');
    assert.equal(decision.allow, false);
    if (!decision.allow) assert.ok(decision.reason.length > 0);
  });
});

import { it as testIt } from 'node:test';

testIt('reads are confined to the campaign and the framework; sub-agents are allowed', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-read-'));
  const campaignRoot = path.join(base, 'camp');
  const frameworkRoot = path.join(base, 'fw');
  fs.mkdirSync(campaignRoot);
  fs.mkdirSync(frameworkRoot);
  const ctx = { campaignRoot, frameworkRoot };
  assert.equal(isAllowed('Read', { file_path: path.join(campaignRoot, 'a.md') }, ctx).allow, true);
  assert.equal(isAllowed('Read', { file_path: path.join(frameworkRoot, 'skills/x/SKILL.md') }, ctx).allow, true);
  assert.equal(isAllowed('Read', { file_path: '/etc/passwd' }, ctx).allow, false);
  assert.equal(isAllowed('Read', { file_path: '../outside.md' }, ctx).allow, false);
  assert.equal(isAllowed('Grep', { pattern: 'x', path: os.homedir() }, ctx).allow, false);
  assert.equal(isAllowed('Grep', { pattern: 'x' }, ctx).allow, true);
  assert.equal(isAllowed('Glob', { pattern: '/etc/*' }, ctx).allow, false);
  assert.equal(isAllowed('Glob', { pattern: '**/*.md' }, ctx).allow, true);
  assert.equal(isAllowed('Task', {}, ctx).allow, true);
  assert.equal(isAllowed('WebFetch', {}, ctx).allow, false);
});
