import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  allowedToolsOf,
  checkFingerprints,
  generateInstructions,
  projectAllowRules,
  projectSettingsText,
  renderTemplate,
  skillFiles,
} from './instructions.mjs';
import { parseYamlLite } from './yaml-lite.mjs';

const REPO = path.resolve(import.meta.dirname, '../../..');
const TEMPLATE = path.join(REPO, 'yllir/templates/instructions.md');
const FIXTURE_CONFIG = path.join(REPO, 'testbench/fixtures/morvalle/campaign/campaign.yaml');
const FIXTURE_CAMPAIGN = path.join(REPO, 'testbench/fixtures/morvalle/campaign');
const PLUGIN_JSON = path.join(REPO, 'yllir/.claude-plugin/plugin.json');

const tempDirs = [];
after(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-instr-'));
  tempDirs.push(dir);
  return dir;
}

const MINIMAL_CONFIG = `schema: 1
campaign:
  name: "Prova"
language:
  main: it
prose:
  register: plain
system:
  adapter: none
structure:
  - id: trama
    folder: Trama
    type: plot
`;

function campaignWith(configText, language = null) {
  const root = tempDir();
  const text = language === null ? configText : configText.replace('main: it', `main: ${language}`);
  fs.writeFileSync(path.join(root, 'campaign.yaml'), text);
  return root;
}

function frameworkVersion() {
  return JSON.parse(fs.readFileSync(PLUGIN_JSON, 'utf8')).version;
}

