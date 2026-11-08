import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyRunnerResult, checkMessage, loadNeverSay } from './runner-result.mjs';
import { activeTopic, listTopics, newTopic, readSection } from '../../../../../scripts/lib/topics.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(here, '..', 'runner-result.mjs');
const LEXICON = path.join(here, '..', '..', 'lexicon.md');
const NEVER = loadNeverSay(LEXICON);

const created = [];
after(() => {
  for (const dir of created) fs.rmSync(dir, { recursive: true, force: true });
});

function tmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-runner-'));
  created.push(dir);
  return dir;
}

function writeResult(dir, lines) {
  const file = path.join(dir, 'result.txt');
  fs.writeFileSync(file, lines.join('\n') + '\n', 'utf8');
  return file;
}

function questionLines(message = 'Vuoi che la scena resti in cantina?') {
  return [
    'RUNNER RESULT',
    'status: QUESTION',
    'question: Should the scene stay in the cellar?',
    'next step: Ask the master and wait for the answer.',
    'message for the master:',
    message,
  ];
}

function doneLines(files = 'notes/scene.md', message = 'La scena è pronta.') {
  return [
    'RUNNER RESULT',
    'status: DONE',
    'done: Wrote the scene card.',
    `files written: ${files}`,
    'message for the master:',
    message,
  ];
}

function failedLines(message = 'Non sono riuscito a completare il passaggio.') {
  return ['RUNNER RESULT', 'status: FAILED', 'message for the master:', message];
}

/** A campaign with one active topic, and a scene file for the Files section. */
function campaign() {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'notes'), { recursive: true });
  fs.writeFileSync(path.join(root, 'notes', 'scene.md'), '# Scene\n', 'utf8');
  const { id } = newTopic(root, {
    process: 'prepare-session',
    goal: 'Cellar scene',
    now: new Date('2026-11-07T16:00:00.000Z'),
  });
  return { root, id };
}

function handoff(root, id) {
  return fs.readFileSync(path.join(root, '.campaign', 'state', 'topics', `${id}.md`), 'utf8');
}

describe('checkMessage', () => {
  test('accepts ordinary Italian text with apostrophes, guillemets, numbers and years', () => {
    const text = "L'assistente ha preparato «Sessione 4» per l'anno 298, con 3 scene e un'uscita.";
    assert.deepEqual(checkMessage(text, NEVER), { ok: true, problems: [] });
  });

  test('finds a never-say word as a whole word, case-insensitively', () => {
    const r = checkMessage('Ho usato uno Skill interno.', NEVER);
    assert.equal(r.ok, false);
    assert.match(r.problems[0], /"skill"/);
  });

  test('does not flag a never-say word inside a longer word', () => {
    assert.deepEqual(checkMessage('Il modello della mappa è pronto.', NEVER), { ok: true, problems: [] });
  });

  test('finds a hyphenated never-say term', () => {
    const r = checkMessage('Il sub-agent ha finito.', NEVER);
    assert.match(r.problems[0], /sub-agent/);
  });

  test('finds a backtick', () => {
    const r = checkMessage('Usa `node` per questo.', NEVER);
    assert.ok(r.problems.includes('the message contains a backtick character'));
  });

  test('finds a version code with a digit and a letter', () => {
    const r = checkMessage('Versione salvata a1b2c3d.', NEVER);
    assert.deepEqual(r.problems, ['the message contains a version code: a1b2c3d']);
  });

  test('does not flag a hex-looking word without a digit', () => {
    assert.deepEqual(checkMessage('Un faccia deciso e cadde.', NEVER), { ok: true, problems: [] });
  });

  test('finds file paths with the listed extensions and the campaign folder', () => {
    const r = checkMessage('Vedi notes/scene.md e .campaign/state/x.', NEVER);
    assert.ok(r.problems.includes('the message contains a file path: notes/scene.md'));
    assert.ok(r.problems.includes('the message contains a file path: .campaign/state/x'));
  });

  test('does not flag a slash without a listed extension', () => {
    assert.deepEqual(checkMessage('Scegli giorno/notte.', NEVER), { ok: true, problems: [] });
  });

  test('reports an empty message', () => {
    assert.deepEqual(checkMessage('   ', NEVER), { ok: false, problems: ['the message is empty'] });
  });
});

describe('loadNeverSay', () => {
  test('returns the words of the real lexicon without descriptive parts', () => {
    assert.deepEqual(NEVER, [
      'skill',
      'script',
      'git',
      'commit',
      'repository',
      'YAML',
      'frontmatter',
      'Markdown',
      'sub-agent',
      'model',
      'Haiku',
      'Claude',
      'Codex',
      'hook',
      'MCP',
      'template',
      'prompt',
      'JSON',
      'plugin',
    ]);
  });

  test('throws when the section is missing', () => {
    const file = path.join(tmp(), 'lexicon.md');
    fs.writeFileSync(file, '# Lexicon\n', 'utf8');
    assert.throws(() => loadNeverSay(file), /Never say/);
  });
});

