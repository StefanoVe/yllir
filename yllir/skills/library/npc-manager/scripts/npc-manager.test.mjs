import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), 'npc-manager.mjs');

const CAMPAIGN = [
  'name: Test',
  'language:',
  '  main: it',
  'structure:',
  '  - id: plot',
  '    folder: Trama',
  '    type: plot',
  '  - id: subjects',
  '    folder: Personaggi',
  '    type: subjects',
  '  - id: places',
  '    folder: Luoghi',
  '    type: places',
  '',
].join('\n');

const PLACE = '---\nid: porto\ntemplate: place\n---\n\n# Porto\n\nUn porto sul mare.\n';

const ILDE = [
  '---',
  'id: ilde-varno',
  'template: npc',
  'location: [porto]',
  '---',
  '',
  '# Ilde Varno',
  '',
  '## Ruolo',
  '',
  'Locandiera del porto.',
  '',
  '## Aspetto e modi',
  '',
  'Capelli grigi, voce bassa.',
  '',
  '## Al tavolo',
  '',
  'Parla poco e osserva molto.',
  '',
].join('\n');

const EVENT_PATH = 'Trama/Sessione 1/Eventi/Arrivo.md';

/** Event sheet with a session key and optional extra frontmatter lines. */
function event(characters, body = '# Arrivo\n\nIlde Varno apre la porta.\n') {
  return `---\nid: arrivo\nsession: 1\ncharacters: [${characters.join(', ')}]\n---\n\n${body}`;
}

/** Writes a temporary campaign, runs `fn` on its root and removes it afterwards. */
function withCampaign(files, fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-npc-manager-'));
  try {
    const all = {
      'campaign.yaml': CAMPAIGN,
      'Luoghi/Porto.md': PLACE,
      'Personaggi/Ilde Varno.md': ILDE,
      ...files,
    };
    for (const [rel, content] of Object.entries(all)) {
      const full = path.join(root, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content);
    }
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

/** Runs the CLI with the root first and returns status and stdout. */
function cli(root, args) {
  const result = spawnSync(process.execPath, [CLI, root, ...args], { encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

test('plot-cast reports a declared character without a sheet, writes JSON and exits 1', () => {
  withCampaign({ [EVENT_PATH]: event(['ilde-varno', 'ghost-id']) }, (root) => {
    const out = path.join(root, 'out', 'cast.json');
    const result = cli(root, ['plot-cast', '--out', out]);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /^events: 1$/m);
    assert.match(result.stdout, /^declared: 2$/m);
    assert.match(
      result.stdout,
      /^error character-no-sheet Trama\/Sessione 1\/Eventi\/Arrivo\.md: no sheet for character ghost-id$/m,
    );
    assert.match(result.stdout, /^errors: 1$/m);
    assert.match(result.stdout, /^candidates: 0$/m);
    assert.match(result.stdout, /exit: 1\n$/);

    const json = JSON.parse(fs.readFileSync(out, 'utf8'));
    assert.equal(json.errors.length, 1);
    assert.equal(json.errors[0].code, 'character-no-sheet');
    assert.equal(json.declared, 2);
  });
});

test('plot-cast with a clean event exits 0', () => {
  withCampaign({ [EVENT_PATH]: event(['ilde-varno']) }, (root) => {
    const result = cli(root, ['plot-cast', '--out', path.join(root, 'cast.json')]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^errors: 0$/m);
    assert.match(result.stdout, /exit: 0\n$/);
  });
});

test('plot-cast candidates print a line and never change the exit code', () => {
  const body = '# Arrivo\n\nBrenna Orsi arriva al porto.\n';
  withCampaign({ [EVENT_PATH]: event([], body) }, (root) => {
    const result = cli(root, ['plot-cast', '--out', path.join(root, 'cast.json')]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^candidate Trama\/Sessione 1\/Eventi\/Arrivo\.md:\d+ Brenna Orsi$/m);
    assert.match(result.stdout, /^candidates: 1$/m);
    assert.match(result.stdout, /exit: 0\n$/);
  });
});

test('check-sheets accepts a valid npc sheet', () => {
  withCampaign({}, (root) => {
    const result = cli(root, ['check-sheets']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^checked: 1$/m);
    assert.match(result.stdout, /^errors: 0$/m);
    assert.match(result.stdout, /exit: 0\n$/);
  });
});

test('find prints the match line of an existing character', () => {
  withCampaign({}, (root) => {
    const result = cli(root, ['find', '--name', 'Ilde Varno']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(
      result.stdout,
      /^match ilde-varno Personaggi\/Ilde Varno\.md Ilde Varno title exact$/m,
    );
    assert.match(result.stdout, /^matches: 1$/m);
    assert.match(result.stdout, /exit: 0\n$/);
  });
});

test('an unknown command is a usage error', () => {
  withCampaign({}, (root) => {
    const result = cli(root, ['explode']);
    assert.equal(result.status, 2);
    assert.match(result.stdout, /exit: 2\n$/);
    assert.match(result.stderr, /^usage: /);
  });
});

test('plot-cast without --out is a usage error', () => {
  withCampaign({}, (root) => {
    const result = cli(root, ['plot-cast']);
    assert.equal(result.status, 2);
    assert.match(result.stdout, /exit: 2\n$/);
  });
});

test('empty --files, blank --name and extra positionals are usage errors', () => {
  withCampaign({}, (root) => {
    assert.equal(cli(root, ['check-sheets', '--files', ' , ']).status, 2);
    assert.equal(cli(root, ['find', '--name', '  ']).status, 2);
    assert.equal(cli(root, ['find', '--name', 'Ilde', 'extra']).status, 2);
    assert.equal(cli(root, ['find', '--out', 'x']).status, 2);
  });
});
