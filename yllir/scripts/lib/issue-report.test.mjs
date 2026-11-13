import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { REPO, buildReport, createIssue, prefilledUrl } from './issue-report.mjs';

const TRUNCATED = '[truncated, full text in the saved file]';
const OK = { status: 0, stdout: '', stderr: '' };
const FAIL = { status: 1, stdout: '', stderr: 'nope' };
const MISSING = {
  status: null,
  stdout: '',
  stderr: '',
  error: Object.assign(new Error('spawnSync gh ENOENT'), { code: 'ENOENT' }),
};

/** Runs `body` with a fresh temp folder as the campaign root, then removes it. */
function withRoot(body) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-issue-'));
  try {
    return body(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

/** A fake runner that records every call and answers with `handler`. */
function recorder(handler) {
  const calls = [];
  const run = (cmd, args) => {
    calls.push({ cmd, args });
    return handler(cmd, args);
  };
  return { run, calls };
}

describe('buildReport', () => {
  test('replaces the campaign root with <campaign> and the home folder with ~', () => {
    withRoot((root) => {
      const { title, body } = buildReport(root, {
        title: `Crash in ${root}`,
        summary: `Problem in ${root}/notes.md and ${os.homedir()}/x`,
      });
      assert.equal(title.includes(root), false);
      assert.match(title, /<campaign>/);
      assert.equal(body.includes(root), false);
      assert.match(body, /<campaign>\/notes\.md/);
      assert.equal(body.includes(os.homedir()), false);
      assert.match(body, /~\/x/);
    });
  });

  test('collapses runs of blank lines', () => {
    withRoot((root) => {
      const { body } = buildReport(root, { summary: 'a\n\n\n\nb' });
      assert.equal(body.includes('a\n\nb'), true);
      assert.equal(body.includes('\n\n\n'), false);
    });
  });

  test('caps the title at 120 characters and each field at 2000', () => {
    withRoot((root) => {
      const { title, body } = buildReport(root, { title: 'T'.repeat(300), summary: 'x'.repeat(3000) });
      assert.equal([...title].length, 120);
      assert.equal(body.includes('x'.repeat(2000)), true);
      assert.equal(body.includes('x'.repeat(2001)), false);
    });
  });

  test('has the sections, skips empty optional ones and ends with the footer', () => {
    withRoot((root) => {
      const { body } = buildReport(root, { summary: 'Short', steps: '1. Open the map', actual: 'Blank' });
      assert.match(body, /## Summary\n\nShort/);
      assert.match(body, /## Steps\n\n1\. Open the map/);
      assert.match(body, /## Actual\n\nBlank/);
      assert.doesNotMatch(body, /## Expected/);
      assert.match(body, /## Environment\n\n- Framework version: /);
      assert.match(body, /- Node: v/);
      assert.equal(body.split('\n').at(-1), 'Reported by the assistant on behalf of a game master. No campaign content is included.');
    });
  });
});

describe('prefilledUrl', () => {
  test('points to the repository and encodes title and body', () => {
    const url = prefilledUrl('Hello & bye', 'line\nnext');
    const parsed = new URL(url);
    assert.equal(`${parsed.origin}${parsed.pathname}`, `https://github.com/${REPO}/issues/new`);
    assert.equal(parsed.searchParams.get('title'), 'Hello & bye');
    assert.equal(parsed.searchParams.get('body'), 'line\nnext');
  });

  test('truncates a long body so the URL stays under 7000 characters', () => {
    const body = 'word '.repeat(5000);
    const url = prefilledUrl('Title', body);
    assert.ok(url.length <= 7000, `url length ${url.length}`);
    const text = new URL(url).searchParams.get('body');
    const marker = `\n\n${TRUNCATED}`;
    assert.ok(text.endsWith(marker));
    assert.ok(body.startsWith(text.slice(0, text.length - marker.length)));
  });

  test('does not throw on characters outside the BMP when it cuts', () => {
    const url = prefilledUrl('Emoji', '😀'.repeat(3000));
    assert.ok(url.length <= 7000);
    assert.equal(new URL(url).searchParams.get('body').endsWith(TRUNCATED), true);
  });
});

describe('createIssue', () => {
  test('gh success returns created with the issue URL and the body file alone', () => {
    withRoot((root) => {
      const { run, calls } = recorder((cmd, args) => {
        if (args[0] === 'auth') return OK;
        return { status: 0, stdout: 'Creating issue\nhttps://github.com/StefanoVe/yllir/issues/42\n', stderr: '' };
      });
      const result = createIssue(root, { title: 'Map', summary: 'Broken map' }, { run, platform: 'darwin' });
      assert.equal(result.status, 'created');
      assert.equal(result.issue_url, 'https://github.com/StefanoVe/yllir/issues/42');
      assert.deepEqual(calls.map((call) => call.cmd), ['gh', 'gh']);

      const create = calls[1].args;
      assert.deepEqual(create.slice(0, 4), ['issue', 'create', '--repo', REPO]);
      assert.equal(create[create.indexOf('--title') + 1], 'Map');
      const bodyFile = create[create.indexOf('--body-file') + 1];
      assert.ok(path.isAbsolute(bodyFile));
      assert.match(bodyFile, /\.body\.md$/);
      const bodyText = fs.readFileSync(bodyFile, 'utf8');
      assert.ok(bodyText.startsWith('## Summary'));
      assert.equal(bodyText.includes('# Map'), false);
    });
  });

  test('gh missing then browser success returns browser with no issue URL', () => {
    withRoot((root) => {
      const { run, calls } = recorder((cmd) => (cmd === 'gh' ? MISSING : OK));
      const result = createIssue(root, { title: 'Map', summary: 'Broken map' }, { run, platform: 'linux' });
      assert.equal(result.status, 'browser');
      assert.equal(result.issue_url, null);
      assert.deepEqual(result.tried.map((entry) => [entry.method, entry.ok]), [['gh', false], ['browser', true]]);
      assert.match(result.tried[0].reason, /ENOENT/);
      const opener = calls.at(-1);
      assert.equal(opener.cmd, 'xdg-open');
      assert.equal(opener.args[0], result.prefilled_url);
    });
  });

  test('a runner that throws is recorded and does not escape', () => {
    withRoot((root) => {
      const { run } = recorder((cmd) => {
        if (cmd === 'gh') throw new Error('boom');
        return OK;
      });
      const result = createIssue(root, { title: 'Map', summary: 'Broken map' }, { run, platform: 'darwin' });
      assert.equal(result.status, 'browser');
      assert.equal(result.tried[0].ok, false);
      assert.match(result.tried[0].reason, /boom/);
    });
  });

  test('both methods failing gives text, and the file is kept in the campaign', () => {
    withRoot((root) => {
      const { run } = recorder(() => FAIL);
      const result = createIssue(root, { title: 'Map', summary: 'Broken map' }, { run, platform: 'darwin' });
      assert.equal(result.status, 'text');
      assert.equal(result.issue_url, null);
      assert.deepEqual(result.tried.map((entry) => [entry.method, entry.ok]), [['gh', false], ['browser', false]]);
      assert.match(result.body_file, /^\.campaign[/\\]state[/\\]issues[/\\]/);
      assert.equal(fs.existsSync(path.join(root, result.body_file)), true);
    });
  });

  test('dry run writes the file and starts no tool', () => {
    withRoot((root) => {
      const { run, calls } = recorder(() => OK);
      const result = createIssue(root, { title: 'T', summary: 'S' }, { run, dryRun: true });
      assert.equal(calls.length, 0);
      assert.equal(result.status, 'text');
      assert.deepEqual(result.tried, []);
      assert.equal(result.title, 'T');
      const text = fs.readFileSync(path.join(root, result.body_file), 'utf8');
      assert.ok(text.startsWith('# T\n\n## Summary\n\nS'));
    });
  });

  test('on Windows the browser URL escapes & as ^& for cmd', () => {
    withRoot((root) => {
      const { run, calls } = recorder(() => FAIL);
      createIssue(root, { title: 'A & B', summary: 'S' }, { run, platform: 'win32' });
      const start = calls.find((call) => call.cmd === 'cmd');
      assert.deepEqual(start.args.slice(0, 3), ['/c', 'start', '']);
      const url = start.args.at(-1);
      assert.ok(url.includes('^&'));
      assert.doesNotMatch(url.replaceAll('^&', ''), /&/);
    });
  });
});