describe('applyRunnerResult parsing', () => {
  test('QUESTION parses and asks the topic', () => {
    const { root, id } = campaign();
    const file = writeResult(tmp(), questionLines());
    const r = applyRunnerResult(root, { file, topic: id, lexiconPath: LEXICON });
    assert.deepEqual(r, {
      ok: true,
      status: 'QUESTION',
      message: 'Vuoi che la scena resti in cantina?',
      problems: [],
    });
    assert.equal(activeTopic(root).id, id);
    assert.match(readSection(root, { id, section: 'Questions for the master' }), /Should the scene stay in the cellar\?/);
    assert.equal(readSection(root, { id, section: 'Next step' }), 'Ask the master and wait for the answer.');
  });

  test('DONE parses and finishes the topic', () => {
    const { root, id } = campaign();
    const file = writeResult(tmp(), doneLines());
    const r = applyRunnerResult(root, { file, topic: id, lexiconPath: LEXICON });
    assert.equal(r.ok, true);
    assert.equal(r.status, 'DONE');
    assert.equal(listTopics(root)[0].status, 'closed');
    assert.equal(readSection(root, { id, section: 'Done' }).includes('- Wrote the scene card.'), true);
    assert.match(readSection(root, { id, section: 'Files' }), /`notes\/scene\.md` — sha256 [0-9a-f]{64}/);
  });

  test('DONE with files written none leaves the Files section empty', () => {
    const { root, id } = campaign();
    const file = writeResult(tmp(), doneLines('none'));
    const r = applyRunnerResult(root, { file, topic: id, lexiconPath: LEXICON });
    assert.equal(r.ok, true);
    assert.equal(readSection(root, { id, section: 'Files' }), '');
  });

  test('FAILED reports ok and leaves the topic untouched', () => {
    const { root, id } = campaign();
    const before = handoff(root, id);
    const file = writeResult(tmp(), failedLines());
    const r = applyRunnerResult(root, { file, topic: id, lexiconPath: LEXICON });
    assert.equal(r.ok, true);
    assert.equal(r.status, 'FAILED');
    assert.equal(handoff(root, id), before);
  });

  test('a bad first line is a problem', () => {
    const { root, id } = campaign();
    const file = writeResult(tmp(), ['RUNNER', ...questionLines().slice(1)]);
    const r = applyRunnerResult(root, { file, topic: id, lexiconPath: LEXICON });
    assert.equal(r.ok, false);
    assert.ok(r.problems.some((p) => p.includes('RUNNER RESULT')));
  });

  test('an unknown status is a problem', () => {
    const { root, id } = campaign();
    const lines = questionLines();
    lines[1] = 'status: MAYBE';
    const file = writeResult(tmp(), lines);
    const r = applyRunnerResult(root, { file, topic: id, lexiconPath: LEXICON });
    assert.equal(r.ok, false);
    assert.ok(r.problems.some((p) => p.includes('MAYBE')));
  });

  test('a missing status is a problem', () => {
    const { root, id } = campaign();
    const file = writeResult(tmp(), ['RUNNER RESULT', 'message for the master:', 'Ciao.']);
    const r = applyRunnerResult(root, { file, topic: id, lexiconPath: LEXICON });
    assert.equal(r.ok, false);
    assert.ok(r.problems.includes('the status field is missing'));
  });

  test('QUESTION without question or next step is a problem', () => {
    const { root, id } = campaign();
    const file = writeResult(tmp(), [
      'RUNNER RESULT',
      'status: QUESTION',
      'message for the master:',
      'Ciao.',
    ]);
    const r = applyRunnerResult(root, { file, topic: id, lexiconPath: LEXICON });
    assert.equal(r.ok, false);
    assert.ok(r.problems.includes('the QUESTION result has no question'));
    assert.ok(r.problems.includes('the QUESTION result has no next step'));
  });

  test('DONE without files written is a problem', () => {
    const { root, id } = campaign();
    const file = writeResult(tmp(), [
      'RUNNER RESULT',
      'status: DONE',
      'done: Something.',
      'message for the master:',
      'Fatto.',
    ]);
    const r = applyRunnerResult(root, { file, topic: id, lexiconPath: LEXICON });
    assert.equal(r.ok, false);
    assert.ok(r.problems.includes('the DONE result has no files written'));
  });

  test('a missing message marker is a problem', () => {
    const { root, id } = campaign();
    const file = writeResult(tmp(), ['RUNNER RESULT', 'status: FAILED']);
    const r = applyRunnerResult(root, { file, topic: id, lexiconPath: LEXICON });
    assert.equal(r.ok, false);
    assert.ok(r.problems.includes('the message for the master section is missing'));
  });

  test('an empty message is a problem', () => {
    const { root, id } = campaign();
    const file = writeResult(tmp(), ['RUNNER RESULT', 'status: FAILED', 'message for the master:']);
    const r = applyRunnerResult(root, { file, topic: id, lexiconPath: LEXICON });
    assert.equal(r.ok, false);
    assert.deepEqual(r.problems, ['the message is empty']);
  });

  test('a missing file is a problem', () => {
    const { root } = campaign();
    const r = applyRunnerResult(root, { file: path.join(tmp(), 'nope.txt'), topic: 'none', lexiconPath: LEXICON });
    assert.deepEqual(r, { ok: false, status: null, message: '', problems: ['result file missing'] });
  });
});

