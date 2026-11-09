import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { planLinks } from './link-plan.mjs';
import { buildSubjectIndex } from '../../../../../scripts/lib/subjects.mjs';

const CAMPAIGN = [
  'name: Test',
  'structure:',
  '  - id: people',
  '    folder: People',
  '    type: subjects',
  '  - id: plot',
  '    folder: Trama',
  '    type: plot',
  '',
].join('\n');

function subject(id, title) {
  return `---\nid: ${id}\n---\n\n# ${title}\n\nUn testo.\n`;
}

/** Writes a temporary campaign, runs `fn` on it and removes it afterwards. */
function withCampaign(files, fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-'));
  try {
    const all = { 'campaign.yaml': CAMPAIGN, ...files };
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

const BASE = {
  'People/Teodo Marr.md': subject('teodo-marr', 'Teodo Marr'),
  'People/Àlvar (Ferro).md': subject('alvar-ferro', 'Àlvar Ferro'),
  'People/Oria Valdes.md': subject('oria-valdes', 'Oria Valdes'),
};

test('target is encoded for spaces and parentheses, accents kept', () => {
  withCampaign(
    {
      ...BASE,
      'Trama/Nota.md': '# Nota\n\nIncontro con Àlvar Ferro al porto.\n',
    },
    (root) => {
      const plan = planLinks(root);
      assert.equal(plan.proposals.length, 1);
      const [p] = plan.proposals;
      assert.equal(p.sheet, 'People/Àlvar (Ferro).md');
      assert.equal(p.target, '../People/Àlvar%20%28Ferro%29.md');
    },
  );
});

test('target from a nested folder', () => {
  withCampaign(
    {
      ...BASE,
      'Trama/Arc/S1.md': '# Sessione 1\n\nParla Teodo Marr con il fabbro.\n',
    },
    (root) => {
      const [p] = planLinks(root).proposals;
      assert.equal(p.target, '../../People/Teodo%20Marr.md');
    },
  );
});

test('before and after show only the own replacement of each proposal', () => {
  withCampaign(
    {
      ...BASE,
      'Trama/Nota.md': '# Nota\n\nTeodo Marr e Teodo Marr.\n',
    },
    (root) => {
      const plan = planLinks(root);
      assert.equal(plan.proposals.length, 2);
      const [first, second] = plan.proposals;
      assert.equal(first.pid, 'P001');
      assert.equal(second.pid, 'P002');
      assert.equal(first.before, 'Teodo Marr e Teodo Marr.');
      assert.equal(second.before, 'Teodo Marr e Teodo Marr.');
      assert.equal(first.col, 1);
      assert.equal(second.col, 'Teodo Marr e '.length + 1);
      assert.equal(
        first.after,
        '[Teodo Marr](../People/Teodo%20Marr.md) e Teodo Marr.',
      );
      assert.equal(
        second.after,
        'Teodo Marr e [Teodo Marr](../People/Teodo%20Marr.md).',
      );
    },
  );
});

test('scope by files keeps only the given files', () => {
  withCampaign(
    {
      ...BASE,
      'Trama/A.md': '# A\n\nC\'è Teodo Marr qui.\n',
      'Trama/B.md': '# B\n\nC\'è Teodo Marr anche qui.\n',
    },
    (root) => {
      const plan = planLinks(root, { files: ['Trama/A.md'] });
      assert.deepEqual(plan.scope, ['Trama/A.md']);
      assert.deepEqual(
        plan.proposals.map((p) => p.file),
        ['Trama/A.md'],
      );
    },
  );
});

test('scope by subjects picks the files that mention the subject', () => {
  withCampaign(
    {
      ...BASE,
      'Trama/A.md': '# A\n\nC\'è Teodo Marr qui.\n',
      'Trama/B.md': '# B\n\nParla Oria Valdes con il monaco.\n',
    },
    (root) => {
      // The subject's own sheet has a `self` mention of it, so it is in scope too.
      const bySubject = planLinks(root, { subjects: ['oria-valdes'] });
      assert.deepEqual(bySubject.scope, ['People/Oria Valdes.md', 'Trama/B.md']);
      assert.deepEqual(
        bySubject.proposals.map((p) => p.file),
        ['Trama/B.md'],
      );

      const both = planLinks(root, { files: ['Trama/A.md'], subjects: ['oria-valdes'] });
      assert.deepEqual(both.scope, ['People/Oria Valdes.md', 'Trama/A.md', 'Trama/B.md']);
    },
  );
});

test('two-way: a sheet in files pulls in the documents that mention its subject', () => {
  withCampaign(
    {
      ...BASE,
      'Trama/Nota.md': '# Nota\n\nC\'è Teodo Marr qui.\n',
    },
    (root) => {
      // No `subjects` argument: the sheet of Teodo Marr is in files, so its mentions count.
      const plan = planLinks(root, { files: ['People/Teodo Marr.md'] });
      assert.ok(plan.scope.includes('People/Teodo Marr.md'));
      assert.ok(plan.scope.includes('Trama/Nota.md'));
      assert.ok(plan.proposals.some((p) => p.file === 'Trama/Nota.md' && p.subject === 'teodo-marr'));
    },
  );
});

test('two-way: a file that is not a sheet gives no extra scope', () => {
  withCampaign(
    {
      ...BASE,
      'Trama/Nota.md': '# Nota\n\nC\'è Teodo Marr qui.\n',
      'Trama/Altra.md': '# Altra\n\nParla Teodo Marr con il monaco.\n',
    },
    (root) => {
      const plan = planLinks(root, { files: ['Trama/Nota.md'] });
      assert.deepEqual(plan.scope, ['Trama/Nota.md']);
      assert.deepEqual(
        plan.proposals.map((p) => p.file),
        ['Trama/Nota.md'],
      );
    },
  );
});

test('two-way: a mention already linked to its sheet is not proposed again', () => {
  withCampaign(
    {
      ...BASE,
      'Trama/Nota.md': '# Nota\n\nVedi [Teodo Marr](../People/Teodo%20Marr.md) al porto.\n',
    },
    (root) => {
      const plan = planLinks(root, { files: ['People/Teodo Marr.md'] });
      assert.ok(plan.scope.includes('Trama/Nota.md'));
      assert.deepEqual(
        plan.proposals.filter((p) => p.file === 'Trama/Nota.md'),
        [],
      );
    },
  );
});

test('unknown file in scope gives a scope error', () => {
  withCampaign(
    {
      ...BASE,
      'Trama/A.md': '# A\n\nC\'è Teodo Marr qui.\n',
    },
    (root) => {
      const plan = planLinks(root, { files: ['Trama/Nope.md'] });
      assert.deepEqual(plan.scope, []);
      assert.deepEqual(plan.errors, [{ file: 'Trama/Nope.md', message: 'file not in scan' }]);
      assert.deepEqual(plan.proposals, []);
    },
  );
});

test('ambiguous and linked-elsewhere mentions go to review, not proposals', () => {
  withCampaign(
    {
      ...BASE,
      'People/Lino A.md': subject('lino-a', 'Lino'),
      'People/Lino B.md': subject('lino-b', 'Lino'),
      'Trama/A.md': '# A\n\nIl fabbro Lino aspetta.\n',
      'Trama/B.md': '# B\n\nVedi [Teodo Marr](../People/Altro.md) per dettagli.\n',
    },
    (root) => {
      const plan = planLinks(root);
      assert.deepEqual(plan.proposals, []);
      assert.equal(plan.review.length, 2);

      const [ambiguous, elsewhere] = plan.review;
      assert.equal(ambiguous.rid, 'R001');
      assert.equal(ambiguous.state, 'ambiguous');
      assert.equal(ambiguous.subject, null);
      assert.deepEqual(ambiguous.candidates, ['lino-a', 'lino-b']);
      assert.equal(elsewhere.rid, 'R002');
      assert.equal(elsewhere.state, 'linked-elsewhere');
      assert.equal(elsewhere.link_target, 'People/Altro.md');
    },
  );
});

test('the same campaign gives byte-identical plans', () => {
  withCampaign(
    {
      ...BASE,
      'Trama/A.md': '# A\n\nTeodo Marr e Oria Valdes.\n',
      'Trama/Arc/B.md': '# B\n\nOria Valdes parla.\n',
    },
    (root) => {
      const first = JSON.stringify(planLinks(root), null, 2);
      const second = JSON.stringify(planLinks(root), null, 2);
      assert.equal(first, second);
    },
  );
});

const MASTER_CAMPAIGN = [
  'name: Test',
  'structure:',
  '  - id: people',
  '    folder: People',
  '    type: subjects',
  '  - id: giocatori',
  '    folder: Giocatori',
  '    type: master-only',
  '  - id: chronicle',
  '    folder: Cronache',
  '    type: chronicle',
  '',
].join('\n');

const MASTER_BASE = {
  'campaign.yaml': MASTER_CAMPAIGN,
  'People/Teodo Marr.md': subject('teodo-marr', 'Teodo Marr'),
  'Giocatori/Ada Rook.md': subject('ada-rook', 'Ada Rook'),
};

test('public chronicle: master-only subject is not linked, normal subject is', () => {
  withCampaign(
    {
      ...MASTER_BASE,
      'Cronache/Sessione 1.md': '# Sessione 1\n\nParla Teodo Marr con Ada Rook al porto.\n',
    },
    (root) => {
      const plan = planLinks(root);
      assert.deepEqual(
        plan.proposals.map((p) => p.subject),
        ['teodo-marr'],
      );
      assert.deepEqual(plan.errors, []);
    },
  );
});

test('master-only subject stays in the subject index', () => {
  withCampaign(MASTER_BASE, (root) => {
    const index = buildSubjectIndex(root);
    assert.ok(index.subjects.some((s) => s.id === 'ada-rook' && s.type === 'master-only'));
  });
});

test('master-only document mentioning a master-only subject gets no link', () => {
  withCampaign(
    {
      ...MASTER_BASE,
      'Giocatori/Diario.md': '# Diario\n\nAda Rook scrive a Teodo Marr.\n',
    },
    (root) => {
      const plan = planLinks(root);
      assert.deepEqual(
        plan.proposals.map((p) => [p.file, p.subject]),
        [['Giocatori/Diario.md', 'teodo-marr']],
      );
    },
  );
});

test('symlinked document: no proposal for it, a normal file still gets one', () => {
  withCampaign(BASE, (root) => {
    // Document ingest keeps the original outside the repo and links it from the campaign.
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-ext-'));
    try {
      const original = path.join(outside, 'Originale.md');
      fs.writeFileSync(original, '# Originale\n\nParla Teodo Marr al porto.\n');
      fs.mkdirSync(path.join(root, 'Trama'), { recursive: true });
      fs.symlinkSync(original, path.join(root, 'Trama', 'Originale.md'));
      fs.writeFileSync(
        path.join(root, 'Trama', 'Nota.md'),
        '# Nota\n\nIncontro con Teodo Marr al porto.\n',
      );

      const plan = planLinks(root);
      assert.ok(!plan.scope.includes('Trama/Originale.md'));
      assert.ok(plan.scope.includes('Trama/Nota.md'));
      assert.deepEqual(
        plan.proposals.map((p) => p.file),
        ['Trama/Nota.md'],
      );
      assert.deepEqual(plan.review.filter((r) => r.file === 'Trama/Originale.md'), []);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});

const EXTERNAL_CAMPAIGN = [
  'name: Test',
  'structure:',
  '  - id: people',
  '    folder: People',
  '    type: subjects',
  '  - id: plot',
  '    folder: Trama',
  '    type: plot',
  '  - id: mondo-fuori',
  '    folder: Mondo/Fuori',
  '    type: external',
  '',
].join('\n');

/** Byte content and mtime of every file under a folder. */
function snapshotTree(dir) {
  const out = {};
  const walk = (current, rel) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      const relName = rel === '' ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(full, relName);
      } else {
        out[relName] = {
          bytes: fs.readFileSync(full).toString('hex'),
          mtimeMs: fs.statSync(full).mtimeMs,
        };
      }
    }
  };
  walk(dir, '');
  return out;
}

/**
 * Campaign with an external category `Mondo/Fuori`, a symlink to a temporary
 * folder outside the campaign holding `outsideFiles`. Runs fn(root, outside).
 */
function withExternalCampaign(files, outsideFiles, fn) {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-outside-'));
  try {
    for (const [rel, content] of Object.entries(outsideFiles)) {
      fs.writeFileSync(path.join(outside, rel), content);
    }
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-'));
    try {
      const all = { 'campaign.yaml': EXTERNAL_CAMPAIGN, ...BASE, ...files };
      for (const [rel, content] of Object.entries(all)) {
        const full = path.join(root, rel);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, content);
      }
      fs.mkdirSync(path.join(root, 'Mondo'), { recursive: true });
      fs.symlinkSync(outside, path.join(root, 'Mondo', 'Fuori'), 'dir');
      return fn(root, outside);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(outside, { recursive: true, force: true });
  }
}

test('a plot mention of an external subject is proposed through the symlink, never inside it', () => {
  withExternalCampaign(
    { 'Trama/Nota.md': '# Nota\n\nLo sbarco a Raatnagar.\n' },
    { 'Raatnagar.md': '# Raatnagar\n' },
    (root, outside) => {
      const before = snapshotTree(outside);
      const plan = planLinks(root);
      assert.equal(plan.proposals.length, 1);
      const [p] = plan.proposals;
      assert.equal(p.subject, 'mondo-fuori:Raatnagar');
      assert.equal(p.target, '../Mondo/Fuori/Raatnagar.md');
      assert.equal(p.file, 'Trama/Nota.md');
      assert.equal(p.after, 'Lo sbarco a [Raatnagar](../Mondo/Fuori/Raatnagar.md).');
      assert.ok(plan.proposals.every((q) => !q.file.startsWith('Mondo/')));
      assert.ok(plan.scope.every((file) => !file.startsWith('Mondo/')));
      assert.deepEqual(plan.review, []);
      assert.deepEqual(snapshotTree(outside), before);
    },
  );
});

test('a homonym between an external sheet and an internal sheet gives a review entry, not a proposal', () => {
  withExternalCampaign(
    {
      'People/Raatnagar.md': subject('raatnagar', 'Raatnagar'),
      'Trama/Nota.md': '# Nota\n\nLo sbarco a Raatnagar.\n',
    },
    { 'Raatnagar.md': '# Raatnagar\n' },
    (root, outside) => {
      const before = snapshotTree(outside);
      const plan = planLinks(root);
      assert.deepEqual(plan.proposals, []);
      assert.equal(plan.review.length, 1);
      const [r] = plan.review;
      assert.equal(r.state, 'ambiguous');
      assert.equal(r.file, 'Trama/Nota.md');
      assert.deepEqual(r.candidates, ['mondo-fuori:Raatnagar', 'raatnagar']);
      assert.deepEqual(snapshotTree(outside), before);
    },
  );
});
