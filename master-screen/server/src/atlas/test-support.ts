// Test helper: a fake framework folder whose atlas CLI records every call and prints a canned answer
// per command (status, render). Used only by *.test.ts files.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ATLAS_CLI } from './service.js';

export interface AtlasCannedAnswer {
  code?: number;
  json?: unknown;
  raw?: string;
  /** Waits before answering (holds a job open). */
  sleepMs?: number;
}

export interface FakeAtlasCli {
  frameworkRoot: string;
  calls(): Promise<Array<{ args: string[] }>>;
  respond(command: string, answer: AtlasCannedAnswer): Promise<void>;
  cleanup(): Promise<void>;
}

function stubSource(state: string): string {
  return `// Fake atlas CLI for tests.
import fs from 'node:fs';
import path from 'node:path';
const STATE = ${JSON.stringify(state)};
const args = process.argv.slice(2);
fs.appendFileSync(path.join(STATE, 'calls.jsonl'), JSON.stringify({ args }) + '\\n');
const table = JSON.parse(fs.readFileSync(path.join(STATE, 'responses.json'), 'utf8'));
const answer = table[args[0]] ?? { code: 0, json: {} };
if (answer.sleepMs) await new Promise((resolve) => setTimeout(resolve, answer.sleepMs));
const body = typeof answer.raw === 'string' ? answer.raw : JSON.stringify(answer.json ?? {}, null, 2);
const code = answer.code ?? 0;
process.stdout.write(body + '\\n');
process.stdout.write('exit: ' + code + '\\n');
process.exitCode = code;
`;
}

/** The status a campaign with no atlas folder gets. */
export const NO_ATLAS: AtlasCannedAnswer = { code: 1, json: { folder: null, exists: false, pending: [] } };

/**
 * The status of a campaign with an atlas and the given pending places. The first layer (terrain by
 * default, ground for an urban atlas) is present, and locked only when `locked` is true.
 */
export function atlasStatus(
  pending: number,
  opts: { layer?: 'terrain' | 'ground'; locked?: boolean } = {},
): AtlasCannedAnswer {
  const layer = opts.layer ?? 'terrain';
  return {
    code: 0,
    json: {
      folder: 'Atlante',
      exists: true,
      layers: { [layer]: { present: true, locked: opts.locked === true, features: 0 } },
      problems: [],
      pending: Array.from({ length: pending }, (_, i) => ({ id: `place-${i}` })),
    },
  };
}

export async function makeFakeAtlasCli(): Promise<FakeAtlasCli> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ms-fake-atlas-'));
  const state = path.join(root, 'state');
  await fs.mkdir(state, { recursive: true });
  await fs.writeFile(path.join(state, 'responses.json'), '{}', 'utf8');
  const file = path.join(root, ATLAS_CLI);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, stubSource(state), 'utf8');
  const table = async (): Promise<Record<string, AtlasCannedAnswer>> =>
    JSON.parse(await fs.readFile(path.join(state, 'responses.json'), 'utf8'));
  return {
    frameworkRoot: root,
    async calls() {
      let raw = '';
      try {
        raw = await fs.readFile(path.join(state, 'calls.jsonl'), 'utf8');
      } catch {
        return [];
      }
      return raw
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((line) => JSON.parse(line) as { args: string[] });
    },
    async respond(command, answer) {
      const current = await table();
      current[command] = answer;
      await fs.writeFile(path.join(state, 'responses.json'), JSON.stringify(current), 'utf8');
    },
    async cleanup() {
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}
