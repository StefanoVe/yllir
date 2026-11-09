import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('./ingest-report.mjs', import.meta.url));

const CAMPAIGN = [
  'name: Test',
  'structure:',
  '  - id: fonti',
  '    folder: Fonti',
  '    type: sources',
  '  - id: trama',
  '    folder: Trama',
  '    type: plot',
  '',
].join('\n');

function withCampaign(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-ingest-report-cli-'));
  try {
    fs.writeFileSync(path.join(root, 'campaign.yaml'), CAMPAIGN);
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function runCli(args) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
}

test('empty --ids writes the report with no sources and exits 0', () => {
  withCampaign((root) => {
    const out = path.join(root, 'report.txt');
    const result = runCli([
      root,
      '--ids', '',
      '--duplicates', '0',
      '--status-reason', 'inventory not run',
      '--continue-with', 'x',
      '--out', out,
    ]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /exit: 0\n$/);
    assert.ok(fs.existsSync(out), 'report.txt must be written');
    const text = fs.readFileSync(out, 'utf8');
    assert.match(text, /status: FAILED/);
    assert.match(text, /reason: inventory not run/);
    assert.match(text, /sources: 0 \(none\)/);
  });
});

test('omitting --ids entirely is a usage error (exit 2)', () => {
  withCampaign((root) => {
    const out = path.join(root, 'report.txt');
    const result = runCli([root, '--out', out]);

    assert.equal(result.status, 2);
    assert.match(result.stdout, /exit: 2\n$/);
    assert.equal(fs.existsSync(out), false);
  });
});
