// The checks of the whole campaign for the screen: runs the framework's index, then
// reads its errors and sketches, and maps them to ChecksResponse in plain language.
// Owner: docs engineer.
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ChecksResponse } from '../../../shared/src/types.js';
import type { Ctx } from '../context.js';
import { loadFrameworkModule, runEngine } from '../engine.js';
import type { YamlModule } from './scan.js';

export const CHECK_FAILED_MESSAGE = 'The check could not run. Try again.';

export class ChecksFailedError extends Error {
  constructor() {
    super(CHECK_FAILED_MESSAGE);
    this.name = 'ChecksFailedError';
  }
}

interface QueryOutput {
  results?: unknown;
  error?: unknown;
}

const lastResults = new Map<string, ChecksResponse>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Results of a query command, or a failure when the command did not succeed. */
async function queryResults(ctx: Ctx, name: string): Promise<Record<string, unknown>[]> {
  const res = await runEngine<QueryOutput>(ctx, ['query', name]);
  if (res.code !== 0 || !res.json || !Array.isArray(res.json.results)) throw new ChecksFailedError();
  return res.json.results.filter(isRecord);
}

async function readExclusions(ctx: Ctx): Promise<string[]> {
  let raw: string;
  try {
    raw = await fs.readFile(path.join(ctx.campaignRoot, 'campaign.yaml'), 'utf8');
  } catch {
    return [];
  }
  const yaml = await loadFrameworkModule<YamlModule>(ctx, 'yaml-lite');
  const parsed = yaml.parseYamlLite(raw);
  if (parsed.errors.length > 0 || !isRecord(parsed.data)) return [];
  const audit = parsed.data.audit;
  if (!isRecord(audit) || !Array.isArray(audit.exclusions)) return [];
  const out: string[] = [];
  for (const item of audit.exclusions) {
    if (!isRecord(item)) continue;
    const subject = text(item.subject);
    const attribute = text(item.attribute);
    const values = Array.isArray(item.values) ? item.values.map(String).join(', ') : text(item.values);
    const reason = text(item.reason);
    let line = [subject, attribute].filter((part) => part !== '').join(', ');
    if (values !== '') line += `: ${values}`;
    if (reason !== '') line += ` (${reason})`;
    if (line !== '') out.push(line);
  }
  return out;
}

/** Runs the checks now, stores the result as the last one and returns it. Throws ChecksFailedError. */
export async function runChecks(ctx: Ctx): Promise<ChecksResponse> {
  const indexed = await runEngine(ctx, ['index']);
  if (indexed.code !== 0) throw new ChecksFailedError();
  const errors = await queryResults(ctx, 'errors');
  const sketches = await queryResults(ctx, 'sketches');
  const result: ChecksResponse = {
    brokenLinks: errors
      .filter((error) => error.code === 'unknown-reference')
      .map((error) => {
        const ids = Array.isArray(error.ids) ? error.ids : [];
        return { from: text(error.file), to: text(ids[1]), text: text(error.message) };
      }),
    sketches: sketches.map((sketch) => text(sketch.title) || text(sketch.id)).filter((title) => title !== ''),
    exclusions: await readExclusions(ctx),
    checkedAt: new Date().toISOString(),
  };
  lastResults.set(ctx.campaignRoot, result);
  return result;
}

/** The last result, or a fresh one when none was computed yet. */
export async function getChecks(ctx: Ctx): Promise<ChecksResponse> {
  return lastResults.get(ctx.campaignRoot) ?? runChecks(ctx);
}
