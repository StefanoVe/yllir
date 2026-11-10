import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./feedback.mjs', import.meta.url));

function withCampaign(body) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-feedback-cli-'));
  fs.writeFileSync(path.join(root, 'campaign.yaml'), 'language: en\n');
  try { body(root); } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

function cli(args) {
  return spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
}

test('CLI records nested and failed skill calls, local transcripts, detailed report and safe export', () => {
  withCampaign((root) => {
    const parent = cli(['record', 'skill-start', root, '--invocation', 'parent_1', '--skill', 'yllir', '--input', 'private master text']);
    assert.equal(parent.status, 0, parent.stderr);
    const child = cli(['record', 'skill-start', root, '--invocation', 'child_1', '--parent', 'parent_1', '--skill', 'canon-research', '--input', 'private clue']);
    assert.equal(child.status, 0, child.stderr);

    const pending = path.join(root, '.campaign', 'state', 'feedback', 'pending-child_1.json');
    fs.mkdirSync(path.dirname(pending), { recursive: true });
    fs.writeFileSync(pending, JSON.stringify({ skill: 'canon-research', input: 'private clue', output: 'private answer', status: 'failed' }));
    const end = cli(['record', 'skill-end', root, '--invocation', 'child_1', '--parent', 'parent_1', '--skill', 'canon-research', '--status', 'failed', '--artifacts', 'private/path.md', '--issues', 'private issue', '--transcript', path.relative(root, pending)]);
    assert.equal(end.status, 0, end.stderr);

    const report = cli(['report', root, '--include-transcripts', 'yes']);
    assert.equal(report.status, 0, report.stderr);
    const detailed = JSON.parse(report.stdout.slice(0, report.stdout.lastIndexOf('\nexit:')));
    assert.equal(detailed.invocations.length, 1);
    assert.equal(detailed.invocations[0].start.parent, 'parent_1');
    assert.equal(detailed.invocations[0].end.status, 'failed');
    assert.match(detailed.invocations[0].transcript, /private answer/);
    assert.equal(detailed.incomplete.length, 1);

    const output = path.join(root, 'feedback-export.jsonl');
    const exported = cli(['export', root, '--out', output]);
    assert.equal(exported.status, 0, exported.stdout);
    const exportedText = fs.readFileSync(output, 'utf8');
    for (const secret of ['private master text', 'private clue', 'private answer', 'private/path.md', 'private issue', 'transcripts/']) {
      assert.equal(exportedText.includes(secret), false, `export leaked ${secret}`);
    }
    assert.doesNotMatch(exportedText, /canon-research/);
    const detailedExport = path.join(root, 'feedback-export-detailed.jsonl');
    const detailedResult = cli(['export', root, '--out', detailedExport, '--include-details', 'yes']);
    assert.equal(detailedResult.status, 0, detailedResult.stdout);
    const detailedText = fs.readFileSync(detailedExport, 'utf8');
    assert.match(detailedText, /canon-research/);
    for (const secret of ['private clue', 'private answer', 'private/path.md', 'private issue', 'transcripts/']) assert.equal(detailedText.includes(secret), false);

    const destructive = cli(['export', root, '--out', path.join(root, '.campaign/state/feedback/events.jsonl')]);
    assert.equal(destructive.status, 1);
    assert.match(destructive.stdout, /outside local feedback storage/);
  });
});

