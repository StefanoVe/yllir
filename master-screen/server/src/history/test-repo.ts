// Temporary git repositories for the history tests. Used only by *.test.ts files.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface TestRepo {
  root: string;
  /** Writes a file (creating folders) without staging it. */
  write(rel: string, content: string): void;
  remove(rel: string): void;
  /** Stages everything and commits with the given subject. Returns the full sha. */
  commit(subject: string): string;
  git(...args: string[]): string;
  cleanup(): void;
}

export function makeRepo(prefix = 'ms-history-'): TestRepo {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const git = (...args: string[]): string =>
    execFileSync('git', ['-C', root, ...args], {
      encoding: 'utf8',
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Test Author');
  git('config', 'user.email', 'author@example.invalid');
  git('config', 'commit.gpgsign', 'false');
  return {
    root,
    write(rel, content) {
      const file = path.join(root, rel);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content);
    },
    remove(rel) {
      fs.rmSync(path.join(root, rel), { force: true });
    },
    commit(subject) {
      git('add', '-A');
      git('commit', '-q', '-m', subject);
      return git('rev-parse', 'HEAD');
    },
    git,
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

export const CAMPAIGN_YAML_EN = 'schema: 1\ncampaign:\n  name: Test Campaign\n  slug: test-campaign\nlanguage:\n  main: en\n';