describe('project allow rules', () => {
  const SKILLS = path.join(REPO, 'yllir/skills');

  test('the real skills give one rule per plugin script, the update command, and the fixed rules', () => {
    const allow = projectAllowRules();
    assert.deepEqual(allow, [...new Set(allow)].sort(), 'sorted and unique');
    for (const rule of [
      'Skill(yllir:*)',
      'Edit(.campaign/state/**)',
      'Edit(.campaign/drafts/**)',
      'Edit(.campaign/image-providers/**)',
      'Edit(.campaign/styles/**)',
      'Bash(claude plugin update *)',
    ]) {
      assert.ok(allow.includes(rule), rule);
    }
    assert.ok(allow.includes('Bash(node "*/scripts/engine.mjs" *)'));
    assert.ok(allow.includes('Bash(node "*/skills/library/update/scripts/item-descriptions.mjs" *)'));
    assert.ok(allow.includes('Bash(node "*/skills/library/update/scripts/post-update.mjs" *)'));
    assert.ok(allow.includes('Bash(node "*/skills/library/import/scripts/ingest-check.mjs" *)'));
    assert.ok(!allow.some((rule) => rule.includes('CLAUDE_PLUGIN_ROOT')), 'no unexpanded variable');
    assert.ok(!allow.some((rule) => /Bash\(node \*\//.test(rule)), 'unrooted forms are not repeated');
  });

  test('every node script that a skill allows is covered by a rule', () => {
    const allow = new Set(projectAllowRules());
    for (const file of skillFiles(SKILLS)) {
      const allowed = allowedToolsOf(fs.readFileSync(file, 'utf8')) ?? '';
      for (const match of allowed.matchAll(/Bash\(node "\$\{CLAUDE_PLUGIN_ROOT\}\/([^"]+)" \*\)/g)) {
        assert.ok(allow.has(`Bash(node "*/${match[1]}" *)`), `${path.relative(REPO, file)}: ${match[1]}`);
      }
    }
  });

  test('reads the allowed-tools line of a skill and returns null without one', () => {
    assert.equal(
      allowedToolsOf('---\nname: x\nallowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/a.mjs" *), Read\n---\nBody\n'),
      'Bash(node "${CLAUDE_PLUGIN_ROOT}/a.mjs" *), Read',
    );
    assert.equal(allowedToolsOf('---\nname: x\n---\nallowed-tools: Read\n'), null);
    assert.equal(allowedToolsOf('no frontmatter\n'), null);
  });

  test('builds the rules from a small skills folder: rooted scripts, the update command, duplicates and unrooted forms', () => {
    const dir = tempDir();
    fs.mkdirSync(path.join(dir, 'a'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'b'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'a/SKILL.md'),
      '---\nname: a\nallowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/x.mjs" *), Bash(node */scripts/x.mjs *), Bash(claude plugin update *), Read\n---\n',
    );
    fs.writeFileSync(
      path.join(dir, 'b/SKILL.md'),
      '---\nname: b\nallowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/x.mjs" *), Bash(node "${CLAUDE_PLUGIN_ROOT}/b/y.mjs" *)\n---\n',
    );
    assert.deepEqual(projectAllowRules(dir), [
      'Bash(claude plugin update *)',
      'Bash(node "*/b/y.mjs" *)',
      'Bash(node "*/scripts/x.mjs" *)',
      'Edit(.campaign/drafts/**)',
      'Edit(.campaign/image-providers/**)',
      'Edit(.campaign/state/**)',
      'Edit(.campaign/styles/**)',
      'Skill(yllir:*)',
    ]);
  });
});

describe('renderTemplate', () => {
  test('replaces a placeholder with the value at its path', () => {
    const { text, errors } = renderTemplate('Hi {{a.b}}!', { a: { b: 'x' } });
    assert.equal(text, 'Hi x!');
    assert.deepEqual(errors, []);
  });

  test('renders a missing value as an empty string', () => {
    const { text, errors } = renderTemplate('[{{a.zz}}]', { a: {} });
    assert.equal(text, '[]');
    assert.deepEqual(errors, []);
  });

  test('keeps an #if block only when the value is truthy', () => {
    const template = 'a{{#if flag}}yes{{/if}}b';
    assert.equal(renderTemplate(template, { flag: true }).text, 'ayesb');
    assert.equal(renderTemplate(template, { flag: false }).text, 'ab');
    assert.equal(renderTemplate(template, { flag: '' }).text, 'ab');
    assert.equal(renderTemplate(template, { flag: [] }).text, 'ab');
    assert.equal(renderTemplate(template, {}).text, 'ab');
  });

  test('removes a block tag that stands alone on its line, with its line break', () => {
    const template = 'x\n{{#if a}}\ny\n{{/if}}\nz\n';
    assert.equal(renderTemplate(template, { a: true }).text, 'x\ny\nz\n');
    assert.equal(renderTemplate(template, { a: false }).text, 'x\nz\n');
  });

  test('repeats an #each block for each item, using id, folder and type', () => {
    const template = '{{#each structure}}\n- {{folder}} ({{id}}, {{type}})\n{{/each}}\n';
    const config = {
      structure: [
        { id: 'a', folder: 'A', type: 't1' },
        { id: 'b', folder: 'B', type: 't2' },
      ],
    };
    const { text, errors } = renderTemplate(template, config);
    assert.deepEqual(errors, []);
    assert.equal(text, '- A (a, t1)\n- B (b, t2)\n');
  });

  test('reports an unknown tag with its line', () => {
    const { errors } = renderTemplate('ok\nok\na {{ Bad-Tag }} b', {});
    assert.equal(errors.length, 1);
    assert.equal(errors[0].code, 'bad-template');
    assert.equal(errors[0].line, 3);
  });

  test('reports an unclosed block', () => {
    const { errors } = renderTemplate('{{#if a}}\nx\n', { a: true });
    assert.equal(errors.length, 1);
    assert.equal(errors[0].code, 'bad-template');
    assert.equal(errors[0].line, 1);
  });

  test('reports a closing tag without an opening tag', () => {
    const { errors } = renderTemplate('x\n{{/each}}\n', {});
    assert.equal(errors.length, 1);
    assert.equal(errors[0].code, 'bad-template');
    assert.equal(errors[0].line, 2);
  });

  test('reports a campaign value used inside #each', () => {
    const template = '{{#each structure}}\n{{campaign.name}}\n{{/each}}\n';
    const { errors } = renderTemplate(template, { structure: [{ id: 'a' }], campaign: { name: 'X' } });
    assert.equal(errors.length, 1);
    assert.equal(errors[0].code, 'bad-template');
    assert.equal(errors[0].line, 2);
  });
});

describe('generateInstructions', () => {
  test('includes the game-rules check when an adapter is configured', () => {
    const root = campaignWith(MINIMAL_CONFIG.replace('adapter: none', 'adapter: example'));
    const result = generateInstructions(root);
    assert.deepEqual(result.errors, []);
    const instructions = fs.readFileSync(path.join(root, '.campaign/instructions/agent.md'), 'utf8');
    assert.match(instructions, /When the adapter is not `none`, the engine checks creature and item sheets against it at each commit\./);
    assert.match(instructions, /Read its definition in `[^`]*\/modules\/systems\/example\/` before writing such a sheet\./);
    assert.match(instructions, /Never write a game rule from memory\./);
  });

  test('creates the five files with the exact wrapper text and no AGENTS.md', () => {
    const root = campaignWith(MINIMAL_CONFIG);
    const result = generateInstructions(root);
    assert.deepEqual(result.errors, []);
    assert.equal(result.written.length, 5);
    assert.ok(!result.written.includes('AGENTS.md'));
    assert.ok(!fs.existsSync(path.join(root, 'AGENTS.md')));
    for (const file of [
      '.campaign/instructions/agent.md',
      'CLAUDE.md',
      '.claude/settings.json',
      '.campaign/customizations.md',
      '.campaign/version.yaml',
    ]) {
      assert.ok(fs.existsSync(path.join(root, file)), `${file} exists`);
    }

    const notice =
      '<!-- Generated by Yllir. Do not edit: changes are lost. Your own rules go in .campaign/customizations.md -->';
    assert.equal(
      fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8'),
      `${notice}\n@.campaign/instructions/agent.md\n@.campaign/customizations.md\n`,
    );
  });

  test('creates customizations.md with the Italian header and never overwrites it', () => {
    const root = campaignWith(MINIMAL_CONFIG);
    generateInstructions(root);
    const customizations = path.join(root, '.campaign/customizations.md');
    assert.equal(fs.readFileSync(customizations, 'utf8'), '# Le tue regole\n');

    fs.writeFileSync(customizations, '# Le tue regole\n\nMia regola: niente nomi propri.\n');
    const second = generateInstructions(root);
    assert.deepEqual(second.errors, []);
    assert.ok(!second.written.includes('.campaign/customizations.md'));
    assert.equal(
      fs.readFileSync(customizations, 'utf8'),
      '# Le tue regole\n\nMia regola: niente nomi propri.\n',
    );
  });

  test('uses the English header for a language other than it', () => {
    const root = campaignWith(MINIMAL_CONFIG, 'fr');
    generateInstructions(root);
    assert.equal(fs.readFileSync(path.join(root, '.campaign/customizations.md'), 'utf8'), '# Your rules\n');
  });

  test('writes .claude/settings.json with the rules generated from the skills', () => {
    const root = campaignWith(MINIMAL_CONFIG);
    generateInstructions(root);
    assert.equal(
      fs.readFileSync(path.join(root, '.claude/settings.json'), 'utf8'),
      projectSettingsText(),
    );
    const allow = JSON.parse(fs.readFileSync(path.join(root, '.claude/settings.json'), 'utf8')).permissions.allow;
    assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(root, '.claude/settings.json'), 'utf8'))), ['permissions']);
    assert.deepEqual(allow, projectAllowRules());
  });

  test('never reads or writes .claude/settings.local.json', () => {
    const root = campaignWith(MINIMAL_CONFIG);
    fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(root, '.claude/settings.local.json'), '{"mia": true}\n');
    const result = generateInstructions(root);
    assert.deepEqual(result.errors, []);
    assert.ok(!result.written.some((file) => file.includes('settings.local.json')));
    assert.equal(fs.readFileSync(path.join(root, '.claude/settings.local.json'), 'utf8'), '{"mia": true}\n');
    const { data } = parseYamlLite(fs.readFileSync(path.join(root, '.campaign/version.yaml'), 'utf8'));
    assert.ok(!data.generated.some((entry) => entry.path.includes('settings.local.json')));
  });

  test('writes version.yaml that parses, lists three sorted fingerprints and the framework version', () => {
    const root = campaignWith(MINIMAL_CONFIG);
    generateInstructions(root);
    const { data, errors } = parseYamlLite(fs.readFileSync(path.join(root, '.campaign/version.yaml'), 'utf8'));
    assert.deepEqual(errors, []);
    assert.equal(data.framework_version, frameworkVersion());
    assert.equal(data.schema, 1);
    assert.deepEqual(
      data.generated.map((entry) => entry.path),
      ['.campaign/instructions/agent.md', '.claude/settings.json', 'CLAUDE.md'],
    );
    for (const entry of data.generated) {
      assert.match(entry.sha256, /^[0-9a-f]{64}$/);
    }
  });

  test('is deterministic: two runs give identical bytes', () => {
    const first = campaignWith(MINIMAL_CONFIG);
    const second = campaignWith(MINIMAL_CONFIG);
    generateInstructions(first);
    generateInstructions(second);
    for (const file of [
      '.campaign/instructions/agent.md',
      'CLAUDE.md',
      '.claude/settings.json',
      '.campaign/version.yaml',
    ]) {
      assert.deepEqual(
        fs.readFileSync(path.join(first, file)),
        fs.readFileSync(path.join(second, file)),
        `${file} is identical`,
      );
    }
  });

  test('writes nothing when campaign.yaml does not parse', () => {
    const root = campaignWith('schema: 1\ncampaign:\n\tname: "x"\n');
    const result = generateInstructions(root);
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0].code, 'yaml-syntax');
    assert.deepEqual(result.written, []);
    assert.ok(!fs.existsSync(path.join(root, '.campaign')));
    assert.ok(!fs.existsSync(path.join(root, 'CLAUDE.md')));
  });
});

describe('plugin root in the instructions', () => {
  test('states the absolute plugin folder for an empty CLAUDE_PLUGIN_ROOT', () => {
    const root = campaignWith(MINIMAL_CONFIG);
    generateInstructions(root);
    const pluginRoot = path.resolve(REPO, 'yllir');
    const agent = fs.readFileSync(path.join(root, '.campaign/instructions/agent.md'), 'utf8');
    assert.ok(
      agent.includes(
        `Yllir plugin root: ${pluginRoot}. Wherever a skill or agent file mentions \`\${CLAUDE_PLUGIN_ROOT}\`, use this path if the variable is empty.`,
      ),
    );
    assert.equal(checkFingerprints(root).ok, true);
  });
});

describe('checkFingerprints', () => {
  test('is ok after generation, and reports a hand-edited file', () => {
    const root = campaignWith(MINIMAL_CONFIG);
    generateInstructions(root);

    const clean = checkFingerprints(root);
    assert.deepEqual(clean, { ok: true, changed: [], missing_version_file: false });

    fs.appendFileSync(path.join(root, 'CLAUDE.md'), 'una riga a mano\n');
    const edited = checkFingerprints(root);
    assert.equal(edited.ok, false);
    assert.deepEqual(edited.changed, ['CLAUDE.md']);
    assert.equal(edited.missing_version_file, false);
  });

  test('reports a hand-edited .claude/settings.json, and ignores settings.local.json', () => {
    const root = campaignWith(MINIMAL_CONFIG);
    generateInstructions(root);
    fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(root, '.claude/settings.local.json'), '{"mia": true}\n');
    assert.deepEqual(checkFingerprints(root), { ok: true, changed: [], missing_version_file: false });

    fs.writeFileSync(path.join(root, '.claude/settings.json'), '{}\n');
    const edited = checkFingerprints(root);
    assert.equal(edited.ok, false);
    assert.deepEqual(edited.changed, ['.claude/settings.json']);
  });

  test('reports a missing version file', () => {
    const root = campaignWith(MINIMAL_CONFIG);
    const result = checkFingerprints(root);
    assert.equal(result.ok, false);
    assert.equal(result.missing_version_file, true);
  });
});

describe('real template', () => {
  test('renders the Morvalle fixture without errors (in memory only)', () => {
    const before = fs.readdirSync(FIXTURE_CAMPAIGN).sort();
    const { data, errors: parseErrors } = parseYamlLite(fs.readFileSync(FIXTURE_CONFIG, 'utf8'));
    assert.deepEqual(parseErrors, []);

    const templateText = fs.readFileSync(TEMPLATE, 'utf8');
    const { text, errors } = renderTemplate(templateText, data);
    assert.deepEqual(errors, []);
    assert.ok(text.includes('Campaign: Le ceneri della valle'));
    assert.ok(text.includes('`Appunti/`'));
    assert.ok(templateText.split('\n').length <= 80, 'template stays under 80 lines');
    assert.deepEqual(fs.readdirSync(FIXTURE_CAMPAIGN).sort(), before, 'fixture is untouched');
  });
});