test('CLI rejects transcript path references that escape local feedback storage', () => {
  withCampaign((root) => {
    cli(['record', 'skill-start', root, '--invocation', 'safe_1', '--skill', '__proto__']);
    const file = path.join(root, '.campaign', 'state', 'feedback', 'events.jsonl');
    const events = fs.readFileSync(file, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    events.push({ type: 'skill-end', invocation: 'safe_1', skill: '__proto__', status: 'ok', transcript: { status: 'captured-local', file: '../../campaign.yaml' }, ts: new Date().toISOString() });
    fs.writeFileSync(file, events.map((event) => JSON.stringify(event)).join('\n') + '\n');
    const report = cli(['report', root, '--include-transcripts', 'yes']);
    assert.equal(report.status, 0, report.stderr);
    assert.match(report.stdout, /transcript unavailable/);
    assert.doesNotMatch(report.stdout, /language: en/);
  });
});

test('CLI rejects duplicate boundaries, mismatched metadata and malformed transcripts without writing', () => {
  withCampaign((root) => {
    assert.equal(cli(['record', 'skill-start', root, '--invocation', 'dup_1', '--skill', 'outer', '--model', 'unknown']).status, 0);
    assert.equal(cli(['record', 'skill-start', root, '--invocation', 'dup_1', '--skill', 'outer']).status, 1);
    assert.equal(cli(['record', 'skill-end', root, '--invocation', 'dup_1', '--skill', 'wrong', '--status', 'ok']).status, 1);
    const pending = path.join(root, '.campaign', 'state', 'feedback', 'bad.json');
    fs.writeFileSync(pending, '{not json');
    assert.equal(cli(['record', 'skill-end', root, '--invocation', 'dup_1', '--skill', 'outer', '--status', 'ok', '--transcript', path.relative(root, pending)]).status, 1);
    const feedback = path.join(root, '.campaign', 'state', 'feedback');
    assert.equal(fs.existsSync(path.join(feedback, 'transcripts', 'dup_1.json')), false);
    assert.equal(JSON.parse(fs.readFileSync(path.join(feedback, 'events.jsonl'), 'utf8').trim()).type, 'skill-start');
    assert.equal(cli(['record', 'skill-end', root, '--invocation', 'dup_1', '--skill', 'outer', '--status', 'failed']).status, 0);
    assert.equal(cli(['record', 'skill-end', root, '--invocation', 'dup_1', '--skill', 'outer', '--status', 'failed']).status, 1);
  });
});

test('export and transcript report reject symlink aliases into feedback storage', (t) => {
  withCampaign((root) => {
    const feedback = path.join(root, '.campaign', 'state', 'feedback');
    fs.mkdirSync(feedback, { recursive: true });
    const events = path.join(feedback, 'events.jsonl');
    fs.writeFileSync(events, JSON.stringify({ type: 'skill-start', invocation: 'link_1', skill: 'example', ts: new Date().toISOString() }) + '\n');
    const outside = path.join(root, 'outside-secret.txt');
    fs.writeFileSync(outside, 'master-only: secret');
    const transcriptDir = path.join(feedback, 'transcripts');
    fs.mkdirSync(transcriptDir, { recursive: true });
    try {
      fs.symlinkSync(outside, path.join(transcriptDir, 'link_1.json'));
      fs.appendFileSync(events, JSON.stringify({ type: 'skill-end', invocation: 'link_1', skill: 'example', status: 'ok', transcript: { status: 'captured-local', file: 'transcripts/link_1.json' }, ts: new Date().toISOString() }) + '\n');
      const report = cli(['report', root, '--include-transcripts', 'yes']);
      assert.equal(report.status, 0, report.stderr);
      assert.match(report.stdout, /transcript unavailable/);
      assert.doesNotMatch(report.stdout, /master-only: secret/);
      const alias = path.join(root, 'feedback-alias');
      fs.symlinkSync(feedback, alias, 'dir');
      const exported = cli(['export', root, '--out', path.join(alias, 'events.jsonl')]);
      assert.equal(exported.status, 1);
      assert.equal(fs.readFileSync(events, 'utf8').includes('master-only'), false);
    } catch (error) {
      if (error.code === 'EPERM' || error.code === 'EACCES') { t.skip('symlink creation is unavailable'); return; }
      throw error;
    }
  });
});

test('transcript storage rejects a symlinked transcripts directory for both writes and reads', (t) => {
  withCampaign((root) => {
    const feedback = path.join(root, '.campaign', 'state', 'feedback');
    fs.mkdirSync(feedback, { recursive: true });
    const events = path.join(feedback, 'events.jsonl');
    const outside = path.join(root, 'outside');
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'dir_1.json'), '{"input":"secret","output":"secret"}');
    try {
      fs.symlinkSync(outside, path.join(feedback, 'transcripts'), 'dir');
      assert.equal(cli(['record', 'skill-start', root, '--invocation', 'dir_1', '--skill', 'example']).status, 0);
      const pending = path.join(root, 'pending.json');
      fs.writeFileSync(pending, JSON.stringify({ input: 'x', output: 'y' }));
      const end = cli(['record', 'skill-end', root, '--invocation', 'dir_1', '--skill', 'example', '--status', 'ok', '--transcript', path.relative(root, pending)]);
      assert.equal(end.status, 1);
      assert.equal(fs.readFileSync(path.join(outside, 'dir_1.json'), 'utf8'), '{"input":"secret","output":"secret"}');

      fs.appendFileSync(events, JSON.stringify({ type: 'skill-end', invocation: 'dir_1', skill: 'example', status: 'ok', transcript: { status: 'captured-local', file: 'transcripts/dir_1.json' }, ts: new Date().toISOString() }) + '\n');
      const report = cli(['report', root, '--include-transcripts', 'yes']);
      assert.equal(report.status, 0, report.stderr);
      assert.match(report.stdout, /transcript unavailable/);
      assert.doesNotMatch(report.stdout, /"secret"/);
    } catch (error) {
      if (error.code === 'EPERM' || error.code === 'EACCES') { t.skip('symlink creation is unavailable'); return; }
      throw error;
    }
  });
});
