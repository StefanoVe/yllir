// Helpers for the tests of the encyclopedia: temporary campaigns, sheets, and tiny
// hand-made pictures. Used only by *.test.mjs files.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const created = [];

/** Removes every temporary campaign made by this module (call from an `after` hook). */
export function cleanupCampaigns() {
  for (const dir of created.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
}

export const DEFAULT_STRUCTURE = [
  { id: 'luoghi', folder: 'Mondo', type: 'places' },
  { id: 'personaggi', folder: 'Personaggi', type: 'subjects' },
  { id: 'oggetti', folder: 'Oggetti', type: 'objects' },
  { id: 'varie', folder: 'Varie', type: 'free' },
  { id: 'riservato', folder: 'Giocatori', type: 'master-only' },
  { id: 'fonti', folder: 'Fonti', type: 'sources' },
];

/** campaign.yaml text for a campaign with the default structure. */
export function campaignYaml({ lang = 'en', structure = DEFAULT_STRUCTURE, encyclopedia = true, extra = '', seed = 'World seed.md' } = {}) {
  const lines = [
    'schema: 1',
    'campaign:',
    '  name: "Test Campaign"',
    '  slug: test-campaign',
    '  created: 2026-11-12',
    `  seed: "${seed}"`,
    'language:',
    `  main: ${lang}`,
    '  other: []',
    'prose:',
    '  register: plain',
    'system:',
    '  adapter: none',
  ];
  if (structure.length > 0) {
    lines.push('structure:');
    for (const c of structure) {
      lines.push(`  - id: ${c.id}`, `    folder: ${c.folder}`, `    type: ${c.type}`);
    }
  }
  lines.push('modules:', `  encyclopedia: ${encyclopedia}`);
  if (extra !== '') lines.push(extra.trimEnd());
  return `${lines.join('\n')}\n`;
}

/**
 * Makes a temporary campaign folder.
 * @param {Record<string, string|Buffer>} files campaign-relative paths with their content
 * @param {{ yaml?: string }} [options] a full campaign.yaml text (default: campaignYaml())
 * @returns {string} absolute path
 */
export function makeCampaign(files = {}, { yaml } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-enc-'));
  created.push(root);
  const config = yaml ?? campaignYaml();
  fs.writeFileSync(path.join(root, 'campaign.yaml'), config);
  for (const folder of ['Mondo', 'Personaggi', 'Oggetti', 'Varie', 'Giocatori', 'Fonti']) {
    fs.mkdirSync(path.join(root, folder), { recursive: true });
  }
  if (!Object.hasOwn(files, 'World seed.md')) {
    files = { ...files, 'World seed.md': '# World seed\n\nA quiet calendar with no public facts.\n' };
  }
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return root;
}

/**
 * Markdown of a sheet: metadata (id and extra lines), a public body, and an optional reserved block.
 * @param {{ id: string, body?: string, master?: string, meta?: string[] }} sheet
 */
export function sheet({ id, body = '', master = '', meta = [] }) {
  const parts = [`<!-- yllir`, `id: ${id}`, ...meta, `-->`];
  if (body !== '') parts.push(body.trimEnd());
  if (master !== '') parts.push(`<!-- master -->\n## Master\n\n${master.trimEnd()}`);
  return `${parts.join('\n')}\n`;
}

/** A JPEG made of the given marker segments, then a scan start and the end marker. */
export function makeJpeg(segments = []) {
  const parts = [Buffer.from([0xff, 0xd8])];
  for (const [marker, payload] of segments) {
    const body = Buffer.from(payload, 'latin1');
    const length = body.length + 2;
    parts.push(Buffer.from([0xff, marker, length >> 8, length & 0xff]), body);
  }
  parts.push(Buffer.from([0xff, 0xda, 0x00, 0x02, 0x12, 0x34, 0xff, 0xd9]));
  return Buffer.concat(parts);
}

/** A PNG made of the given chunks, with a signature and an end chunk. */
export function makePng(chunks = []) {
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    return Buffer.concat([length, Buffer.from(type, 'latin1'), data, Buffer.alloc(4)]);
  };
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', Buffer.alloc(13)),
    ...chunks.map(([type, data]) => chunk(type, Buffer.from(data, 'latin1'))),
    chunk('IDAT', Buffer.from([1, 2, 3])),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