describe('applyRunnerResult message problems', () => {
  const cases = [
    ['a never-say word', 'Ho usato uno script.', /"script"/],
    ['a backtick', 'Esegui `mkdir` adesso.', /backtick/],
    ['a version code', 'Salvato come a1b2c3d.', /version code: a1b2c3d/],
    ['a file path', 'Vedi notes/scene.md.', /file path: notes\/scene\.md/],
  ];
  for (const [name, message, pattern] of cases) {
    test(`${name} blocks the result and leaves the topic untouched`, () => {
      const { root, id } = campaign();
      const before = handoff(root, id);
      const file = writeResult(tmp(), questionLines(message));
      const r = applyRunnerResult(root, { file, topic: id, lexiconPath: LEXICON });
      assert.equal(r.ok, false);
      assert.equal(r.status, 'QUESTION');
      assert.ok(r.problems.some((p) => pattern.test(p)), r.problems.join(' | '));
      assert.equal(handoff(root, id), before);
    });
  }
});

describe('applyRunnerResult topics', () => {
  test('topic none touches nothing', () => {
    const { root, id } = campaign();
    const before = handoff(root, id);
    const file = writeResult(tmp(), doneLines());
    const r = applyRunnerResult(root, { file, topic: 'none', lexiconPath: LEXICON });
    assert.equal(r.ok, true);
    assert.equal(handoff(root, id), before);
  });

  test('no topic argument touches nothing', () => {
    const { root, id } = campaign();
    const before = handoff(root, id);
    const file = writeResult(tmp(), questionLines());
    const r = applyRunnerResult(root, { file, lexiconPath: LEXICON });
    assert.equal(r.ok, true);
    assert.equal(handoff(root, id), before);
  });

  test('a topic that does not exist is reported as a problem', () => {
    const { root } = campaign();
    const file = writeResult(tmp(), questionLines());
    const r = applyRunnerResult(root, { file, topic: 'no-such-topic', lexiconPath: LEXICON });
    assert.equal(r.ok, false);
    assert.match(r.problems[0], /no-such-topic/);
  });
});

describe('runner-result CLI', () => {
  function runCli(args) {
    return spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
  }

  function lastLine(stdout) {
    const lines = stdout.trimEnd().split('\n');
    return lines[lines.length - 1];
  }

  test('prints the clean message and exits 0', () => {
    const { root, id } = campaign();
    const file = writeResult(tmp(), questionLines());
    const run = runCli([root, '--file', file, '--topic', id]);
    assert.equal(run.status, 0);
    assert.equal(
      run.stdout,
      'status: QUESTION\nmessage for the master:\nVuoi che la scena resti in cantina?\nexit: 0\n',
    );
    assert.equal(activeTopic(root).id, id);
  });

  test('prints the problems and exits 1 without touching the topic', () => {
    const { root, id } = campaign();
    const before = handoff(root, id);
    const file = writeResult(tmp(), questionLines('Usa il file notes/scene.md.'));
    const run = runCli([root, '--file', file, '--topic', id]);
    assert.equal(run.status, 1);
    assert.match(run.stdout, /^problems:\n- the message contains a file path: notes\/scene\.md\n/);
    assert.equal(lastLine(run.stdout), 'exit: 1');
    assert.equal(handoff(root, id), before);
  });

  test('a missing file is reported as a problem with exit 1', () => {
    const { root } = campaign();
    const run = runCli([root, '--file', path.join(tmp(), 'missing.txt')]);
    assert.equal(run.status, 1);
    assert.equal(run.stdout, 'problems:\n- result file missing\nexit: 1\n');
  });

  test('no --file is a usage error with exit 2', () => {
    const run = runCli([tmp()]);
    assert.equal(run.status, 2);
    assert.equal(lastLine(run.stdout), 'exit: 2');
    assert.match(run.stderr, /usage:/);
  });

  test('an unknown option is a usage error with exit 2', () => {
    const dir = tmp();
    const run = runCli([dir, '--file', writeResult(dir, questionLines()), '--bogus', 'x']);
    assert.equal(run.status, 2);
    assert.equal(lastLine(run.stdout), 'exit: 2');
  });

  test('no arguments is a usage error with exit 2', () => {
    const run = runCli([]);
    assert.equal(run.status, 2);
    assert.equal(lastLine(run.stdout), 'exit: 2');
  });
});
