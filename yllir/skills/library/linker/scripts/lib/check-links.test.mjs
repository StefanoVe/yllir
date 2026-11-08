import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkLinks } from './check-links.mjs';

const CAMPAIGN = [
  'name: Test',
  'structure:',
  '  - id: places',
  '    folder: Places',
  '    type: places',
  '  - id: giocatori',
  '    folder: Giocatori',
  '    type: master-only',
  '  - id: notes',
  '    folder: Notes',
  '    type: notes',
  '',
].join('\n');

const MASTER_BLOCK = ['<!-- master -->', '## Master', '', '### Segreto', 'Testo.', '<!-- /master -->', ''].join('\n');

/** Creates a temporary campaign with the given files (relative path -> content). */
function makeCampaign(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const all = { 'campaign.yaml': CAMPAIGN, ...files };
  for (const [rel, content] of Object.entries(all)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return root;
}

function codes(result) {
  return result.errors.map((e) => e.code);
}

test('valid relative link with percent-encoded space resolves', (t) => {
  const root = makeCampaign(t, {
    'Places/Torre Nera.md': '---\nid: torre\n---\n\n# Torre Nera\n\nTesto.\n',
    'Notes/a.md': '# A\n\nVedi [la torre](../Places/Torre%20Nera.md).\n',
  });
  const result = checkLinks(root);
  assert.deepEqual(result.errors, []);
  assert.equal(result.links, 1);
  assert.deepEqual(result.checked, ['Notes/a.md', 'Places/Torre Nera.md']);
});

test('URL and mailto links are ignored and not counted', (t) => {
  const root = makeCampaign(t, {
    'Notes/a.md': '# A\n\n[web](https://example.com) e [mail](mailto:x@example.com)\n',
  });
  const result = checkLinks(root);
  assert.deepEqual(result.errors, []);
  assert.equal(result.links, 0);
});

test('absolute path target is an error', (t) => {
  const root = makeCampaign(t, {
    'Places/a.md': '# A\n',
    'Notes/a.md': '# A\n\n[x](/Places/a.md)\n',
  });
  assert.deepEqual(codes(checkLinks(root)), ['absolute-path']);
});

test('missing target is an error', (t) => {
  const root = makeCampaign(t, {
    'Notes/a.md': '# A\n\n[x](../Places/nope.md)\n',
  });
  assert.deepEqual(codes(checkLinks(root)), ['missing-target']);
});

test('link leaving the campaign folder is outside-campaign', (t) => {
  const root = makeCampaign(t, {
    'index.md': '# Index\n\n[x](../../x.md)\n',
  });
  assert.deepEqual(codes(checkLinks(root, { files: ['index.md'] })), ['outside-campaign']);
});

test('valid anchor resolves', (t) => {
  const root = makeCampaign(t, {
    'Places/a.md': '# A\n\n## Storia Antica\n\nTesto.\n',
    'Notes/b.md': '# B\n\n[x](../Places/a.md#storia-antica)\n',
  });
  const result = checkLinks(root);
  assert.deepEqual(result.errors, []);
  assert.equal(result.links, 1);
});

test('missing anchor is an error', (t) => {
  const root = makeCampaign(t, {
    'Places/a.md': '# A\n\n## Storia\n',
    'Notes/b.md': '# B\n\n[x](../Places/a.md#altro)\n',
  });
  assert.deepEqual(codes(checkLinks(root)), ['missing-anchor']);
});

test('duplicate heading gets -1 and -2 anchors', (t) => {
  const root = makeCampaign(t, {
    'Places/a.md': '# A\n\n## Nota\n\n## Nota\n\n## Nota\n',
    'Notes/ok.md': '# OK\n\n[1](../Places/a.md#nota-1) [2](../Places/a.md#nota-2)\n',
    'Notes/bad.md': '# BAD\n\n[3](../Places/a.md#nota-3)\n',
  });
  const result = checkLinks(root);
  assert.deepEqual(result.errors.map((e) => [e.file, e.code]), [['Notes/bad.md', 'missing-anchor']]);
});

test('#master is valid only when the target has a master block', (t) => {
  const root = makeCampaign(t, {
    'Places/with.md': `# Con\n\n${MASTER_BLOCK}`,
    'Places/without.md': '# Senza\n\nTesto.\n',
    'Notes/a.md': '# A\n\n[1](../Places/with.md#master) [2](../Places/without.md#master)\n',
  });
  const result = checkLinks(root);
  assert.deepEqual(result.errors.map((e) => [e.file, e.line, e.code]), [['Notes/a.md', 3, 'missing-anchor']]);
});

test('public link to a master-only file is an error', (t) => {
  const root = makeCampaign(t, {
    'Giocatori/Lia.md': '# Lia\n\nScheda.\n',
    'Notes/public.md': '# Pubblico\n\n[Lia](../Giocatori/Lia.md)\n',
  });
  assert.deepEqual(codes(checkLinks(root)), ['public-link-to-master-only']);
});

test('same link inside the master block is allowed', (t) => {
  const root = makeCampaign(t, {
    'Giocatori/Lia.md': '# Lia\n\nScheda.\n',
    'Notes/public.md': [
      '# Pubblico',
      '',
      '<!-- master -->',
      '## Master',
      '',
      '### Nota',
      '',
      '[Lia](../Giocatori/Lia.md)',
      '<!-- /master -->',
      '',
    ].join('\n'),
  });
  const result = checkLinks(root);
  assert.deepEqual(result.errors, []);
  assert.equal(result.links, 1);
});

test('same link from a master-only file is allowed', (t) => {
  const root = makeCampaign(t, {
    'Giocatori/Lia.md': '# Lia\n\nScheda.\n',
    'Giocatori/Mirko.md': '# Mirko\n\n[Lia](Lia.md)\n',
  });
  assert.deepEqual(checkLinks(root).errors, []);
});

test('missing image is an error', (t) => {
  const root = makeCampaign(t, {
    'Notes/a.md': '# A\n\n![mappa](img/none.png)\n',
  });
  assert.deepEqual(codes(checkLinks(root)), ['missing-target']);
});

test('links inside a code block are ignored', (t) => {
  const root = makeCampaign(t, {
    'Notes/a.md': '# A\n\n```\n[x](nope.md)\n```\n',
  });
  const result = checkLinks(root);
  assert.deepEqual(result.errors, []);
  assert.equal(result.links, 0);
});

test('frontmatter error is reported as markdown', (t) => {
  const root = makeCampaign(t, {
    'Notes/a.md': '---\nid: a\n- non valido\n---\n\n# A\n',
  });
  const result = checkLinks(root);
  assert.deepEqual(codes(result), ['markdown']);
  assert.equal(result.errors[0].line, 3);
  assert.equal(result.errors[0].col, 1);
  assert.equal(result.errors[0].target, null);
});

test('files option restricts the check', (t) => {
  const root = makeCampaign(t, {
    'Notes/a.md': '# A\n\n[x](nope-a.md)\n',
    'Notes/b.md': '# B\n\n[x](nope-b.md)\n',
  });
  const result = checkLinks(root, { files: ['Notes/b.md'] });
  assert.deepEqual(result.checked, ['Notes/b.md']);
  assert.deepEqual(result.errors.map((e) => e.file), ['Notes/b.md']);
});
