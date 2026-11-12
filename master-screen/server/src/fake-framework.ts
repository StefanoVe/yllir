// Test helper: a fake framework folder whose two CLIs (encyclopedia.mjs and print.mjs) record
// every call and print a canned answer per command. The campaign.yaml reader (yaml-lite) is the
// real one. Used only by *.test.ts files.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// The campaign.yaml reader of the framework is the real one: the fake only stands in for the CLIs.
const REAL_YAML_LITE = fileURLToPath(new URL('../../../yllir/scripts/lib/yaml-lite.mjs', import.meta.url));

export const FAKE_ENCYCLOPEDIA_CLI = 'skills/library/encyclopedia/scripts/encyclopedia.mjs';
export const FAKE_PRINT_CLI = 'skills/library/print/scripts/print.mjs';

export interface CannedAnswer {
  code?: number;
  json?: unknown;
  /** Printed instead of the JSON when set. */
  raw?: string;
  /** Waits before answering (used to hold a job open). */
  sleepMs?: number;
}

export interface FakeCall {
  script: string;
  args: string[];
}

export interface FakeFramework {
  frameworkRoot: string;
  calls(): Promise<FakeCall[]>;
  respond(command: string, answer: CannedAnswer): Promise<void>;
  cleanup(): Promise<void>;
}

function stubSource(stateDir: string): string {
  return `// Fake framework CLI for tests.
import fs from 'node:fs';
import path from 'node:path';
const STATE = ${JSON.stringify(stateDir)};
const args = process.argv.slice(2);
fs.appendFileSync(path.join(STATE, 'calls.jsonl'), JSON.stringify({ script: path.basename(process.argv[1]), args }) + '\\n');
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

export async function makeFakeFramework(): Promise<FakeFramework> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ms-fake-framework-'));
  const stateDir = path.join(root, 'state');
  await fs.mkdir(stateDir, { recursive: true });
  await fs.writeFile(path.join(stateDir, 'responses.json'), '{}', 'utf8');
  const source = stubSource(stateDir);
  const yamlLite = path.join(root, 'scripts', 'lib', 'yaml-lite.mjs');
  await fs.mkdir(path.dirname(yamlLite), { recursive: true });
  await fs.writeFile(yamlLite, `export * from ${JSON.stringify(pathToFileURL(REAL_YAML_LITE).href)};\n`, 'utf8');
  for (const rel of [FAKE_ENCYCLOPEDIA_CLI, FAKE_PRINT_CLI]) {
    const file = path.join(root, rel);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, source, 'utf8');
  }
  const table = async (): Promise<Record<string, CannedAnswer>> =>
    JSON.parse(await fs.readFile(path.join(stateDir, 'responses.json'), 'utf8'));
  return {
    frameworkRoot: root,
    async calls() {
      let raw = '';
      try {
        raw = await fs.readFile(path.join(stateDir, 'calls.jsonl'), 'utf8');
      } catch {
        return [];
      }
      return raw
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((line) => JSON.parse(line) as FakeCall);
    },
    async respond(command, answer) {
      const current = await table();
      current[command] = answer;
      await fs.writeFile(path.join(stateDir, 'responses.json'), JSON.stringify(current), 'utf8');
    },
    async cleanup() {
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}
